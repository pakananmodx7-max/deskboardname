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
  id?: string
  student_id: string
  status: SubmissionStatus
  score: number | null
  note: string | null
  submitted_at?: string | null
  reviewed_at?: string | null
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
  return {
    studentId: row.student_id,
    status: row.status,
    score: row.score,
    note: row.note,
    id: row.id,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
  }
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
    .select('id, student_id, status, score, note, submitted_at, reviewed_at')
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
 * Entering a real score is itself evidence the work was actually turned
 * in — this promotes an untouched 'not_submitted' row to 'submitted' the
 * moment a score is recorded, so the status column never says
 * "not_submitted" while a score sits right next to it. A submission the
 * teacher already explicitly marked 'late' or 'missing' is never
 * silently overwritten by this — only the 'not_submitted' default
 * transitions. Clearing a score back to blank (score = null) never moves
 * status backwards either; "ungraded yet" and "not submitted" are
 * different questions, and clearing a grade doesn't mean the student
 * un-submitted their work. Pure so it can be shared by the score-entry
 * upsert (server-side) and every UI that edits scores locally (assignment
 * detail page, Grades tab) without the two ever disagreeing on the rule.
 */
export function nextStatusAfterScore(currentStatus: SubmissionStatus, score: number | null): SubmissionStatus {
  return score !== null && currentStatus === 'not_submitted' ? 'submitted' : currentStatus
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

/**
 * `currentStatus` is the caller's own last-known status for this
 * submission (e.g. from the local state the Grades tab or assignment
 * detail page already holds) — it's used only to compute the
 * nextStatusAfterScore transition below, never trusted as an
 * authorization check (RLS still governs whether the write is allowed at
 * all). Always writes `status` alongside `score` in the same upsert so
 * the two never fall out of sync in the database.
 */
export async function setSubmissionScore(
  assignmentId: string,
  studentId: string,
  score: number | null,
  currentStatus: SubmissionStatus,
): Promise<void> {
  const supabase = getSupabaseClient()
  const status = nextStatusAfterScore(currentStatus, score)
  // reviewed_at is bumped every time a teacher records a score —
  // informational only, supports a future storage-retention policy (see
  // 0016_assignment_submission_uploads.sql's header note). Never
  // touched by a student write (blocked by that migration's
  // enforce_submission_field_ownership trigger).
  const { error } = await supabase.from('assignment_submissions').upsert(
    { assignment_id: assignmentId, student_id: studentId, score, status, reviewed_at: new Date().toISOString() },
    { onConflict: 'assignment_id,student_id' },
  )

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
 * The exact merge the assignment detail page's refresh() uses after
 * (re)loading from Supabase: every active classroom member defaults to
 * 'not_submitted' with no score, then any row Supabase actually returned
 * — a score, status, or note a teacher entered before this reload —
 * overrides that default. Extracted as its own pure function so "a
 * score a teacher entered survives navigating away and refreshing the
 * page" is unit-testable without a live Supabase round trip: the fetched
 * submission always wins over the synthetic default, never the other
 * way around.
 */
export function mergeSubmissionsWithDefaults(
  activeStudentIds: string[],
  fetchedSubmissions: Record<string, AssignmentSubmission>,
): Record<string, AssignmentSubmission> {
  return { ...buildDefaultSubmissions(activeStudentIds), ...fetchedSubmissions }
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

export interface GradedTally {
  /** Roster size this tally was computed over — always the full roster,
   * never affected by any table filter/search (see the assignment detail
   * page: summary counts must stay truthful regardless of what the
   * teacher is currently filtering the table down to). */
  total: number
  /** Has a non-null score recorded, regardless of submission status. */
  graded: number
  notGraded: number
}

/** "ตรวจแล้ว / ยังไม่ตรวจ" — derived purely from whether a score is
 * present, never a separate stored field. Always computed over the full
 * roster passed in (the assignment detail page always passes the
 * unfiltered roster here, keeping this truthful regardless of the
 * table's current filter/search). */
export function computeGradedTally(
  rosterIds: string[],
  submissions: Record<string, AssignmentSubmission>,
): GradedTally {
  const total = rosterIds.length
  const graded = rosterIds.filter((id) => submissions[id]?.score !== null && submissions[id]?.score !== undefined).length
  return { total, graded, notGraded: total - graded }
}

export type AssignmentDetailFilter = SubmissionStatus | 'all' | 'ungraded'

export const ASSIGNMENT_DETAIL_FILTERS: { key: AssignmentDetailFilter; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'not_submitted', label: 'ยังไม่ส่ง' },
  { key: 'submitted', label: 'ส่งแล้ว' },
  { key: 'late', label: 'ส่งช้า' },
  { key: 'missing', label: 'ขาดส่ง' },
  { key: 'ungraded', label: 'ยังไม่ให้คะแนน' },
]

/**
 * Filters the roster shown in the submission table by status or by
 * "ungraded" (score is null, regardless of status) — never touches the
 * summary counts above, which always reflect the full roster. `'all'`
 * returns the roster unchanged (a new array, so callers can rely on a
 * fresh reference each call).
 */
export function filterRosterByStatus<T extends { id: string }>(
  roster: T[],
  submissions: Record<string, AssignmentSubmission>,
  filter: AssignmentDetailFilter,
): T[] {
  if (filter === 'all') return [...roster]
  if (filter === 'ungraded') {
    return roster.filter((student) => (submissions[student.id]?.score ?? null) === null)
  }
  return roster.filter((student) => (submissions[student.id]?.status ?? 'not_submitted') === filter)
}

/**
 * Student search over the currently status-filtered roster — matches
 * name (either order of first/last), student code, or roll number, all
 * case-insensitively. An empty/whitespace-only query returns the roster
 * unchanged.
 */
export function searchRoster<T extends { firstName: string; lastName: string; studentCode: string | null; number: number | null }>(
  roster: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return roster
  return roster.filter((student) => {
    const fullName = `${student.firstName} ${student.lastName}`.toLowerCase()
    const code = (student.studentCode ?? '').toLowerCase()
    const number = student.number !== null ? String(student.number) : ''
    return fullName.includes(q) || code.includes(q) || number.includes(q)
  })
}

// ==================================================
// Grades — a derived view over assignments + assignment_submissions,
// never a separate stored table (see 0006's "Future relationship" note).
// Everything below is pure and operates on data the caller already
// fetched with getAssignments/getSubmissions, scoped to one
// subject+classroom — there is no query here that could reach across
// classrooms or subjects.
// ==================================================

export interface ScoreValidationResult {
  /** Parsed score, or null for a deliberately blank ("not graded yet" /
   * "not submitted") entry. */
  value: number | null
  /** Thai error message if `raw` is out of range or not a number; null
   * when the input is valid (including blank). */
  error: string | null
}

/**
 * Validates one score-entry cell's raw text against `0 <= score <=
 * maxScore`. A blank/whitespace-only entry is always valid and means "no
 * score yet" (not submitted, or submitted but not graded) — it is NOT an
 * error, and is exactly how a teacher clears a previously entered score.
 */
export function parseScoreInput(raw: string, maxScore: number): ScoreValidationResult {
  const trimmed = raw.trim()
  if (trimmed === '') return { value: null, error: null }

  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return { value: null, error: 'กรุณากรอกตัวเลข' }
  if (parsed < 0) return { value: null, error: 'คะแนนต้องไม่ติดลบ' }
  if (parsed > maxScore) return { value: null, error: `คะแนนต้องไม่เกิน ${maxScore}` }
  return { value: parsed, error: null }
}

export interface MaxScoreChangeViolation {
  studentId: string
  score: number
}

export interface MaxScoreValidationResult {
  ok: boolean
  error: string | null
  violations: MaxScoreChangeViolation[]
}

/**
 * Validates a proposed new assignment max_score against every
 * currently-recorded submission score. Lowering max_score must never
 * silently truncate an existing score that's now out of range — this
 * blocks the change and reports exactly which students are affected (so
 * the UI can name them), rather than the 0007 database trigger rejecting
 * individual future score writes one at a time with no upfront warning.
 * This is a client-side pre-check in front of that trigger, not a
 * replacement for it — the trigger is still what actually enforces the
 * bound at the database level.
 */
export function validateMaxScoreChange(
  newMaxScore: number,
  submissions: Record<string, AssignmentSubmission>,
): MaxScoreValidationResult {
  if (!Number.isFinite(newMaxScore) || newMaxScore <= 0) {
    return { ok: false, error: 'คะแนนเต็มต้องมากกว่า 0', violations: [] }
  }

  const violations: MaxScoreChangeViolation[] = []
  for (const submission of Object.values(submissions)) {
    if (submission.score !== null && submission.score > newMaxScore) {
      violations.push({ studentId: submission.studentId, score: submission.score })
    }
  }

  if (violations.length > 0) {
    return {
      ok: false,
      error: `มีนักเรียน ${violations.length} คนที่คะแนนเกินคะแนนเต็มใหม่ (${newMaxScore})`,
      violations,
    }
  }

  return { ok: true, error: null, violations: [] }
}

/**
 * Splits raw clipboard text into an ordered list of raw score strings.
 * Normal case (copying a column of cells from Excel/Sheets): one value
 * per line, newline-separated — CRLF, bare LF, and bare CR are all
 * normalized to `\n` first. Fallback case (copying a single horizontal
 * row instead of a column): when the clipboard holds exactly one line
 * and that line contains tabs, the tabs are treated as the row separator
 * instead. A multi-line paste where an individual line happens to
 * contain tabs (e.g. a wider multi-column copy) only ever takes that
 * line's first cell — this feature is single-column score entry, not a
 * general grid paste.
 *
 * Only TRAILING blank lines are dropped (the common case of a stray
 * newline at the end of a copy) — a blank line in the MIDDLE of the
 * paste is kept as an empty ('') entry rather than removed, so it still
 * lines up with, and is skipped for, the correct student row instead of
 * shifting every row below it up by one and silently overwriting the
 * wrong students.
 */
export function parsePastedScores(rawClipboardText: string): string[] {
  const normalized = rawClipboardText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n').map((line) => line.trim())
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  if (lines.length === 1 && lines[0].includes('\t')) {
    const cells = lines[0].split('\t').map((cell) => cell.trim())
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop()
    return cells
  }
  return lines.map((line) => line.split('\t')[0].trim())
}

export interface PasteScorePlanRow {
  studentId: string
  raw: string
  value: number | null
  error: string | null
}

/**
 * Plans a multi-row score paste starting at `startIndex` within
 * `rosterIds` (the roster's own display order — e.g. the row that was
 * focused when the paste happened). Naturally bounded to
 * `rosterIds.length` via the slice below, so pasting more rows than
 * there are remaining students is truncated rather than overflowing past
 * the last row. Every row is validated independently with the same rule
 * as a single-cell edit (parseScoreInput), so a caller can apply only
 * the valid rows and report the rest without corrupting anything already
 * saved for students outside the pasted range or on an invalid row.
 */
export function planScorePaste(
  rawClipboardText: string,
  startIndex: number,
  rosterIds: string[],
  maxScore: number,
): PasteScorePlanRow[] {
  const values = parsePastedScores(rawClipboardText)
  const targetIds = rosterIds.slice(startIndex, startIndex + values.length)
  return targetIds.map((studentId, i) => {
    const raw = values[i]
    const { value, error } = parseScoreInput(raw, maxScore)
    return { studentId, raw, value, error }
  })
}

/**
 * Whether applying "ใส่คะแนนหลายคน" (bulk fill) to the given selected
 * students would overwrite at least one already-graded score — the
 * assignment detail page uses this to decide whether a confirm-before-
 * overwrite step is needed. A student with no score yet (null) is never
 * a reason to confirm; only an existing, actual score is.
 */
export function bulkFillWouldOverwrite(
  selectedIds: string[],
  submissions: Record<string, AssignmentSubmission>,
): boolean {
  return selectedIds.some((id) => submissions[id]?.score !== null && submissions[id]?.score !== undefined)
}

export type ScoreNavKey = 'Enter' | 'ArrowDown' | 'ArrowUp'

/**
 * Given a keypress on a score cell and its row index, returns the row
 * index the score input focus should move to next. Enter advances to
 * the next row, except on the LAST row — there it returns the same
 * index, so "save and keep focus there" instead of nowhere. ArrowDown/
 * ArrowUp clamp to the roster's bounds (never past the first/last row)
 * rather than wrapping or throwing, so a caller can tell "did this
 * actually move" by comparing the result to the row it started from —
 * and leave the native number-input spinner behavior alone at a
 * boundary where there's nowhere further to go.
 */
export function nextScoreFocusIndex(key: ScoreNavKey, rowIndex: number, rosterLength: number): number {
  if (rosterLength <= 0) return rowIndex
  if (key === 'Enter') {
    return rowIndex + 1 < rosterLength ? rowIndex + 1 : rowIndex
  }
  if (key === 'ArrowDown') {
    return Math.min(rowIndex + 1, rosterLength - 1)
  }
  return Math.max(rowIndex - 1, 0)
}

/**
 * The Grades roster — every currently-active classroom member, PLUS any
 * member who has since been archived but already has a submission row
 * for at least one of this classroom's assignments. Same rule, same
 * rationale, as deriveAssignmentRoster above, generalized across every
 * assignment shown in the Grades tab instead of just one.
 */
export function deriveGradeRoster<T extends { id: string; status: 'active' | 'inactive' }>(
  students: T[],
  submissionsByAssignment: Record<string, Record<string, AssignmentSubmission>>,
): T[] {
  return students.filter(
    (student) =>
      student.status === 'active' ||
      Object.values(submissionsByAssignment).some((submissions) => submissions[student.id] !== undefined),
  )
}

export interface StudentGradeRow {
  studentId: string
  /** assignmentId -> score, or null if that assignment isn't graded yet for this student. */
  scoresByAssignment: Record<string, number | null>
  /** assignmentId -> that submission's status (defaults to 'not_submitted' if no row exists yet). */
  statusByAssignment: Record<string, SubmissionStatus>
  /** Sum of every graded score for this student. */
  total: number
  /** Sum of every assignment's max_score in this classroom — the same
   * fixed denominator for every student, regardless of how many of their
   * assignments are actually graded yet (an ungraded assignment still
   * counts toward what's possible, it just hasn't been earned). */
  possible: number
  /** total/possible as 0-100, or null when this classroom has no
   * assignments yet (possible === 0, avoids a divide-by-zero). */
  percentage: number | null
}

/**
 * Builds one row per student — the matrix the Grades tab renders
 * (student × assignment → score) plus the derived total/possible/
 * percentage columns. `assignments` and `submissionsByAssignment` must
 * already be scoped to exactly one subject+classroom (getAssignments'
 * own scoping guarantees this) — never pass in another classroom's data,
 * or its scores would be silently blended into this one's totals.
 */
export function computeGradeRows(
  studentIds: string[],
  assignments: Assignment[],
  submissionsByAssignment: Record<string, Record<string, AssignmentSubmission>>,
): StudentGradeRow[] {
  const possible = assignments.reduce((sum, a) => sum + a.maxScore, 0)

  return studentIds.map((studentId) => {
    const scoresByAssignment: Record<string, number | null> = {}
    const statusByAssignment: Record<string, SubmissionStatus> = {}
    let total = 0

    for (const assignment of assignments) {
      const submission = submissionsByAssignment[assignment.id]?.[studentId]
      const score = submission?.score ?? null
      scoresByAssignment[assignment.id] = score
      statusByAssignment[assignment.id] = submission?.status ?? 'not_submitted'
      if (score !== null) total += score
    }

    const percentage = possible > 0 ? (total / possible) * 100 : null
    return { studentId, scoresByAssignment, statusByAssignment, total, possible, percentage }
  })
}

export interface ClassGradeStats {
  /** Average of every student's percentage, or null if the classroom has
   * no assignments yet. */
  classAverage: number | null
  highest: number | null
  lowest: number | null
}

/** Class-wide stats derived from computeGradeRows' output — never
 * persisted, always recomputed from the same rows the table renders, so
 * there is nothing that can drift out of sync with the table. */
export function computeClassGradeStats(rows: StudentGradeRow[]): ClassGradeStats {
  const percentages = rows.map((r) => r.percentage).filter((p): p is number => p !== null)
  if (percentages.length === 0) return { classAverage: null, highest: null, lowest: null }

  return {
    classAverage: percentages.reduce((a, b) => a + b, 0) / percentages.length,
    highest: Math.max(...percentages),
    lowest: Math.min(...percentages),
  }
}

// ==================================================
// Assignment detail page navigation — "งานอื่นในห้องนี้" switcher +
// งานก่อนหน้า/งานถัดไป. Pure functions over the exact list
// getAssignments(subjectId, classroomId) already returns (RLS-scoped,
// same query the งาน tab itself uses — no new query shape), so every
// isolation guarantee (own subject+classroom only, never another
// teacher's) is inherited from that existing, already-verified query
// rather than re-implemented here.
// ==================================================

/** Assignments eligible for the switcher/prev-next — active
 * (non-archived) only, in the SAME order getAssignments already returns
 * them (created_at ascending) — never re-sorted, so the switcher always
 * agrees with the งาน tab's own ordering. */
export function filterActiveAssignmentsForSwitcher(assignments: Assignment[]): Assignment[] {
  return assignments.filter((a) => !a.isArchived)
}

/** -1 when the current assignment isn't in the (active-only) list at all
 * — e.g. the assignment being viewed is itself archived — in which case
 * there is deliberately no "current" mark and no previous/next. */
export function findSwitcherIndex(activeAssignments: Assignment[], currentAssignmentId: string): number {
  return activeAssignments.findIndex((a) => a.id === currentAssignmentId)
}

/** Null at the start of the list (or when the current assignment isn't
 * in it) — never wraps to the last assignment. */
export function getPreviousAssignment(activeAssignments: Assignment[], currentAssignmentId: string): Assignment | null {
  const index = findSwitcherIndex(activeAssignments, currentAssignmentId)
  return index > 0 ? activeAssignments[index - 1] : null
}

/** Null at the end of the list (or when the current assignment isn't in
 * it) — never wraps to the first assignment. */
export function getNextAssignment(activeAssignments: Assignment[], currentAssignmentId: string): Assignment | null {
  const index = findSwitcherIndex(activeAssignments, currentAssignmentId)
  return index !== -1 && index < activeAssignments.length - 1 ? activeAssignments[index + 1] : null
}
