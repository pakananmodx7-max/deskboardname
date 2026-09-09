import { getSupabaseClient } from '@/lib/supabase'
import type { AttendanceStatus, AttendanceSummary } from '@/types/attendance'
import type { SubmissionStatus } from '@/types/assignment'
import type {
  MyAssignment,
  MyAttendanceRecord,
  MyCalendarEntry,
  MyCalendarItem,
  MyClassroom,
  MyNotification,
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
 *
 * OPTIONAL SCHEMA (0012) — student_calendar_entries,
 * teacher_student_notifications, and students.avatar_path all come from
 * 0012_student_calendar_notifications.sql, which is written but NOT YET
 * APPLIED to production (Calendar/Notifications/Avatar were paused
 * mid-build). Every function that touches one of those three MUST
 * degrade gracefully — never throw — when the underlying column/table
 * doesn't exist yet, via isMissingOptionalColumnError/
 * isOptionalTableMissingError below, so the rest of the student portal
 * (identity, subjects, assignments, attendance, grades — none of which
 * depend on 0012 at all) keeps working normally regardless of whether
 * 0012 has been applied. See docs/DATABASE.md's Phase 15/0012 sections
 * for the full feature scope this gates.
 */

const UNDEFINED_COLUMN = '42703'
const UNDEFINED_TABLE = '42P01'

/** True for the exact Postgres error raised when a SELECT names a column
 * that doesn't exist yet on this database — specifically
 * students.avatar_path before 0012 is applied. Pure so the fallback
 * trigger condition is unit-tested without a live Supabase call. */
export function isMissingOptionalColumnError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === UNDEFINED_COLUMN
}

/** True for the exact Postgres error raised when a query names a table
 * that doesn't exist yet — student_calendar_entries or
 * teacher_student_notifications before 0012 is applied. Pure, same
 * reasoning as isMissingOptionalColumnError above. */
export function isOptionalTableMissingError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === UNDEFINED_TABLE
}

interface StudentRow {
  id: string
  student_code: string | null
  number: number | null
  first_name: string
  last_name: string
  nickname: string | null
  avatar_path: string | null
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
 *
 * This is THE gate StudentLayout calls before rendering any /student/*
 * page — so avatar_path (0012, possibly not applied yet) must never make
 * this whole function fail. If the primary select is rejected because
 * that column doesn't exist yet, it retries without it and returns
 * avatarPath: null (the same value an approved student who simply hasn't
 * uploaded an avatar yet would get once 0012 IS applied) — every other
 * field is completely unaffected either way.
 */
export async function getMyStudentProfile(): Promise<MyStudentProfile | null> {
  const supabase = getSupabaseClient()
  const primary = await supabase
    .from('students')
    .select('id, student_code, number, first_name, last_name, nickname, avatar_path')
    .maybeSingle()

  if (primary.error && isMissingOptionalColumnError(primary.error)) {
    const fallback = await supabase
      .from('students')
      .select('id, student_code, number, first_name, last_name, nickname')
      .maybeSingle()
    if (fallback.error) throw fallback.error
    if (!fallback.data) return null

    const row = fallback.data as Omit<StudentRow, 'avatar_path'>
    return {
      id: row.id,
      studentCode: row.student_code,
      number: row.number,
      firstName: row.first_name,
      lastName: row.last_name,
      nickname: row.nickname,
      avatarPath: null,
    }
  }

  if (primary.error) throw primary.error
  if (!primary.data) return null

  const row = primary.data as StudentRow
  return {
    id: row.id,
    studentCode: row.student_code,
    number: row.number,
    firstName: row.first_name,
    lastName: row.last_name,
    nickname: row.nickname,
    avatarPath: row.avatar_path,
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

export interface MyTodoSummary {
  /** งานค้าง — every not-yet-submitted assignment (same set as
   * getPendingAssignments). */
  outstanding: number
  /** ใกล้กำหนด — the outstanding subset due within DUE_SOON_WINDOW_DAYS
   * (an already-overdue due date counts too — it's more urgent, not
   * less). */
  dueSoon: number
  /** ส่งแล้ว — status 'submitted' only, matching this app's existing
   * status semantics (see assignment-service.ts: 'late'/'missing' are
   * teacher-set outcomes, not "already turned in"). */
  submitted: number
}

const DUE_SOON_WINDOW_DAYS = 3

/** Pure — the dashboard's "งานของฉัน" summary. `now` is injectable so the
 * due-soon window is unit-testable without mocking the system clock. */
export function summarizeMyTodo(assignments: MyAssignment[], now: Date = new Date()): MyTodoSummary {
  const pending = getPendingAssignments(assignments)
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() + DUE_SOON_WINDOW_DAYS)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  return {
    outstanding: pending.length,
    dueSoon: pending.filter((a) => a.dueDate !== null && a.dueDate <= cutoffStr).length,
    submitted: assignments.filter((a) => a.status === 'submitted').length,
  }
}

// ==================================================
// Personal calendar (student_calendar_entries, 0012) — strictly own-row
// CRUD, reads/writes exclusively through the RLS added there. Assignment
// due dates are never stored here; mergeCalendarItems (below) combines
// them with getMyAssignments' results client-side for display only.
// ==================================================

interface CalendarEntryRow {
  id: string
  title: string
  note: string | null
  event_date: string
  event_time: string | null
  created_at: string
  updated_at: string
}

function mapCalendarEntry(row: CalendarEntryRow): MyCalendarEntry {
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    eventDate: row.event_date,
    eventTime: row.event_time,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Returns an empty list, never throws, when student_calendar_entries
 * doesn't exist yet (0012 not applied) — the calendar widget then reads
 * as "no notes yet" (inert) rather than a scary error card, matching
 * "optional/inactive until 0012 is deliberately enabled." A real error
 * once 0012 IS applied (a genuine RLS/network failure) still throws
 * normally, surfaced by the widget's own error state.
 */
export async function getMyCalendarEntries(): Promise<MyCalendarEntry[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('student_calendar_entries')
    .select('id, title, note, event_date, event_time, created_at, updated_at')
    .order('event_date', { ascending: true })

  if (error) {
    if (isOptionalTableMissingError(error)) return []
    throw error
  }
  return (data as CalendarEntryRow[]).map(mapCalendarEntry)
}

export interface CalendarEntryInput {
  title: string
  note?: string | null
  eventDate: string
  eventTime?: string | null
}

/** Resolves the caller's own students.id the same way every other write
 * in this file resolves it — by reading it back through
 * students_select_own_linked (0011), never by accepting it as a
 * parameter from the caller. Thrown error matches the "not an approved
 * student" case StudentLayout already guards against, so this should
 * only ever fire if a write is attempted from somewhere that skipped
 * that guard. */
async function requireMyStudentId(): Promise<string> {
  const profile = await getMyStudentProfile()
  if (!profile) throw new Error('คุณไม่มีสิทธิ์ดำเนินการนี้')
  return profile.id
}

export async function createMyCalendarEntry(input: CalendarEntryInput): Promise<MyCalendarEntry> {
  const supabase = getSupabaseClient()
  const studentId = await requireMyStudentId()
  const { data, error } = await supabase
    .from('student_calendar_entries')
    .insert({
      student_id: studentId,
      title: input.title,
      note: input.note ?? null,
      event_date: input.eventDate,
      event_time: input.eventTime ?? null,
    })
    .select('id, title, note, event_date, event_time, created_at, updated_at')
    .single()

  if (error) throw error
  return mapCalendarEntry(data as CalendarEntryRow)
}

export async function updateMyCalendarEntry(id: string, input: CalendarEntryInput): Promise<MyCalendarEntry> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('student_calendar_entries')
    .update({
      title: input.title,
      note: input.note ?? null,
      event_date: input.eventDate,
      event_time: input.eventTime ?? null,
    })
    .eq('id', id)
    .select('id, title, note, event_date, event_time, created_at, updated_at')
    .single()

  if (error) throw error
  return mapCalendarEntry(data as CalendarEntryRow)
}

export async function deleteMyCalendarEntry(id: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.from('student_calendar_entries').delete().eq('id', id)
  if (error) throw error
}

/** Merges the student's private calendar notes with read-only assignment
 * due dates into one display list, newest-first-by-date. Pure — no
 * Supabase calls — so the merge/sort rule is unit-testable without a
 * live fetch. Assignments with no due date are excluded (nothing to
 * place on a calendar). */
export function mergeCalendarItems(entries: MyCalendarEntry[], assignments: MyAssignment[]): MyCalendarItem[] {
  const items: MyCalendarItem[] = [
    ...entries.map((entry): MyCalendarItem => ({ kind: 'note', entry })),
    ...assignments
      .filter((a): a is MyAssignment & { dueDate: string } => a.dueDate !== null)
      .map(
        (a): MyCalendarItem => ({
          kind: 'assignment-due',
          assignmentId: a.id,
          title: a.title,
          subjectName: a.subjectName,
          eventDate: a.dueDate,
        }),
      ),
  ]
  return items.sort((a, b) => {
    const dateA = a.kind === 'note' ? a.entry.eventDate : a.eventDate
    const dateB = b.kind === 'note' ? b.entry.eventDate : b.eventDate
    return dateA.localeCompare(dateB)
  })
}

// ==================================================
// Teacher -> student notifications (teacher_student_notifications, 0012)
// — read-only + mark-read from the student side; sending is
// teacher-side, see notification-service.ts.
// ==================================================

interface NotificationRow {
  id: string
  teacher_id: string
  title: string | null
  message: string
  read_at: string | null
  created_at: string
}

/**
 * Every notification addressed to the signed-in student, newest first,
 * with the sending teacher's display_name resolved via a second,
 * independently-scoped query against profiles (readable for exactly
 * these teacher_id values thanks to profiles_select_my_teachers, 0012) —
 * same "plain queries + client-side merge" convention as
 * getMySubjects/getMyAssignments above, rather than an embedded
 * PostgREST join.
 */
export async function getMyNotifications(): Promise<MyNotification[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('teacher_student_notifications')
    .select('id, teacher_id, title, message, read_at, created_at')
    .order('created_at', { ascending: false })
  if (error) {
    // teacher_student_notifications doesn't exist yet (0012 not
    // applied) — the bell/dashboard "ข้อความจากครู" widget then reads as
    // "no messages yet" (inert) rather than a scary error, same
    // reasoning as getMyCalendarEntries above.
    if (isOptionalTableMissingError(error)) return []
    throw error
  }

  const rows = data as NotificationRow[]
  const teacherIds = [...new Set(rows.map((r) => r.teacher_id))]
  const nameByTeacherId = new Map<string, string>()
  if (teacherIds.length > 0) {
    const { data: profileRows, error: profileError } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', teacherIds)
    if (profileError) throw profileError
    for (const p of profileRows as { id: string; display_name: string | null }[]) {
      nameByTeacherId.set(p.id, p.display_name ?? 'ครู')
    }
  }

  return rows.map((row) => ({
    id: row.id,
    senderName: nameByTeacherId.get(row.teacher_id) ?? 'ครู',
    title: row.title,
    message: row.message,
    readAt: row.read_at,
    createdAt: row.created_at,
  }))
}

/** Pure — used by the notification bell badge and the dashboard's
 * "ข้อความจากครู" section. */
export function countUnreadNotifications(notifications: MyNotification[]): number {
  return notifications.filter((n) => n.readAt === null).length
}

/** Marks exactly one of the caller's own notifications read, via the
 * mark_notification_read RPC (0012) — never a raw UPDATE, since there is
 * no UPDATE policy on this table for students to begin with. */
export async function markNotificationRead(id: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.rpc('mark_notification_read', { p_notification_id: id })
  if (error) throw error
}

export async function markAllNotificationsRead(): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.rpc('mark_all_notifications_read')
  if (error) throw error
}

// ==================================================
// Avatar (Supabase Storage 'avatars' bucket + students.avatar_path,
// 0012) — upload always writes to a fixed, own-student-id-prefixed path
// (never a client-chosen name beyond the file extension), then records
// that path via update_my_avatar_path, which independently re-validates
// the same own-id prefix server-side.
// ==================================================

const AVATAR_BUCKET = 'avatars'
const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const AVATAR_ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export class InvalidAvatarFileError extends Error {}

/** Client-side pre-check mirroring the storage bucket's own
 * file_size_limit/allowed_mime_types (0012) — this is a UX nicety (fail
 * fast, no wasted upload) and NOT the security boundary; Storage itself
 * enforces both independently no matter what this function does. Pure,
 * so it's unit-testable without a File/Blob upload. */
export function validateAvatarFile(file: { type: string; size: number }): string | null {
  if (!(file.type in AVATAR_ALLOWED_TYPES)) {
    return 'รองรับเฉพาะไฟล์รูปภาพ JPG, PNG หรือ WEBP เท่านั้น'
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return 'ขนาดไฟล์ต้องไม่เกิน 2MB'
  }
  return null
}

/** Uploads a new avatar image and records its path on the student's own
 * row. Returns the new avatar_path. Throws InvalidAvatarFileError (a
 * friendly Thai message) for a rejected file type/size before ever
 * calling Supabase. */
export async function uploadMyAvatar(file: File): Promise<string> {
  const validationError = validateAvatarFile(file)
  if (validationError) throw new InvalidAvatarFileError(validationError)

  const supabase = getSupabaseClient()
  const studentId = await requireMyStudentId()
  const ext = AVATAR_ALLOWED_TYPES[file.type]
  const path = `${studentId}/avatar.${ext}`

  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' })
  if (uploadError) throw uploadError

  const { error: rpcError } = await supabase.rpc('update_my_avatar_path', { p_avatar_path: path })
  if (rpcError) throw rpcError

  return path
}

/** Removes the avatar and reverts to fallback initials. */
export async function removeMyAvatar(currentPath: string | null): Promise<void> {
  const supabase = getSupabaseClient()
  const { error: rpcError } = await supabase.rpc('update_my_avatar_path', { p_avatar_path: null })
  if (rpcError) throw rpcError

  if (currentPath) {
    // Best-effort — the object being left behind (or already gone) never
    // blocks avatar_path itself from being cleared above.
    await supabase.storage.from(AVATAR_BUCKET).remove([currentPath]).catch(() => undefined)
  }
}

/** The bucket is public (see 0012's storage section) — this is a plain
 * URL construction, no network call, no auth required to resolve. */
export function getAvatarUrl(avatarPath: string): string {
  const supabase = getSupabaseClient()
  return supabase.storage.from(AVATAR_BUCKET).getPublicUrl(avatarPath).data.publicUrl
}

