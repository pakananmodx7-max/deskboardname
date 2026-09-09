import { getSupabaseClient } from '@/lib/supabase'
import type { AttendanceStatus, AttendanceSummary } from '@/types/attendance'
import type { SubmissionStatus } from '@/types/assignment'
import type {
  MyAssignment,
  MyAttendanceRecord,
  MyClassroom,
  MyStudentProfile,
  MySubject,
} from '@/types/student-portal'

/**
 * Every function in this file reads EXCLUSIVELY through the RLS
 * policies added in 0011_student_portal_read_access.sql — none of them
 * ever passes a student_id (or any other identity value) to Supabase.
 * "Which student is this" is resolved entirely server-side, from
 * auth.uid(), by my_student_id(); a query here can no more read another
 * student's row than a forged parameter could, because there is no
 * parameter to forge in the first place. This mirrors the exact
 * "identity must always derive from auth.uid(), never from the browser"
 * requirement the Student Portal was built to.
 */

interface StudentRow {
  id: string
  student_code: string | null
  number: number | null
  first_name: string
  last_name: string
  nickname: string | null
}

interface ClassroomRow {
  id: string
  name: string
  grade_level: string | null
  section: string | null
}

interface SubjectRow {
  id: string
  name: string
  subject_code: string | null
  description: string | null
}

interface SubjectClassroomRow {
  subject_id: string
  classroom_id: string
}

interface AssignmentRow {
  id: string
  subject_id: string
  classroom_id: string
  title: string
  description: string | null
  max_score: number
  due_date: string | null
  is_archived: boolean
}

interface AssignmentSubmissionRow {
  assignment_id: string
  status: SubmissionStatus
  score: number | null
}

interface AttendanceSessionRow {
  id: string
  classroom_id: string
  subject_id: string | null
  period_number: number | null
  attendance_date: string
}

interface AttendanceRecordRow {
  attendance_session_id: string
  status: AttendanceStatus
}

/**
 * The signed-in student's own profile — id/code/name/nickname only,
 * never email/phone/status (those aren't needed anywhere in the
 * portal). RLS (students_select_own_linked, 0011) already guarantees
 * this can return at most one row (linked_profile_id is unique) and
 * only once a teacher has actually approved the link; a pending,
 * rejected, or never-linked account gets `null` here, not an error —
 * StudentProtectedRoute/the pending-status flow is what routes an
 * unapproved account away from the portal before this is ever called,
 * but this function stays defensive on its own regardless.
 */
export async function getMyStudentProfile(): Promise<MyStudentProfile | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('students')
    .select('id, student_code, number, first_name, last_name, nickname')
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as StudentRow
  return {
    id: row.id,
    studentCode: row.student_code,
    number: row.number,
    firstName: row.first_name,
    lastName: row.last_name,
    nickname: row.nickname,
  }
}

/** Every classroom the signed-in student currently belongs to (almost
 * always exactly one, but not assumed to be). */
export async function getMyClassrooms(): Promise<MyClassroom[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('classrooms')
    .select('id, name, grade_level, section')
    .order('name', { ascending: true })

  if (error) throw error
  return (data as ClassroomRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    gradeLevel: row.grade_level,
    section: row.section,
  }))
}

/**
 * Every subject taught in one of the signed-in student's classrooms.
 * Fetched as three independently RLS-scoped queries and joined
 * client-side — same "plain, independently-scoped queries" convention
 * documented in student-link-service.ts's getLinkRequestsForTeacher,
 * rather than a single embedded PostgREST join across three tables.
 */
export async function getMySubjects(): Promise<MySubject[]> {
  const supabase = getSupabaseClient()
  const [subjectsResult, linksResult, classroomsResult] = await Promise.all([
    supabase.from('subjects').select('id, name, subject_code, description'),
    supabase.from('subject_classrooms').select('subject_id, classroom_id'),
    supabase.from('classrooms').select('id, name, grade_level, section'),
  ])
  if (subjectsResult.error) throw subjectsResult.error
  if (linksResult.error) throw linksResult.error
  if (classroomsResult.error) throw classroomsResult.error

  const subjectById = new Map((subjectsResult.data as SubjectRow[]).map((s) => [s.id, s]))
  const classroomById = new Map((classroomsResult.data as ClassroomRow[]).map((c) => [c.id, c]))

  const result: MySubject[] = []
  for (const link of linksResult.data as SubjectClassroomRow[]) {
    const subject = subjectById.get(link.subject_id)
    const classroom = classroomById.get(link.classroom_id)
    if (!subject || !classroom) continue
    result.push({
      id: subject.id,
      name: subject.name,
      subjectCode: subject.subject_code,
      description: subject.description,
      classroomId: classroom.id,
      classroomName: classroom.name,
    })
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, 'th'))
}

/**
 * Every non-archived assignment across every classroom the student
 * belongs to, merged with the student's OWN submission for each (never
 * a classmate's — assignment_submissions is RLS-scoped to
 * `student_id = my_student_id()`, so this query can only ever return
 * the caller's own rows no matter what). An assignment with no
 * submission row yet defaults to status 'not_submitted' and score null,
 * exactly matching assignment-service.ts's buildDefaultSubmissions
 * philosophy — nothing is written just by viewing this list.
 *
 * Pass `subjectId`/`classroomId` to narrow the result (used by the
 * subject detail page's งาน tab) — purely a display filter, applied
 * client-side after the RLS-scoped fetch; it does not change which rows
 * are reachable at all, only which of the reachable rows are returned.
 */
export async function getMyAssignments(subjectId?: string, classroomId?: string): Promise<MyAssignment[]> {
  const supabase = getSupabaseClient()
  const [assignmentsResult, submissionsResult, subjectsResult, classroomsResult] = await Promise.all([
    supabase.from('assignments').select('*').eq('is_archived', false),
    supabase.from('assignment_submissions').select('assignment_id, status, score'),
    supabase.from('subjects').select('id, name'),
    supabase.from('classrooms').select('id, name'),
  ])
  if (assignmentsResult.error) throw assignmentsResult.error
  if (submissionsResult.error) throw submissionsResult.error
  if (subjectsResult.error) throw subjectsResult.error
  if (classroomsResult.error) throw classroomsResult.error

  const submissionByAssignment = new Map(
    (submissionsResult.data as AssignmentSubmissionRow[]).map((s) => [s.assignment_id, s]),
  )
  const subjectNameById = new Map((subjectsResult.data as { id: string; name: string }[]).map((s) => [s.id, s.name]))
  const classroomNameById = new Map(
    (classroomsResult.data as { id: string; name: string }[]).map((c) => [c.id, c.name]),
  )

  return (assignmentsResult.data as AssignmentRow[])
    .filter((a) => (subjectId ? a.subject_id === subjectId : true) && (classroomId ? a.classroom_id === classroomId : true))
    .map((a) => {
      const submission = submissionByAssignment.get(a.id)
      return {
        id: a.id,
        subjectId: a.subject_id,
        subjectName: subjectNameById.get(a.subject_id) ?? '-',
        classroomId: a.classroom_id,
        classroomName: classroomNameById.get(a.classroom_id) ?? '-',
        title: a.title,
        description: a.description,
        maxScore: a.max_score,
        dueDate: a.due_date,
        status: submission?.status ?? 'not_submitted',
        score: submission?.score ?? null,
      }
    })
    .sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return a.dueDate.localeCompare(b.dueDate)
    })
}

/**
 * Every attendance record for the signed-in student, across every
 * homeroom AND subject-scoped session (subject_id/period_number may or
 * may not be set — see 0004/0005) — attendance_records is RLS-scoped to
 * `student_id = my_student_id()`, so, same as assignments above, this
 * can only ever be the caller's own history.
 */
export async function getMyAttendance(subjectId?: string, classroomId?: string): Promise<MyAttendanceRecord[]> {
  const supabase = getSupabaseClient()
  const [recordsResult, sessionsResult, subjectsResult, classroomsResult] = await Promise.all([
    supabase.from('attendance_records').select('attendance_session_id, status'),
    supabase.from('attendance_sessions').select('id, classroom_id, subject_id, period_number, attendance_date'),
    supabase.from('subjects').select('id, name'),
    supabase.from('classrooms').select('id, name'),
  ])
  if (recordsResult.error) throw recordsResult.error
  if (sessionsResult.error) throw sessionsResult.error
  if (subjectsResult.error) throw subjectsResult.error
  if (classroomsResult.error) throw classroomsResult.error

  const sessionById = new Map((sessionsResult.data as AttendanceSessionRow[]).map((s) => [s.id, s]))
  const subjectNameById = new Map((subjectsResult.data as { id: string; name: string }[]).map((s) => [s.id, s.name]))
  const classroomNameById = new Map(
    (classroomsResult.data as { id: string; name: string }[]).map((c) => [c.id, c.name]),
  )

  const result: MyAttendanceRecord[] = []
  for (const record of recordsResult.data as AttendanceRecordRow[]) {
    const session = sessionById.get(record.attendance_session_id)
    if (!session) continue
    if (subjectId && session.subject_id !== subjectId) continue
    if (classroomId && session.classroom_id !== classroomId) continue
    result.push({
      sessionId: session.id,
      classroomId: session.classroom_id,
      classroomName: classroomNameById.get(session.classroom_id) ?? '-',
      subjectId: session.subject_id,
      subjectName: session.subject_id ? (subjectNameById.get(session.subject_id) ?? '-') : null,
      periodNumber: session.period_number,
      attendanceDate: session.attendance_date,
      status: record.status,
    })
  }
  return result.sort((a, b) => b.attendanceDate.localeCompare(a.attendanceDate))
}

// ==================================================
// Pure aggregation/derivation — everything below operates only on data
// the caller already fetched above; no Supabase calls, no student_id
// anywhere, cheaply unit-testable.
// ==================================================

export type AssignmentFilter = 'all' | SubmissionStatus

/** ทั้งหมด / ยังไม่ส่ง / ส่งแล้ว / ส่งช้า / ขาดส่ง — the /student/assignments
 * filter tabs. Pure so the exact filtering rule is unit-tested without a
 * live fetch. */
export function filterMyAssignments(assignments: MyAssignment[], filter: AssignmentFilter): MyAssignment[] {
  if (filter === 'all') return assignments
  return assignments.filter((a) => a.status === filter)
}

/** Pure tally used by /student/dashboard and /student/attendance — same
 * shape as attendance-service.ts's getAttendanceSummary, but built from
 * this student's own MyAttendanceRecord history (one row per session)
 * instead of a teacher's per-session, per-student records map. */
export function summarizeMyAttendance(records: MyAttendanceRecord[]): AttendanceSummary {
  const summary: AttendanceSummary = { present: 0, late: 0, leave: 0, absent: 0, total: 0 }
  for (const record of records) {
    summary[record.status] += 1
    summary.total += 1
  }
  return summary
}

/** present / total * 100, or null when there's no attendance history at
 * all yet (never a divide-by-zero NaN). */
export function computeAttendanceRate(summary: AttendanceSummary): number | null {
  return summary.total > 0 ? (summary.present / summary.total) * 100 : null
}

export interface MyGradeAssignmentRow {
  assignmentId: string
  title: string
  score: number | null
  maxScore: number
  /** score/maxScore * 100, or null while ungraded. */
  percentage: number | null
}

export interface MySubjectGrades {
  subjectId: string
  subjectName: string
  classroomId: string
  classroomName: string
  assignments: MyGradeAssignmentRow[]
  earned: number
  possible: number
  percentage: number | null
}

export interface MyGradesSummary {
  bySubject: MySubjectGrades[]
  totalEarned: number
  totalPossible: number
  totalPercentage: number | null
}

/**
 * Builds the /student/grades view — grouped by subject (each subject's
 * own assignment list + subtotal), plus one grand total across every
 * subject. Reads only `score`/`maxScore`/`title` off each assignment —
 * no class average, no highest, no lowest, and nothing about any other
 * student, because `assignments` here was already scoped to "my
 * assignments, my own score" by getMyAssignments/RLS before this ever
 * runs. `possible` counts every assignment's max_score regardless of
 * whether it's graded yet, same convention as
 * assignment-service.ts's computeGradeRows on the teacher side.
 */
export function computeMyGrades(assignments: MyAssignment[]): MyGradesSummary {
  const bySubjectMap = new Map<string, MySubjectGrades>()

  for (const a of assignments) {
    const key = `${a.subjectId}:${a.classroomId}`
    let group = bySubjectMap.get(key)
    if (!group) {
      group = {
        subjectId: a.subjectId,
        subjectName: a.subjectName,
        classroomId: a.classroomId,
        classroomName: a.classroomName,
        assignments: [],
        earned: 0,
        possible: 0,
        percentage: null,
      }
      bySubjectMap.set(key, group)
    }

    const percentage = a.score !== null ? (a.score / a.maxScore) * 100 : null
    group.assignments.push({ assignmentId: a.id, title: a.title, score: a.score, maxScore: a.maxScore, percentage })
    group.possible += a.maxScore
    if (a.score !== null) group.earned += a.score
  }

  const bySubject = [...bySubjectMap.values()].map((group) => ({
    ...group,
    percentage: group.possible > 0 ? (group.earned / group.possible) * 100 : null,
  }))
  bySubject.sort((a, b) => a.subjectName.localeCompare(b.subjectName, 'th'))

  const totalEarned = bySubject.reduce((sum, g) => sum + g.earned, 0)
  const totalPossible = bySubject.reduce((sum, g) => sum + g.possible, 0)

  return {
    bySubject,
    totalEarned,
    totalPossible,
    totalPercentage: totalPossible > 0 ? (totalEarned / totalPossible) * 100 : null,
  }
}

/** งานที่ต้องทำ — assignments not yet (fully) submitted, soonest due date
 * first (assignments with no due date sort last). Used by the dashboard's
 * "to-do" list; /student/assignments shows everything via
 * filterMyAssignments instead. */
export function getPendingAssignments(assignments: MyAssignment[]): MyAssignment[] {
  return assignments.filter((a) => a.status === 'not_submitted' || a.status === 'late')
}

