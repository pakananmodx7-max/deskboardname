import { getAttendanceSummaryReport, getDefaultReportFilters, getGradeSummaryReport, getMissingAssignmentReport } from '@/services/report-service'
import { computeFollowUpReport } from '@/services/followup-report-service'
import { getAttendanceSummary } from '@/services/attendance-service'
import { getClassrooms } from '@/services/classroom-service'
import { getStudentsByClassroom } from '@/services/student-service'
import { getSupabaseClient } from '@/lib/supabase'
import { getSubjects } from '@/services/subject-service'
import type { AttendanceRecord, AttendanceStatus, AttendanceSummary } from '@/types/attendance'
import type { SubmissionStatus } from '@/types/assignment'
import type { Classroom } from '@/types/classroom'
import type { FollowUpRow } from '@/types/report'

/**
 * Service layer for /teacher/dashboard — the Control Center. Every
 * function here reads exclusively through this schema's existing RLS
 * (teacher_id = auth.uid(), transitively via classroom ownership on
 * attendance/assignments/students/subjects — unchanged by this file, see
 * docs/DATABASE.md) and NEVER falls back to any demo/mock source. No new
 * table, no new migration — this is entirely built from data the app
 * already reads elsewhere (report-service.ts's already-verified
 * attendance/grade/missing-assignment queries, classroom-service.ts,
 * subject-service.ts, student-service.ts).
 */

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

// ==================================================
// Top summary
// ==================================================

export interface DashboardOverview {
  classroomCount: number
  activeClassroomCount: number
  /** Every student row visible via students_select_via_classroom (0001)
   * — i.e. every distinct student enrolled in at least one of this
   * teacher's classrooms, active or archived. */
  studentCount: number
  subjectCount: number
}

export async function getDashboardOverview(): Promise<DashboardOverview> {
  const supabase = getSupabaseClient()
  const [classroomsResult, studentsResult, subjectsResult] = await Promise.all([
    supabase.from('classrooms').select('id, is_active'),
    supabase.from('students').select('id', { count: 'exact', head: true }),
    supabase.from('subjects').select('id', { count: 'exact', head: true }),
  ])
  if (classroomsResult.error) throw classroomsResult.error
  if (studentsResult.error) throw studentsResult.error
  if (subjectsResult.error) throw subjectsResult.error

  const classrooms = classroomsResult.data as { id: string; is_active: boolean }[]
  return {
    classroomCount: classrooms.length,
    activeClassroomCount: classrooms.filter((c) => c.is_active).length,
    studentCount: studentsResult.count ?? 0,
    subjectCount: subjectsResult.count ?? 0,
  }
}

export interface ClassroomWithStudentCount extends Classroom {
  studentCount: number
}

/**
 * Every active classroom plus its current member count — same
 * per-classroom-count pattern as getSubjectClassroomsWithCounts
 * (subject-service.ts), reused here for the dashboard's classroom list
 * and as the roster-size source for the assignment action center below.
 */
export async function getClassroomsWithStudentCounts(): Promise<ClassroomWithStudentCount[]> {
  const classrooms = (await getClassrooms()).filter((c) => c.isActive)
  const counts = await Promise.all(classrooms.map((c) => getStudentsByClassroom(c.id)))
  return classrooms.map((c, i) => ({ ...c, studentCount: counts[i].length }))
}

export interface ClassroomListItem {
  classroomId: string
  classroomName: string
  subjectNames: string[]
  studentCount: number
}

/**
 * Pure — pairs each active classroom with the names of every active
 * subject linked to it (subject_classrooms), for the Home page's
 * "ห้องเรียนของฉัน" list. Built the same way getTodaySubjectAttendanceStatus
 * builds its pairs: one batch link query joined client-side, never one
 * getClassroomSubjects call per classroom.
 */
export function buildClassroomListItems(
  classrooms: ClassroomWithStudentCount[],
  links: { subjectId: string; classroomId: string }[],
  subjectNameById: Map<string, string>,
): ClassroomListItem[] {
  const subjectNamesByClassroom = new Map<string, string[]>()
  for (const link of links) {
    const name = subjectNameById.get(link.subjectId)
    if (!name) continue
    const list = subjectNamesByClassroom.get(link.classroomId) ?? []
    list.push(name)
    subjectNamesByClassroom.set(link.classroomId, list)
  }

  return classrooms.map((c) => ({
    classroomId: c.id,
    classroomName: c.name,
    subjectNames: subjectNamesByClassroom.get(c.id) ?? [],
    studentCount: c.studentCount,
  }))
}

/** Every active classroom plus its linked subject names and student
 * count, in 3 queries total regardless of classroom count — the Home
 * page's "ห้องเรียนของฉัน" data source. */
export async function getClassroomListItems(): Promise<ClassroomListItem[]> {
  const supabase = getSupabaseClient()
  const [classrooms, subjects, linksResult] = await Promise.all([
    getClassroomsWithStudentCounts(),
    getSubjects(),
    supabase.from('subject_classrooms').select('subject_id, classroom_id'),
  ])
  if (linksResult.error) throw linksResult.error

  const activeSubjectNameById = new Map(subjects.filter((s) => s.isActive).map((s) => [s.id, s.name]))
  const links = (linksResult.data as { subject_id: string; classroom_id: string }[]).map((l) => ({
    subjectId: l.subject_id,
    classroomId: l.classroom_id,
  }))

  return buildClassroomListItems(classrooms, links, activeSubjectNameById)
}

// ==================================================
// Today's Attendance ("การเช็คชื่อวันนี้") — one row per active
// subject+classroom pair, never the dead classroom-level homeroom path
// (subject_id IS NULL) — see AttendanceTab/attendance-service.ts:
// real attendance is exclusively taken from a subject's เช็คชื่อ tab now,
// so a homeroom-scoped query would always show "not taken" even on a
// classroom the teacher checked today, which is exactly the bug this
// replaces (the previous dashboard's "ภาพรวมการเข้าเรียนวันนี้" widget
// queried getAttendance(classroomId, today) with its homeroom default,
// i.e. subject_id = null, a session shape the real app no longer ever
// creates).
// ==================================================

export interface SubjectClassroomPair {
  subjectId: string
  subjectName: string
  classroomId: string
  classroomName: string
}

export interface TodayAttendanceStatus extends SubjectClassroomPair {
  status: 'taken' | 'not_taken'
  recordCount: number
}

interface TodaySessionInfo {
  subjectId: string
  classroomId: string
  recordCount: number
}

/**
 * Pure — one status row per pair, "not taken" pairs sorted first (the
 * ones needing action), then alphabetically by classroom name.
 */
export function buildTodayAttendanceStatuses(
  pairs: SubjectClassroomPair[],
  sessions: TodaySessionInfo[],
): TodayAttendanceStatus[] {
  const recordCountByPair = new Map<string, number>()
  for (const session of sessions) {
    const key = `${session.subjectId}:${session.classroomId}`
    recordCountByPair.set(key, (recordCountByPair.get(key) ?? 0) + session.recordCount)
  }

  return pairs
    .map((pair) => {
      const key = `${pair.subjectId}:${pair.classroomId}`
      const recordCount = recordCountByPair.get(key)
      return { ...pair, status: recordCount !== undefined ? ('taken' as const) : ('not_taken' as const), recordCount: recordCount ?? 0 }
    })
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'not_taken' ? -1 : 1
      return a.classroomName.localeCompare(b.classroomName, 'th')
    })
}

/** Fetches today's status for every active subject+classroom link in
 * exactly 3 queries total, regardless of how many pairs exist (classroom/
 * subject/link lookup, today's sessions, today's records) — no N+1.
 * Pass `classroomId` to scope the result to one classroom (used by the
 * Classroom Workspace's own ภาพรวม tab) — filtered client-side after the
 * same 3 queries, never a separate narrower query, so the two callers
 * can never see different underlying data. */
export async function getTodaySubjectAttendanceStatus(classroomId?: string): Promise<TodayAttendanceStatus[]> {
  const supabase = getSupabaseClient()
  const today = toIso(new Date())

  const [classrooms, subjects, linksResult] = await Promise.all([
    getClassrooms(),
    getSubjects(),
    supabase.from('subject_classrooms').select('subject_id, classroom_id'),
  ])
  if (linksResult.error) throw linksResult.error

  const activeClassroomById = new Map(classrooms.filter((c) => c.isActive).map((c) => [c.id, c]))
  const activeSubjectById = new Map(subjects.filter((s) => s.isActive).map((s) => [s.id, s]))

  const pairs: SubjectClassroomPair[] = (linksResult.data as { subject_id: string; classroom_id: string }[])
    .filter((link) => activeClassroomById.has(link.classroom_id) && activeSubjectById.has(link.subject_id))
    .filter((link) => !classroomId || link.classroom_id === classroomId)
    .map((link) => ({
      subjectId: link.subject_id,
      subjectName: activeSubjectById.get(link.subject_id)!.name,
      classroomId: link.classroom_id,
      classroomName: activeClassroomById.get(link.classroom_id)!.name,
    }))

  if (pairs.length === 0) return []

  const { data: sessionData, error: sessionError } = await supabase
    .from('attendance_sessions')
    .select('id, subject_id, classroom_id')
    .eq('attendance_date', today)
    .not('subject_id', 'is', null)
  if (sessionError) throw sessionError
  const sessionRows = sessionData as { id: string; subject_id: string; classroom_id: string }[]

  let recordCountBySession = new Map<string, number>()
  if (sessionRows.length > 0) {
    const { data: recordData, error: recordError } = await supabase
      .from('attendance_records')
      .select('attendance_session_id')
      .in(
        'attendance_session_id',
        sessionRows.map((s) => s.id),
      )
    if (recordError) throw recordError
    for (const row of recordData as { attendance_session_id: string }[]) {
      recordCountBySession.set(row.attendance_session_id, (recordCountBySession.get(row.attendance_session_id) ?? 0) + 1)
    }
  }

  const sessions: TodaySessionInfo[] = sessionRows.map((s) => ({
    subjectId: s.subject_id,
    classroomId: s.classroom_id,
    recordCount: recordCountBySession.get(s.id) ?? 0,
  }))

  return buildTodayAttendanceStatuses(pairs, sessions)
}

/**
 * Today's attendance records, tallied by status, across every
 * subject+classroom attendance session recorded today — the donut
 * chart's data source ("สถานะการเข้าเรียนวันนี้"). Reuses
 * attendance-service.ts's own getAttendanceSummary tally (the exact
 * function the live roster/summary card uses) rather than a
 * re-implemented count; each row is keyed by `${sessionId}:${studentId}`
 * so a student checked in more than one session today (e.g. two
 * subjects) is never silently collapsed into one entry the way a
 * plain student_id key would. Returns an all-zero summary — never
 * fabricated non-zero numbers — when nothing has been recorded yet
 * today; the caller shows a truthful empty state in that case.
 */
export async function getTodayAttendanceSummary(): Promise<AttendanceSummary> {
  const supabase = getSupabaseClient()
  const today = toIso(new Date())

  const { data: sessionRows, error: sessionError } = await supabase
    .from('attendance_sessions')
    .select('id')
    .eq('attendance_date', today)
  if (sessionError) throw sessionError

  const sessionIds = (sessionRows as { id: string }[]).map((s) => s.id)
  if (sessionIds.length === 0) return { present: 0, late: 0, leave: 0, absent: 0, total: 0 }

  const { data: recordRows, error: recordError } = await supabase
    .from('attendance_records')
    .select('attendance_session_id, student_id, status, note')
    .in('attendance_session_id', sessionIds)
  if (recordError) throw recordError

  const records: Record<string, AttendanceRecord> = {}
  for (const row of recordRows as { attendance_session_id: string; student_id: string; status: AttendanceStatus; note: string | null }[]) {
    records[`${row.attendance_session_id}:${row.student_id}`] = { studentId: row.student_id, status: row.status, note: row.note }
  }
  return getAttendanceSummary(records)
}

// ==================================================
// Assignment Action Center ("งานที่ต้องจัดการ")
// ==================================================

export interface AssignmentActionItem {
  assignmentId: string
  title: string
  subjectId: string
  subjectName: string
  classroomId: string
  classroomName: string
  dueDate: string | null
  submittedCount: number
  totalCount: number
  missingCount: number
  ungradedCount: number
}

interface RawSubmissionStatusScore {
  status: SubmissionStatus
  score: number | null
}

/**
 * Pure — one summary per assignment. "Missing" mirrors
 * report-service.ts's Missing Assignment definition exactly (any status
 * other than 'submitted' counts, including a student with no submission
 * row at all, who defaults to 'not_submitted'). "Ungraded" is the
 * grading-backlog signal: submitted, but score is still null.
 */
export function computeAssignmentActionItem(
  assignment: { id: string; title: string; subjectId: string; classroomId: string; dueDate: string | null },
  submissions: RawSubmissionStatusScore[],
  totalCount: number,
  subjectName: string,
  classroomName: string,
): AssignmentActionItem {
  const submittedCount = submissions.filter((s) => s.status === 'submitted').length
  const ungradedCount = submissions.filter((s) => s.status === 'submitted' && s.score === null).length
  return {
    assignmentId: assignment.id,
    title: assignment.title,
    subjectId: assignment.subjectId,
    subjectName,
    classroomId: assignment.classroomId,
    classroomName,
    dueDate: assignment.dueDate,
    submittedCount,
    totalCount,
    missingCount: Math.max(totalCount - submittedCount, 0),
    ungradedCount,
  }
}

/** Every non-archived assignment in an active classroom, with its
 * submission summary — 3 queries total (assignments, classroom rosters
 * via getClassroomsWithStudentCounts, all submissions in one `in(...)`
 * call), never one round trip per assignment. Pass `classroomId` to
 * scope to one classroom (filtered client-side after the same fetch —
 * see getTodaySubjectAttendanceStatus's doc comment for why). */
export async function getAssignmentActionItems(classroomId?: string): Promise<AssignmentActionItem[]> {
  const supabase = getSupabaseClient()

  const [assignmentsResult, subjects, classroomsWithCounts] = await Promise.all([
    supabase.from('assignments').select('id, subject_id, classroom_id, title, due_date').eq('is_archived', false),
    getSubjects(),
    getClassroomsWithStudentCounts(),
  ])
  if (assignmentsResult.error) throw assignmentsResult.error

  const assignments = assignmentsResult.data as {
    id: string
    subject_id: string
    classroom_id: string
    title: string
    due_date: string | null
  }[]
  if (assignments.length === 0) return []

  const subjectNameById = new Map(subjects.map((s) => [s.id, s.name]))
  const classroomById = new Map(classroomsWithCounts.map((c) => [c.id, c]))

  const { data: submissionData, error: submissionError } = await supabase
    .from('assignment_submissions')
    .select('assignment_id, status, score')
    .in(
      'assignment_id',
      assignments.map((a) => a.id),
    )
  if (submissionError) throw submissionError

  const submissionsByAssignment = new Map<string, RawSubmissionStatusScore[]>()
  for (const row of submissionData as { assignment_id: string; status: SubmissionStatus; score: number | null }[]) {
    const list = submissionsByAssignment.get(row.assignment_id) ?? []
    list.push({ status: row.status, score: row.score })
    submissionsByAssignment.set(row.assignment_id, list)
  }

  const items: AssignmentActionItem[] = []
  for (const a of assignments) {
    // An assignment whose classroom is no longer active is skipped —
    // the action center is about what's currently actionable, and an
    // archived classroom's roster is intentionally excluded from
    // getClassroomsWithStudentCounts already.
    const classroom = classroomById.get(a.classroom_id)
    if (!classroom) continue
    if (classroomId && a.classroom_id !== classroomId) continue

    items.push(
      computeAssignmentActionItem(
        { id: a.id, title: a.title, subjectId: a.subject_id, classroomId: a.classroom_id, dueDate: a.due_date },
        submissionsByAssignment.get(a.id) ?? [],
        classroom.studentCount,
        subjectNameById.get(a.subject_id) ?? '-',
        classroom.name,
      ),
    )
  }
  return items
}

const ATTENTION_PAST_WINDOW_DAYS = 30
const ATTENTION_FUTURE_WINDOW_DAYS = 14
const ATTENTION_MAX_ITEMS = 10

/**
 * Pure — "งานที่ต้องจัดการ": an assignment with missing submissions or
 * ungraded work, either due-date-less (always current) or due within
 * [-30, +14] days of `now`. The past/future window keeps this list
 * genuinely "what needs attention now" rather than resurfacing an
 * assignment from months ago forever just because one student never
 * submitted it.
 */
export function selectAssignmentsNeedingAttention(
  items: AssignmentActionItem[],
  now: Date = new Date(),
): AssignmentActionItem[] {
  const pastCutoff = toIso(addDays(now, -ATTENTION_PAST_WINDOW_DAYS))
  const futureCutoff = toIso(addDays(now, ATTENTION_FUTURE_WINDOW_DAYS))

  return items
    .filter((item) => {
      const needsWork = item.missingCount > 0 || item.ungradedCount > 0
      if (!needsWork) return false
      if (item.dueDate === null) return true
      return item.dueDate >= pastCutoff && item.dueDate <= futureCutoff
    })
    .sort((a, b) => (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99'))
    .slice(0, ATTENTION_MAX_ITEMS)
}

const UPCOMING_WINDOW_DAYS = 30
const UPCOMING_MAX_ITEMS = 8

/** Pure — the compact "upcoming" list (Section 6): every assignment due
 * from today through the next 30 days, soonest first. Derived entirely
 * from the same assignment data the action center already fetched — no
 * separate calendar table/query. */
export function selectUpcomingAssignments(items: AssignmentActionItem[], now: Date = new Date()): AssignmentActionItem[] {
  const todayStr = toIso(now)
  const cutoff = toIso(addDays(now, UPCOMING_WINDOW_DAYS))

  return items
    .filter((item) => item.dueDate !== null && item.dueDate >= todayStr && item.dueDate <= cutoff)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
    .slice(0, UPCOMING_MAX_ITEMS)
}

// ==================================================
// Students to Follow Up — reuses report-service.ts's own report
// functions and followup-report-service.ts's computeFollowUpReport
// VERBATIM (same imports, same getDefaultReportFilters() default
// filters Reports itself uses) — this is not a re-implementation, it is
// the literal same code path Reports runs, so the two surfaces can never
// drift apart.
// ==================================================

/** Pass `classroomId` to scope to one classroom's follow-up rows (used
 * by the Classroom Workspace's own ภาพรวม tab) — filtered client-side
 * after the same report calls Reports itself uses, never a separate
 * narrower query. */
export async function getDashboardFollowUpSummary(classroomId?: string): Promise<FollowUpRow[]> {
  const filters = getDefaultReportFilters()
  const [attendanceRows, missingRows, gradeGroups] = await Promise.all([
    getAttendanceSummaryReport(filters),
    getMissingAssignmentReport(filters),
    getGradeSummaryReport(filters),
  ])
  const rows = computeFollowUpReport(attendanceRows, missingRows, gradeGroups)
  return classroomId ? rows.filter((row) => row.classroomId === classroomId) : rows
}

// ==================================================
// Recent Activity — only truthful, timestamp-backed events: an
// assignment created/updated recently, or an attendance session saved
// recently. Deliberately does NOT include per-submission score-entry
// events (assignment_submissions has no per-row activity worth
// summarizing at the dashboard's granularity without a lot of extra
// grouping logic) — see the Control Center report for the full
// reasoning on what was scoped out and why.
// ==================================================

export interface RecentActivityItem {
  id: string
  message: string
  timestamp: string
}

interface RawAssignmentActivity {
  id: string
  title: string
  subjectName: string
  classroomName: string
  createdAt: string
  updatedAt: string
}

interface RawAttendanceActivity {
  id: string
  subjectName: string
  classroomName: string
  updatedAt: string
}

const RECENT_ACTIVITY_WINDOW_DAYS = 7
const RECENT_ACTIVITY_MAX_ITEMS = 8

/** Pure — merges both real event sources by timestamp, newest first. */
export function buildRecentActivityItems(
  assignments: RawAssignmentActivity[],
  sessions: RawAttendanceActivity[],
): RecentActivityItem[] {
  const items: RecentActivityItem[] = []

  for (const a of assignments) {
    const isNew = a.createdAt === a.updatedAt
    items.push({
      id: `assignment:${a.id}`,
      message: isNew
        ? `สร้างงานใหม่ "${a.title}" (${a.subjectName} · ${a.classroomName})`
        : `แก้ไขงาน "${a.title}" (${a.subjectName} · ${a.classroomName})`,
      timestamp: a.updatedAt,
    })
  }

  for (const s of sessions) {
    items.push({
      id: `attendance:${s.id}`,
      message: `บันทึกการเช็คชื่อ ${s.subjectName} · ${s.classroomName}`,
      timestamp: s.updatedAt,
    })
  }

  return items.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, RECENT_ACTIVITY_MAX_ITEMS)
}

export async function getRecentActivity(): Promise<RecentActivityItem[]> {
  const supabase = getSupabaseClient()
  const since = new Date(Date.now() - RECENT_ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const [assignmentsResult, sessionsResult, subjects, classrooms] = await Promise.all([
    supabase
      .from('assignments')
      .select('id, subject_id, classroom_id, title, created_at, updated_at')
      .eq('is_archived', false)
      .gte('updated_at', since),
    supabase
      .from('attendance_sessions')
      .select('id, subject_id, classroom_id, updated_at')
      .not('subject_id', 'is', null)
      .gte('updated_at', since),
    getSubjects(),
    getClassrooms(),
  ])
  if (assignmentsResult.error) throw assignmentsResult.error
  if (sessionsResult.error) throw sessionsResult.error

  const subjectNameById = new Map(subjects.map((s) => [s.id, s.name]))
  const classroomNameById = new Map(classrooms.map((c) => [c.id, c.name]))

  const assignments: RawAssignmentActivity[] = (
    assignmentsResult.data as { id: string; subject_id: string; classroom_id: string; title: string; created_at: string; updated_at: string }[]
  ).map((a) => ({
    id: a.id,
    title: a.title,
    subjectName: subjectNameById.get(a.subject_id) ?? '-',
    classroomName: classroomNameById.get(a.classroom_id) ?? '-',
    createdAt: a.created_at,
    updatedAt: a.updated_at,
  }))

  const sessions: RawAttendanceActivity[] = (
    sessionsResult.data as { id: string; subject_id: string; classroom_id: string; updated_at: string }[]
  ).map((s) => ({
    id: s.id,
    subjectName: subjectNameById.get(s.subject_id) ?? '-',
    classroomName: classroomNameById.get(s.classroom_id) ?? '-',
    updatedAt: s.updated_at,
  }))

  return buildRecentActivityItems(assignments, sessions)
}
