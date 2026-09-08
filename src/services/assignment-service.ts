import { getSupabaseClient } from '@/lib/supabase'
import type {
  Assignment,
  AssignmentSubmission,
  CreateAssignmentInput,
  SubmissionStatus,
  UpdateAssignmentInput,
} from '@/types/assignment'

interface AssignmentRow {
  id: string
  subject_id: string
  classroom_id: string
  topic_id: string | null
  title: string
  description: string | null
  max_score: number
  due_date: string | null
  is_archived: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

interface AssignmentSubmissionRow {
  student_id: string
  status: SubmissionStatus
  score: number | null
  note: string | null
}

function mapAssignment(row: AssignmentRow): Assignment {
  return {
    id: row.id,
    subjectId: row.subject_id,
    classroomId: row.classroom_id,
    topicId: row.topic_id,
    title: row.title,
    description: row.description,
    maxScore: row.max_score,
    dueDate: row.due_date,
    isArchived: row.is_archived,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapSubmission(row: AssignmentSubmissionRow): AssignmentSubmission {
  return { studentId: row.student_id, status: row.status, score: row.score, note: row.note }
}

async function requireTeacherId(): Promise<string> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) {
    throw new Error('กรุณาเข้าสู่ระบบก่อนใช้งาน')
  }
  return data.user.id
}

/**
 * Every assignment read in this app is scoped to one subject+classroom
 * pair — there is no "all assignments for this subject across every
 * linked classroom" query, on purpose. See 0006_subject_assignments.sql's
 * scope note: two classrooms linked to the same subject have completely
 * independent assignment sets, even when titles match.
 */
export async function getAssignments(subjectId: string, classroomId: string): Promise<Assignment[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('assignments')
    .select('*')
    .eq('subject_id', subjectId)
    .eq('classroom_id', classroomId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data as AssignmentRow[]).map(mapAssignment)
}

export async function getAssignmentById(assignmentId: string): Promise<Assignment | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.from('assignments').select('*').eq('id', assignmentId).maybeSingle()

  if (error) throw error
  return data ? mapAssignment(data as AssignmentRow) : null
}

/**
 * `assignments_insert_own` (0006) already requires the caller to own
 * both the classroom and the subject AND that the subject is actually
 * linked to that classroom via subject_classrooms — so passing a
 * classroomId not linked to subjectId fails with a clear RLS error
 * rather than silently creating a dangling assignment.
 */
export async function createAssignment(input: CreateAssignmentInput): Promise<Assignment> {
  const supabase = getSupabaseClient()
  const teacherId = await requireTeacherId()

  const { data, error } = await supabase
    .from('assignments')
    .insert({
      subject_id: input.subjectId,
      classroom_id: input.classroomId,
      topic_id: input.topicId ?? null,
      title: input.title,
      description: input.description ?? null,
      max_score: input.maxScore,
      due_date: input.dueDate ?? null,
      created_by: teacherId,
    })
    .select('*')
    .single()

  if (error) throw error
  return mapAssignment(data as AssignmentRow)
}

/**
 * `assignments_update_own` (0006) scopes this to rows the caller owns —
 * there is no subjectId/classroomId field on UpdateAssignmentInput at
 * all, so an assignment can never be reassigned to a different
 * subject/classroom pair through this function.
 */
export async function updateAssignment(assignmentId: string, input: UpdateAssignmentInput): Promise<Assignment> {
  const supabase = getSupabaseClient()

  const patch: Record<string, unknown> = {}
  if (input.topicId !== undefined) patch.topic_id = input.topicId
  if (input.title !== undefined) patch.title = input.title
  if (input.description !== undefined) patch.description = input.description
  if (input.maxScore !== undefined) patch.max_score = input.maxScore
  if (input.dueDate !== undefined) patch.due_date = input.dueDate
  if (input.isArchived !== undefined) patch.is_archived = input.isArchived

  const { data, error } = await supabase
    .from('assignments')
    .update(patch)
    .eq('id', assignmentId)
    .select('*')
    .single()

  if (error) throw error
  return mapAssignment(data as AssignmentRow)
}

/**
 * Assignments are never hard-deleted through the app — there is no
 * DELETE RLS policy for them (0006), matching students/subjects/
 * attendance. Archiving just flips is_archived to true; every submission
 * and score stays intact.
 */
export async function archiveAssignment(assignmentId: string): Promise<Assignment> {
  return updateAssignment(assignmentId, { isArchived: true })
}

export async function getSubmissions(assignmentId: string): Promise<Record<string, AssignmentSubmission>> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('assignment_submissions')
    .select('student_id, status, score, note')
    .eq('assignment_id', assignmentId)

  if (error) throw error

  const submissions: Record<string, AssignmentSubmission> = {}
  for (const row of data as AssignmentSubmissionRow[]) {
    submissions[row.student_id] = mapSubmission(row)
  }
  return submissions
}

/**
 * Upserts one student's status — `assignment_submissions_insert_own`
 * (0006) requires the student to be a CURRENT member of the assignment's
 * classroom the first time a row is created for them; the ON CONFLICT
 * DO UPDATE path (correcting an already-recorded status) is governed by
 * `assignment_submissions_update_own` instead, which does not re-check
 * membership — so correcting a submission for a student who has since
 * left the classroom still works.
 */
export async function setSubmissionStatus(
  assignmentId: string,
  studentId: string,
  status: SubmissionStatus,
): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('assignment_submissions')
    .upsert({ assignment_id: assignmentId, student_id: studentId, status }, { onConflict: 'assignment_id,student_id' })

  if (error) throw error
}

/**
 * Independent per-student upserts rather than one atomic batch — unlike
 * attendance's save_attendance_session (which upserts a whole session's
 * worth of records together because the session row itself is created
 * fresh on every save), each assignment already exists persistently and
 * every submission row is independently authorized, so there is no
 * shared parent write that needs all-or-nothing semantics here. A
 * partial failure only affects the specific student(s) it applies to.
 */
export async function bulkSetSubmissionStatus(
  assignmentId: string,
  studentIds: string[],
  status: SubmissionStatus,
): Promise<void> {
  await Promise.all(studentIds.map((studentId) => setSubmissionStatus(assignmentId, studentId, status)))
}

export async function setSubmissionScore(assignmentId: string, studentId: string, score: number | null): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('assignment_submissions')
    .upsert({ assignment_id: assignmentId, student_id: studentId, score }, { onConflict: 'assignment_id,student_id' })

  if (error) throw error
}

export async function setSubmissionNote(assignmentId: string, studentId: string, note: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('assignment_submissions')
    .upsert(
      { assignment_id: assignmentId, student_id: studentId, note: note || null },
      { onConflict: 'assignment_id,student_id' },
    )

  if (error) throw error
}

/**
 * Client-side default for a student with no submission row yet: matches
 * the assignment_submissions table's own `status` column default
 * ('not_submitted', see 0006) — nothing is written to Supabase just by
 * displaying this default; a row is only created the first time a
 * teacher actually marks a status, enters a score, or adds a note for
 * that student (setSubmissionStatus/Score/Note above), the same
 * write-lazily philosophy as attendance's buildDefaultRecords.
 */
export function buildDefaultSubmissions(studentIds: string[]): Record<string, AssignmentSubmission> {
  const submissions: Record<string, AssignmentSubmission> = {}
  for (const studentId of studentIds) {
    submissions[studentId] = { studentId, status: 'not_submitted', score: null, note: null }
  }
  return submissions
}

/**
 * The roster shown for an assignment — every currently-active classroom
 * member, PLUS any member who has since been archived (status =
 * 'inactive') but already has a submission row for this exact
 * assignment. Same rule, same rationale, as attendance's
 * deriveAttendanceRoster: reopening an assignment never silently drops a
 * student's submission/score history just because they were archived
 * afterward, and a newly-archived student never gets a synthetic
 * "not_submitted" row invented for them.
 */
export function deriveAssignmentRoster<T extends { id: string; status: 'active' | 'inactive' }>(
  students: T[],
  submissions: Record<string, AssignmentSubmission>,
): T[] {
  return students.filter((student) => student.status === 'active' || submissions[student.id] !== undefined)
}

export interface SubmissionSummary {
  submitted: number
  notSubmitted: number
  late: number
  missing: number
  total: number
  /** Average of only the students who have a non-null score, or null if none do. */
  average: number | null
}

/** Pure tally used to render the live summary card and each assignment
 * card's "submitted/total" figure. */
export function getSubmissionSummary(submissions: Record<string, AssignmentSubmission>): SubmissionSummary {
  const summary: SubmissionSummary = { submitted: 0, notSubmitted: 0, late: 0, missing: 0, total: 0, average: null }
  const scores: number[] = []

  for (const submission of Object.values(submissions)) {
    summary.total += 1
    if (submission.status === 'submitted') summary.submitted += 1
    else if (submission.status === 'not_submitted') summary.notSubmitted += 1
    else if (submission.status === 'late') summary.late += 1
    else if (submission.status === 'missing') summary.missing += 1

    if (submission.score !== null) scores.push(submission.score)
  }

  if (scores.length > 0) {
    summary.average = scores.reduce((a, b) => a + b, 0) / scores.length
  }

  return summary
}
