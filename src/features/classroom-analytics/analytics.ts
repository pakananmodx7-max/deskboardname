/**
 * Classroom Analytics Dashboard ("ระบบจัดการห้องเรียน → ภาพรวม") — pure
 * calculation layer. Shared by the real (Supabase) and demo pages: both
 * adapt their data into AnalyticsDataset, and every number on the page
 * comes from the functions below, so the two modes can never disagree on
 * a rule.
 *
 * Attendance data model (0004/0005): an attendance_sessions row is one
 * roll call — either a homeroom day (subject_id null, one per classroom
 * per day) or a subject period (subject_id set, optionally period_number).
 * attendance_records holds one status per (session, student) — enforced
 * unique by the database; deduplicated here as well. There is no
 * "cancelled session" column, so a session only counts when it has
 * records, and records dated in the future are ignored as invalid.
 *
 * Attendance rate = present / recorded entries — the same rule as
 * report-service.ts's aggregateAttendanceSummary and Student Analytics,
 * so a student's rate is identical on every screen ("สาย" is recorded
 * separately and does not count as "มา").
 */

import type { Classroom } from '@/types/classroom'

// ==================================================
// Input model
// ==================================================

export type AttendanceStatus = 'present' | 'late' | 'leave' | 'absent'
export type SubmissionStatusValue = 'not_submitted' | 'submitted' | 'late' | 'missing'

export interface AnalyticsClassroom {
  id: string
  name: string
  academicYear: string | null
  semester: string | null
  isActive: boolean
  /** e.g. "ม.1" — used by the classroom section's grade filter. */
  gradeLevel?: string | null
}

export interface AnalyticsSubject {
  id: string
  name: string
  academicYear: string | null
  semester: string | null
}

export interface AnalyticsStudent {
  id: string
  firstName: string
  lastName: string
  studentCode: string | null
  number: number | null
  status: 'active' | 'inactive'
}

export interface AnalyticsMembership {
  studentId: string
  classroomId: string
}

export interface AnalyticsAttendanceRecord {
  sessionId: string
  classroomId: string
  /** null = homeroom (daily) roll call. */
  subjectId: string | null
  /** YYYY-MM-DD */
  date: string
  studentId: string
  status: AttendanceStatus
}

export interface AnalyticsAssignment {
  id: string
  classroomId: string
  subjectId: string
  title: string
  /** YYYY-MM-DD or ISO timestamp; null = no due date. */
  dueDate: string | null
}

export interface AnalyticsSubmission {
  assignmentId: string
  studentId: string
  status: SubmissionStatusValue
}

/** The teacher's classroom/subject context — loaded first, decides the
 * semester options. */
export interface AnalyticsContext {
  classrooms: AnalyticsClassroom[]
  subjects: AnalyticsSubject[]
  links: { subjectId: string; classroomId: string }[]
  /** Full classroom rows (real mode) — what the existing edit dialog
   * needs; absent in Demo Mode. */
  classroomRecords?: Classroom[]
}

export interface AnalyticsRoster {
  memberships: AnalyticsMembership[]
  students: AnalyticsStudent[]
}

export interface AnalyticsAssignmentData {
  assignments: AnalyticsAssignment[]
  submissions: AnalyticsSubmission[]
}

// ==================================================
// Configurable rules
// ==================================================

export const ANALYTICS_RULES = {
  /** Operational follow-up thresholds (absences in the selected semester)
   * — not a clinical or behavioral diagnosis. */
  RISK_MONITOR_ABSENCES: 5,
  RISK_HIGH_ABSENCES: 10,
  /** "Highest attendance" eligibility: at least this many recorded
   * sessions AND at least this share of the most-recorded student in the
   * same classroom — a student with 2 of 2 sessions is never ranked above
   * one with 39 of 40. */
  MIN_SESSIONS_FOR_TOP_ATTENDANCE: 5,
  MIN_COVERAGE_FOR_TOP_ATTENDANCE: 0.8,
  TOP_N: 5,
  /** Insights */
  DECLINE_POINTS: 10,
  DECLINE_MIN_RECORDS_PER_WINDOW: 10,
  LOW_WEEK_POINTS_BELOW_AVERAGE: 10,
  GOOD_ATTENDANCE_RATE: 90,
  HIGH_NON_SUBMISSION_SHARE: 0.3,
  MIN_ROSTER_FOR_SUBMISSION_INSIGHT: 5,
  MAX_INSIGHTS: 4,
} as const

// ==================================================
// Semester
// ==================================================

export const ALL_SEMESTERS = 'all'
/** Key of records that explicitly have no academic year and no semester. */
export const UNASSIGNED_SEMESTER = '|'

export interface SemesterOption {
  key: string
  label: string
  academicYear: string | null
  semester: string | null
}

export function semesterKey(academicYear: string | null, semester: string | null): string {
  return `${academicYear?.trim() ?? ''}|${semester?.trim() ?? ''}`
}

export function semesterLabel(academicYear: string | null, semester: string | null): string {
  const year = academicYear?.trim()
  const term = semester?.trim()
  if (year && term) return `ภาคเรียนที่ ${term}/${year}`
  if (year) return `ปีการศึกษา ${year}`
  if (term) return `ภาคเรียนที่ ${term}`
  return 'ไม่ระบุภาคเรียน'
}

function numeric(value: string | null): number {
  const n = Number.parseInt(value ?? '', 10)
  return Number.isFinite(n) ? n : -1
}

/** Every semester the teacher's classrooms (and subjects) belong to,
 * newest first, plus "ทุกภาคเรียน". */
export function listSemesterOptions(context: AnalyticsContext): SemesterOption[] {
  const byKey = new Map<string, SemesterOption>()
  for (const item of [...context.classrooms, ...context.subjects]) {
    const key = semesterKey(item.academicYear, item.semester)
    if (!byKey.has(key)) byKey.set(key, { key, label: semesterLabel(item.academicYear, item.semester), academicYear: item.academicYear, semester: item.semester })
  }
  const sorted = [...byKey.values()].sort(
    (a, b) => numeric(b.academicYear) - numeric(a.academicYear) || numeric(b.semester) - numeric(a.semester) || a.label.localeCompare(b.label, 'th'),
  )
  return [...sorted, { key: ALL_SEMESTERS, label: 'ทุกภาคเรียน', academicYear: null, semester: null }]
}

/** Newest semester that has an active classroom; otherwise newest
 * classroom semester; otherwise all. */
export function pickDefaultSemester(context: AnalyticsContext): string {
  const options = listSemesterOptions(context).filter((o) => o.key !== ALL_SEMESTERS)
  const active = new Set(context.classrooms.filter((c) => c.isActive).map((c) => semesterKey(c.academicYear, c.semester)))
  const classroomKeys = new Set(context.classrooms.map((c) => semesterKey(c.academicYear, c.semester)))
  return options.find((o) => active.has(o.key))?.key ?? options.find((o) => classroomKeys.has(o.key))?.key ?? ALL_SEMESTERS
}

export interface SemesterScope {
  key: string
  label: string
  classrooms: AnalyticsClassroom[]
  classroomIds: Set<string>
  subjects: AnalyticsSubject[]
}

/** Classrooms whose own academic year/semester match; subjects linked to
 * those classrooms or whose own year/semester match. */
export function resolveSemesterScope(context: AnalyticsContext, key: string): SemesterScope {
  const classrooms = key === ALL_SEMESTERS ? context.classrooms : context.classrooms.filter((c) => semesterKey(c.academicYear, c.semester) === key)
  const classroomIds = new Set(classrooms.map((c) => c.id))
  const linkedSubjectIds = new Set(context.links.filter((l) => classroomIds.has(l.classroomId)).map((l) => l.subjectId))
  const subjects =
    key === ALL_SEMESTERS
      ? context.subjects
      : context.subjects.filter((s) => linkedSubjectIds.has(s.id) || semesterKey(s.academicYear, s.semester) === key)
  const option = listSemesterOptions(context).find((o) => o.key === key)
  return { key, label: option?.label ?? 'ทุกภาคเรียน', classrooms, classroomIds, subjects }
}

// ==================================================
// Summary cards
// ==================================================

export interface DashboardSummary {
  uniqueStudents: number
  activeStudents: number
  activeClassrooms: number
  classroomsInScope: number
  subjects: number
}

export function computeSummary(scope: SemesterScope, roster: AnalyticsRoster): DashboardSummary {
  const studentIds = new Set(roster.memberships.filter((m) => scope.classroomIds.has(m.classroomId)).map((m) => m.studentId))
  const studentById = new Map(roster.students.map((s) => [s.id, s]))
  return {
    uniqueStudents: studentIds.size,
    activeStudents: [...studentIds].filter((id) => studentById.get(id)?.status !== 'inactive').length,
    activeClassrooms: scope.classrooms.filter((c) => c.isActive).length,
    classroomsInScope: scope.classrooms.length,
    subjects: scope.subjects.length,
  }
}

// ==================================================
// Attendance
// ==================================================

/** YYYY-MM-DD of `now` in local time — records after it are invalid. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const VALID_STATUSES: ReadonlySet<string> = new Set(['present', 'late', 'leave', 'absent'])

/** Only records in scope, with a valid status, not dated in the future,
 * one per (session, student). */
export function cleanAttendanceRecords(
  records: AnalyticsAttendanceRecord[],
  classroomIds: ReadonlySet<string>,
  today: string,
): AnalyticsAttendanceRecord[] {
  const seen = new Set<string>()
  const result: AnalyticsAttendanceRecord[] = []
  for (const r of records) {
    if (!classroomIds.has(r.classroomId)) continue
    if (!VALID_STATUSES.has(r.status)) continue
    if (!/^\d{4}-\d{2}-\d{2}/.test(r.date) || r.date.slice(0, 10) > today) continue
    const key = `${r.sessionId}:${r.studentId}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(r)
  }
  return result
}

/** "วัน" when every record is a homeroom (daily) roll call, "คาบ" when
 * every record is a subject period, "ครั้ง" when mixed. */
export type AttendanceUnit = 'วัน' | 'คาบ' | 'ครั้ง'
export function attendanceUnit(records: AnalyticsAttendanceRecord[]): AttendanceUnit {
  const hasHomeroom = records.some((r) => r.subjectId === null)
  const hasSubject = records.some((r) => r.subjectId !== null)
  if (hasHomeroom && !hasSubject) return 'วัน'
  if (hasSubject && !hasHomeroom) return 'คาบ'
  return 'ครั้ง'
}

export interface AttendanceBreakdown {
  present: number
  late: number
  leave: number
  absent: number
  /** Recorded entries (the denominator) — NOT a student count. */
  total: number
  sessions: number
  studentsWithRecords: number
  /** present / total * 100, null without records. */
  rate: number | null
}

export function computeAttendanceBreakdown(records: AnalyticsAttendanceRecord[]): AttendanceBreakdown {
  const result = { present: 0, late: 0, leave: 0, absent: 0 }
  for (const r of records) result[r.status] += 1
  const total = records.length
  return {
    ...result,
    total,
    sessions: new Set(records.map((r) => r.sessionId)).size,
    studentsWithRecords: new Set(records.map((r) => r.studentId)).size,
    rate: total > 0 ? (result.present / total) * 100 : null,
  }
}

export function percentOf(part: number, total: number): number | null {
  return total > 0 ? (part / total) * 100 : null
}

// --------------------------------------------------
// Weekly trend
// --------------------------------------------------

export interface WeeklyAttendancePoint {
  /** Monday, YYYY-MM-DD */
  weekStart: string
  weekEnd: string
  /** 1-based, counted from the first week with records. */
  index: number
  present: number
  total: number
  /** null = no roll call recorded that week (a gap, never 0). */
  rate: number | null
}

function parseDay(date: string): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

const DAY_MS = 86_400_000

/** Monday of the week containing `date` (YYYY-MM-DD). */
export function weekStartOf(date: string): string {
  const ms = parseDay(date)
  const weekday = new Date(ms).getUTCDay() // 0 = Sunday
  const back = (weekday + 6) % 7
  return formatDay(ms - back * DAY_MS)
}

/** Chronological weekly rate; weeks between the first and last recorded
 * week that have no records are included with rate null. */
export function computeWeeklyTrend(records: AnalyticsAttendanceRecord[], classroomId: string | null = null): WeeklyAttendancePoint[] {
  const byWeek = new Map<string, { present: number; total: number }>()
  for (const r of records) {
    if (classroomId && r.classroomId !== classroomId) continue
    const week = weekStartOf(r.date)
    const entry = byWeek.get(week) ?? { present: 0, total: 0 }
    entry.total += 1
    if (r.status === 'present') entry.present += 1
    byWeek.set(week, entry)
  }
  if (byWeek.size === 0) return []
  const weeks = [...byWeek.keys()].sort()
  const points: WeeklyAttendancePoint[] = []
  let index = 1
  for (let ms = parseDay(weeks[0]); ms <= parseDay(weeks[weeks.length - 1]); ms += 7 * DAY_MS) {
    const weekStart = formatDay(ms)
    const entry = byWeek.get(weekStart)
    points.push({
      weekStart,
      weekEnd: formatDay(ms + 6 * DAY_MS),
      index: index++,
      present: entry?.present ?? 0,
      total: entry?.total ?? 0,
      rate: entry && entry.total > 0 ? (entry.present / entry.total) * 100 : null,
    })
  }
  return points
}

// --------------------------------------------------
// Per-student stats, rankings, risk
// --------------------------------------------------

export interface StudentAttendanceStat {
  studentId: string
  fullName: string
  studentCode: string | null
  classroomId: string
  classroomName: string
  present: number
  late: number
  leave: number
  absent: number
  total: number
  rate: number | null
  /** Subject with the most of this student's records in that classroom
   * (for the link to Student Analytics); falls back to any subject
   * linked to the classroom; null when the classroom has none. */
  analyticsSubjectId: string | null
}

/**
 * One row per student who has records AND is on a scope roster (a record
 * for a student the teacher can no longer see on any roster is counted
 * in the totals but cannot be named, so it is left out of the rankings).
 * A student on two classrooms in scope is shown under the classroom
 * holding most of their records.
 */
export function computeStudentAttendanceStats(
  records: AnalyticsAttendanceRecord[],
  roster: AnalyticsRoster,
  scope: SemesterScope,
  links: AnalyticsContext['links'],
): StudentAttendanceStat[] {
  const studentById = new Map(roster.students.map((s) => [s.id, s]))
  const memberOf = new Map<string, Set<string>>()
  for (const m of roster.memberships) {
    if (!scope.classroomIds.has(m.classroomId)) continue
    if (!memberOf.has(m.studentId)) memberOf.set(m.studentId, new Set())
    memberOf.get(m.studentId)!.add(m.classroomId)
  }
  const classroomName = new Map(scope.classrooms.map((c) => [c.id, c.name]))
  const firstLinkedSubject = new Map<string, string>()
  for (const l of links) if (!firstLinkedSubject.has(l.classroomId)) firstLinkedSubject.set(l.classroomId, l.subjectId)

  interface Acc {
    counts: Record<AttendanceStatus, number>
    byClassroom: Map<string, number>
    bySubject: Map<string, Map<string, number>>
  }
  const acc = new Map<string, Acc>()
  for (const r of records) {
    if (!studentById.has(r.studentId) || !memberOf.has(r.studentId)) continue
    let a = acc.get(r.studentId)
    if (!a) {
      a = { counts: { present: 0, late: 0, leave: 0, absent: 0 }, byClassroom: new Map(), bySubject: new Map() }
      acc.set(r.studentId, a)
    }
    a.counts[r.status] += 1
    a.byClassroom.set(r.classroomId, (a.byClassroom.get(r.classroomId) ?? 0) + 1)
    if (r.subjectId) {
      const subjects = a.bySubject.get(r.classroomId) ?? new Map<string, number>()
      subjects.set(r.subjectId, (subjects.get(r.subjectId) ?? 0) + 1)
      a.bySubject.set(r.classroomId, subjects)
    }
  }

  const stats: StudentAttendanceStat[] = []
  for (const [studentId, a] of acc) {
    const student = studentById.get(studentId)!
    const memberships = memberOf.get(studentId)!
    const classroomId =
      [...a.byClassroom.entries()].filter(([id]) => memberships.has(id)).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ??
      [...memberships].sort()[0]
    const subjectCounts = a.bySubject.get(classroomId)
    const analyticsSubjectId =
      (subjectCounts && [...subjectCounts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0]) ?? firstLinkedSubject.get(classroomId) ?? null
    const total = a.counts.present + a.counts.late + a.counts.leave + a.counts.absent
    stats.push({
      studentId,
      fullName: `${student.firstName} ${student.lastName}`.trim(),
      studentCode: student.studentCode,
      classroomId,
      classroomName: classroomName.get(classroomId) ?? '-',
      ...a.counts,
      total,
      rate: total > 0 ? (a.counts.present / total) * 100 : null,
      analyticsSubjectId,
    })
  }
  return stats
}

export interface Ranked<T> {
  rank: number
  item: T
}

/** Standard competition ranking (1, 1, 3): equal `tieKey` share a rank. */
export function assignRanks<T>(sorted: T[], tieKey: (item: T) => string): Ranked<T>[] {
  let previousKey: string | null = null
  let previousRank = 0
  return sorted.map((item, i) => {
    const key = tieKey(item)
    const rank = key === previousKey ? previousRank : i + 1
    previousKey = key
    previousRank = rank
    return { rank, item }
  })
}

const byName = (a: StudentAttendanceStat, b: StudentAttendanceStat) => a.fullName.localeCompare(b.fullName, 'th') || a.studentId.localeCompare(b.studentId)

/** Most absences first; ties share a rank and are ordered by lower
 * attendance rate, then name. Only students with at least one absence. */
export function rankMostAbsences(stats: StudentAttendanceStat[], limit: number = ANALYTICS_RULES.TOP_N): Ranked<StudentAttendanceStat>[] {
  const sorted = stats.filter((s) => s.absent > 0).sort((a, b) => b.absent - a.absent || (a.rate ?? 0) - (b.rate ?? 0) || byName(a, b))
  return assignRanks(sorted, (s) => String(s.absent)).slice(0, limit)
}

/** Recorded-session coverage rule for "highest attendance". */
export function isEligibleForTopAttendance(stat: StudentAttendanceStat, maxSessionsInClassroom: number): boolean {
  return (
    stat.total >= ANALYTICS_RULES.MIN_SESSIONS_FOR_TOP_ATTENDANCE &&
    stat.total >= Math.ceil(maxSessionsInClassroom * ANALYTICS_RULES.MIN_COVERAGE_FOR_TOP_ATTENDANCE)
  )
}

/** Highest rate first among eligible students; equal rates (to 0.1%)
 * share a rank and are ordered by more recorded sessions, then name. */
export function rankHighestAttendance(stats: StudentAttendanceStat[], limit: number = ANALYTICS_RULES.TOP_N): Ranked<StudentAttendanceStat>[] {
  const maxByClassroom = new Map<string, number>()
  for (const s of stats) maxByClassroom.set(s.classroomId, Math.max(maxByClassroom.get(s.classroomId) ?? 0, s.total))
  const sorted = stats
    .filter((s) => s.rate !== null && isEligibleForTopAttendance(s, maxByClassroom.get(s.classroomId) ?? 0))
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0) || b.total - a.total || byName(a, b))
  return assignRanks(sorted, (s) => (s.rate ?? 0).toFixed(1)).slice(0, limit)
}

export type RiskLevel = 'high' | 'monitor'

export interface RiskEntry {
  stat: StudentAttendanceStat
  level: RiskLevel
  reason: string
}

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  high: 'ติดตามด่วน',
  monitor: 'เฝ้าระวัง',
}

export function classifyAbsenceRisk(absent: number): RiskLevel | null {
  if (absent >= ANALYTICS_RULES.RISK_HIGH_ABSENCES) return 'high'
  if (absent >= ANALYTICS_RULES.RISK_MONITOR_ABSENCES) return 'monitor'
  return null
}

export function computeRiskList(stats: StudentAttendanceStat[], unit: AttendanceUnit): RiskEntry[] {
  const entries: RiskEntry[] = []
  for (const stat of stats) {
    const level = classifyAbsenceRisk(stat.absent)
    if (!level) continue
    const threshold = level === 'high' ? ANALYTICS_RULES.RISK_HIGH_ABSENCES : ANALYTICS_RULES.RISK_MONITOR_ABSENCES
    entries.push({
      stat,
      level,
      reason: `ขาด ${stat.absent} ${unit} จาก ${stat.total} ${unit}ที่เช็คชื่อ (เกณฑ์${RISK_LEVEL_LABEL[level]} ${threshold} ${unit}ขึ้นไป)`,
    })
  }
  return entries.sort((a, b) => (a.level === b.level ? 0 : a.level === 'high' ? -1 : 1) || b.stat.absent - a.stat.absent || byName(a.stat, b.stat))
}

// ==================================================
// Assignments
// ==================================================

export interface AssignmentProgress {
  assignmentCount: number
  /** Assignments whose due date is today/later or unset. */
  openAssignmentCount: number
  /** Student × assignment slots (the donut's denominator) — NOT an
   * assignment count. */
  slots: number
  completed: number
  /** Of `completed`, how many were submitted late. */
  completedLate: number
  /** Not submitted yet, but not past due. */
  pending: number
  /** Marked missing, or not submitted and past due. */
  notSubmitted: number
  perAssignment: { assignment: AnalyticsAssignment; roster: number; notSubmitted: number; pastDue: boolean }[]
}

function isPastDue(dueDate: string | null, today: string): boolean {
  return dueDate !== null && dueDate.slice(0, 10) < today
}

/**
 * Every non-archived assignment in scope × every ACTIVE student on its
 * classroom's roster. A student with no submission row counts as
 * not_submitted (the table's own default — see buildDefaultSubmissions).
 */
export function computeAssignmentProgress(
  data: AnalyticsAssignmentData,
  roster: AnalyticsRoster,
  scope: SemesterScope,
  today: string,
  subjectId: string | null = null,
): AssignmentProgress {
  const activeIds = new Set(roster.students.filter((s) => s.status !== 'inactive').map((s) => s.id))
  const rosterByClassroom = new Map<string, string[]>()
  for (const m of roster.memberships) {
    if (!scope.classroomIds.has(m.classroomId) || !activeIds.has(m.studentId)) continue
    const list = rosterByClassroom.get(m.classroomId) ?? []
    if (!list.includes(m.studentId)) list.push(m.studentId)
    rosterByClassroom.set(m.classroomId, list)
  }
  const statusByKey = new Map(data.submissions.map((s) => [`${s.assignmentId}:${s.studentId}`, s.status]))
  const assignments = data.assignments.filter((a) => scope.classroomIds.has(a.classroomId) && (subjectId === null || a.subjectId === subjectId))

  const result: AssignmentProgress = {
    assignmentCount: assignments.length,
    openAssignmentCount: assignments.filter((a) => !isPastDue(a.dueDate, today)).length,
    slots: 0,
    completed: 0,
    completedLate: 0,
    pending: 0,
    notSubmitted: 0,
    perAssignment: [],
  }
  for (const assignment of assignments) {
    const students = rosterByClassroom.get(assignment.classroomId) ?? []
    const pastDue = isPastDue(assignment.dueDate, today)
    let notSubmitted = 0
    for (const studentId of students) {
      const status = statusByKey.get(`${assignment.id}:${studentId}`) ?? 'not_submitted'
      result.slots += 1
      if (status === 'submitted' || status === 'late') {
        result.completed += 1
        if (status === 'late') result.completedLate += 1
      } else if (status === 'missing' || pastDue) {
        result.notSubmitted += 1
        notSubmitted += 1
      } else {
        result.pending += 1
      }
    }
    result.perAssignment.push({ assignment, roster: students.length, notSubmitted, pastDue })
  }
  return result
}

// ==================================================
// Teacher insights (deterministic rules, no AI)
// ==================================================

export type InsightTone = 'warning' | 'info' | 'positive'

export interface TeacherInsight {
  id: string
  tone: InsightTone
  message: string
}

function round(value: number): number {
  return Math.round(value)
}

function average(points: WeeklyAttendancePoint[]): { rate: number | null; total: number } {
  const total = points.reduce((s, p) => s + p.total, 0)
  const present = points.reduce((s, p) => s + p.present, 0)
  return { rate: total > 0 ? (present / total) * 100 : null, total }
}

export function formatThaiShortDate(date: string): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number)
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
  return `${d} ${months[m - 1]} ${y + 543}`
}

export interface InsightInputs {
  breakdown: AttendanceBreakdown | null
  weekly: WeeklyAttendancePoint[] | null
  weeklyByClassroom: { classroom: AnalyticsClassroom; points: WeeklyAttendancePoint[] }[] | null
  risk: RiskEntry[] | null
  unit: AttendanceUnit
  assignments: AssignmentProgress | null
  classroomName: (id: string) => string
}

export function buildTeacherInsights(input: InsightInputs): TeacherInsight[] {
  const insights: TeacherInsight[] = []
  const { unit } = input

  const high = input.risk?.filter((r) => r.level === 'high') ?? []
  const monitor = input.risk?.filter((r) => r.level === 'monitor') ?? []
  if (high.length > 0) {
    insights.push({
      id: 'risk-high',
      tone: 'warning',
      message: `นักเรียน ${high.length} คนขาดเรียนตั้งแต่ ${ANALYTICS_RULES.RISK_HIGH_ABSENCES} ${unit}ขึ้นไป ควรติดตามและพูดคุยอย่างใกล้ชิด`,
    })
  } else if (monitor.length > 0) {
    insights.push({
      id: 'risk-monitor',
      tone: 'info',
      message: `นักเรียน ${monitor.length} คนขาดเรียน ${ANALYTICS_RULES.RISK_MONITOR_ABSENCES}–${ANALYTICS_RULES.RISK_HIGH_ABSENCES - 1} ${unit} ควรเฝ้าระวังก่อนถึงเกณฑ์ติดตามด่วน`,
    })
  }

  // Declining classroom: last two recorded weeks vs the two before.
  for (const { classroom, points } of input.weeklyByClassroom ?? []) {
    const recorded = points.filter((p) => p.rate !== null)
    if (recorded.length < 4) continue
    const recent = average(recorded.slice(-2))
    const before = average(recorded.slice(-4, -2))
    if (recent.rate === null || before.rate === null) continue
    if (recent.total < ANALYTICS_RULES.DECLINE_MIN_RECORDS_PER_WINDOW || before.total < ANALYTICS_RULES.DECLINE_MIN_RECORDS_PER_WINDOW) continue
    if (before.rate - recent.rate >= ANALYTICS_RULES.DECLINE_POINTS) {
      insights.push({
        id: `decline-${classroom.id}`,
        tone: 'warning',
        message: `อัตรามาเรียนห้อง ${classroom.name} ลดลงจาก ${round(before.rate)}% เหลือ ${round(recent.rate)}% ใน 2 สัปดาห์ล่าสุด`,
      })
    }
  }

  // Unusually low latest week vs the semester average.
  const recordedWeeks = input.weekly?.filter((p) => p.rate !== null) ?? []
  const overall = input.breakdown?.rate ?? null
  const latest = recordedWeeks[recordedWeeks.length - 1]
  if (latest && overall !== null && recordedWeeks.length >= 2 && latest.rate! <= overall - ANALYTICS_RULES.LOW_WEEK_POINTS_BELOW_AVERAGE) {
    insights.push({
      id: 'low-week',
      tone: 'warning',
      message: `สัปดาห์ล่าสุด (${formatThaiShortDate(latest.weekStart)}–${formatThaiShortDate(latest.weekEnd)}) อัตรามาเรียน ${round(latest.rate!)}% ต่ำกว่าค่าเฉลี่ยภาคเรียน (${round(overall)}%)`,
    })
  }

  // Assignments with high non-submission (past due only).
  const flagged = (input.assignments?.perAssignment ?? [])
    .filter((p) => p.pastDue && p.roster >= ANALYTICS_RULES.MIN_ROSTER_FOR_SUBMISSION_INSIGHT && p.notSubmitted / p.roster >= ANALYTICS_RULES.HIGH_NON_SUBMISSION_SHARE)
    .sort((a, b) => b.notSubmitted / b.roster - a.notSubmitted / a.roster || a.assignment.title.localeCompare(b.assignment.title, 'th'))
  if (flagged.length > 0) {
    const top = flagged[0]
    const more = flagged.length > 1 ? ` และอีก ${flagged.length - 1} งาน` : ''
    insights.push({
      id: 'non-submission',
      tone: 'warning',
      message: `งาน "${top.assignment.title}" (${input.classroomName(top.assignment.classroomId)}) เลยกำหนดแล้วยังไม่ส่ง ${top.notSubmitted} จาก ${top.roster} คน (${round((top.notSubmitted / top.roster) * 100)}%)${more}`,
    })
  }

  if (overall !== null && overall >= ANALYTICS_RULES.GOOD_ATTENDANCE_RATE) {
    insights.push({
      id: 'good-attendance',
      tone: 'positive',
      message: `อัตรามาเรียนเฉลี่ย ${round(overall)}% อยู่ในเกณฑ์ดี ควรรักษาแนวโน้มนี้ต่อไป`,
    })
  }

  return insights.slice(0, ANALYTICS_RULES.MAX_INSIGHTS)
}

// ==================================================
// Classroom section (integrated classroom management)
// ==================================================

export interface ClassroomCardSummary {
  classroom: AnalyticsClassroom
  studentCount: number
  subjectNames: string[]
  semesterLabel: string
  gradeLabel: string
}

/** "ม.1" from gradeLevel, else from the name ("ม.1/2" -> "ม.1"), else "-". */
export function classroomGradeLabel(classroom: AnalyticsClassroom): string {
  const explicit = classroom.gradeLevel?.trim()
  if (explicit) return explicit
  const fromName = /^(.+?)\s*\/\s*\d+$/.exec(classroom.name.trim())?.[1]
  return fromName?.trim() || '-'
}

/** One card per classroom in scope — counts from the already-loaded
 * roster and subject links (no per-classroom request). */
export function buildClassroomCards(context: AnalyticsContext, scope: SemesterScope, roster: AnalyticsRoster | null): ClassroomCardSummary[] {
  const subjectName = new Map(context.subjects.map((s) => [s.id, s.name]))
  const studentsByClassroom = new Map<string, Set<string>>()
  for (const m of roster?.memberships ?? []) {
    if (!studentsByClassroom.has(m.classroomId)) studentsByClassroom.set(m.classroomId, new Set())
    studentsByClassroom.get(m.classroomId)!.add(m.studentId)
  }
  return scope.classrooms
    .map((classroom) => ({
      classroom,
      studentCount: studentsByClassroom.get(classroom.id)?.size ?? 0,
      subjectNames: context.links
        .filter((l) => l.classroomId === classroom.id)
        .map((l) => subjectName.get(l.subjectId))
        .filter((n): n is string => Boolean(n))
        .sort((a, b) => a.localeCompare(b, 'th')),
      semesterLabel: semesterLabel(classroom.academicYear, classroom.semester),
      gradeLabel: classroomGradeLabel(classroom),
    }))
    .sort((a, b) => Number(b.classroom.isActive) - Number(a.classroom.isActive) || a.classroom.name.localeCompare(b.classroom.name, 'th', { numeric: true }))
}

export type ClassroomStatusFilter = 'all' | 'active' | 'archived'

export function filterClassroomCards(
  cards: ClassroomCardSummary[],
  filters: { search: string; grade: string; status: ClassroomStatusFilter },
): ClassroomCardSummary[] {
  const query = filters.search.trim().toLowerCase()
  return cards.filter((card) => {
    if (filters.status === 'active' && !card.classroom.isActive) return false
    if (filters.status === 'archived' && card.classroom.isActive) return false
    if (filters.grade && card.gradeLabel !== filters.grade) return false
    if (query && !card.classroom.name.toLowerCase().includes(query) && !card.subjectNames.some((n) => n.toLowerCase().includes(query))) return false
    return true
  })
}

/** Date span of the recorded roll calls in scope (for the semester card)
 * — null without records. */
export function attendanceDateSpan(records: AnalyticsAttendanceRecord[]): { first: string; last: string } | null {
  if (records.length === 0) return null
  let first = records[0].date.slice(0, 10)
  let last = first
  for (const r of records) {
    const d = r.date.slice(0, 10)
    if (d < first) first = d
    if (d > last) last = d
  }
  return { first, last }
}
