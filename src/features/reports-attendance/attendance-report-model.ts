import {
  cleanAttendanceRecords,
  computeWeeklyTrend,
  type AnalyticsAttendanceRecord,
  type AnalyticsContext,
  type AnalyticsRoster,
  type AnalyticsStudent,
  type AttendanceStatus,
  type SemesterScope,
  type WeeklyAttendancePoint,
} from '@/features/classroom-analytics/analytics'
import { formatThaiDate } from '@/features/reports-missing/missing-report-model'
import type { ExportTable } from '@/lib/export/export-table'
import { FOLLOWUP_RULES } from '@/services/followup-report-service'

/**
 * Attendance report (Reports → สรุปการเข้าเรียน) — the ONE calculation
 * behind the on-screen views, the A4 print preview and the PDF/Word/CSV
 * exports.
 *
 * DATA (0004/0005): attendance_sessions (one roll call: classroom, subject
 * or homeroom, date, period) and attendance_records (one status per
 * session × student; present | late | leave | absent). A student with no
 * record for a session was simply not checked — never counted as absent.
 *
 * RULES:
 *   - Records are cleaned first (cleanAttendanceRecords, shared with the
 *     dashboard): duplicates of the same session × student are counted
 *     once, future-dated / invalid / out-of-scope rows are dropped.
 *   - Status totals count RECORDED ENTRIES (รายการเช็คชื่อ / ครั้ง), never
 *     students. Student totals count UNIQUE students.
 *   - Attendance rate = present ÷ recorded entries (the app's existing
 *     definition, same as the dashboard and Student Analytics). No
 *     entries → "ยังไม่มีข้อมูล" (null), never 0% or 100%.
 *   - Display bands (ATTENDANCE_BANDS) and the follow-up flag are
 *     indicators for the teacher, not academic pass/fail decisions.
 *
 * Access: data only comes from RLS-scoped queries of the teacher's own
 * classrooms; filters only narrow it.
 */

export type AttendanceView = 'overview' | 'classroom' | 'subject' | 'student'
export type DatePreset = 'today' | '7d' | '30d' | 'semester' | 'custom'
export type AttendanceBand = 'excellent' | 'good' | 'attention' | 'no_data'
export type BandFilter = 'all' | AttendanceBand | 'follow_up'
export type AttendanceSortKey = 'number' | 'name' | 'classroom' | 'present' | 'late' | 'leave' | 'absent' | 'total' | 'rate'
export type SortDirection = 'asc' | 'desc'

/** Display thresholds (percent) — change here only. */
export const ATTENDANCE_BANDS = { excellent: 90, good: 80 } as const

export const BAND_LABEL: Record<AttendanceBand, string> = {
  excellent: 'ดีมาก',
  good: 'ดี',
  attention: 'ควรติดตาม',
  no_data: 'ยังไม่มีข้อมูล',
}

export const VIEW_LABEL: Record<AttendanceView, string> = {
  overview: 'สรุปภาพรวม',
  classroom: 'รายห้องเรียน',
  subject: 'รายวิชา',
  student: 'รายนักเรียน',
}

export const PRESET_LABEL: Record<DatePreset, string> = {
  today: 'วันนี้',
  '7d': '7 วันล่าสุด',
  '30d': '30 วันล่าสุด',
  semester: 'ทั้งภาคเรียน',
  custom: 'กำหนดเอง',
}

export const BAND_FILTER_LABEL: Record<BandFilter, string> = {
  all: 'ทุกสถานะ',
  excellent: `ดีมาก (${ATTENDANCE_BANDS.excellent}% ขึ้นไป)`,
  good: `ดี (${ATTENDANCE_BANDS.good}–${ATTENDANCE_BANDS.excellent - 0.01}%)`,
  attention: `ควรติดตาม (ต่ำกว่า ${ATTENDANCE_BANDS.good}%)`,
  no_data: 'ยังไม่มีข้อมูล',
  follow_up: 'เฉพาะนักเรียนที่ควรติดตาม',
}

export const STATUS_LABEL: Record<AttendanceStatus, string> = { present: 'มาเรียน', late: 'มาสาย', leave: 'ลา', absent: 'ขาดเรียน' }

export interface AttendanceReportFilters {
  view: AttendanceView
  classroomId: string | null
  subjectId: string | null
  preset: DatePreset
  /** Used when preset = custom. YYYY-MM-DD, inclusive. */
  from: string | null
  to: string | null
  band: BandFilter
  search: string
  sort: AttendanceSortKey
  direction: SortDirection
  /** Student view: the selected student. */
  studentId: string | null
}

export const DEFAULT_ATTENDANCE_FILTERS: AttendanceReportFilters = {
  view: 'overview',
  classroomId: null,
  subjectId: null,
  preset: '30d',
  from: null,
  to: null,
  band: 'all',
  search: '',
  // Classroom, then เลขที่ — so students of different rooms never interleave.
  sort: 'classroom',
  direction: 'asc',
  studentId: null,
}

export interface StatusCounts {
  present: number
  late: number
  leave: number
  absent: number
  /** Recorded entries (= present + late + leave + absent). */
  total: number
}

export interface StudentAttendanceRow extends StatusCounts {
  studentId: string
  studentCode: string | null
  number: number | null
  firstName: string
  lastName: string
  classroomIds: string[]
  classroomNames: string[]
  /** present ÷ total × 100; null when total = 0. */
  rate: number | null
  band: AttendanceBand
  followUp: boolean
  /** Why followUp is true (Thai, with the threshold). */
  followUpReasons: string[]
  inactive: boolean
}

export interface ClassroomAttendanceStat extends StatusCounts {
  classroomId: string
  classroomName: string
  students: number
  sessions: number
  rate: number | null
  followUpCount: number
}

export interface AttendanceSummary extends StatusCounts {
  uniqueStudents: number
  sessions: number
  rate: number | null
  followUpCount: number
  studentsWithoutRecords: number
}

export interface StudentHistoryEntry {
  sessionId: string
  date: string
  classroomName: string
  subjectName: string | null
  status: AttendanceStatus
}

export interface StudentDetail {
  row: StudentAttendanceRow
  history: StudentHistoryEntry[]
  weekly: WeeklyAttendancePoint[]
  /** Subject to open Student Analytics with (most-recorded, else linked). */
  analyticsSubjectId: string | null
  analyticsClassroomId: string | null
}

export interface AttendanceReport {
  range: { from: string | null; to: string | null }
  summary: AttendanceSummary
  /** Filtered + sorted student rows (all pages). */
  students: StudentAttendanceRow[]
  /** Every classroom of the semester (for the classroom panel), stats
   * within the subject/date filters. */
  classrooms: ClassroomAttendanceStat[]
  /** The selected classroom's details (classroom view). */
  classroomDetail: ClassroomAttendanceStat | null
  /** The selected subject's per-classroom breakdown (subject view). */
  subjectBreakdown: ClassroomAttendanceStat[]
  student: StudentDetail | null
}

// ==================================================
// Helpers
// ==================================================

export function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return date.toISOString().slice(0, 10)
}

/** Date bounds for a preset (local school dates). "ทั้งภาคเรียน" has no
 * bounds — the semester already limits the classrooms. */
export function resolveDateRange(filters: Pick<AttendanceReportFilters, 'preset' | 'from' | 'to'>, today: string): { from: string | null; to: string | null } {
  switch (filters.preset) {
    case 'today':
      return { from: today, to: today }
    case '7d':
      return { from: shiftDate(today, -6), to: today }
    case '30d':
      return { from: shiftDate(today, -29), to: today }
    case 'custom':
      return { from: filters.from, to: filters.to }
    default:
      return { from: null, to: null }
  }
}

export function rateOf(counts: { present: number; total: number }): number | null {
  return counts.total > 0 ? (counts.present / counts.total) * 100 : null
}

export function bandOf(rate: number | null): AttendanceBand {
  if (rate === null) return 'no_data'
  if (rate >= ATTENDANCE_BANDS.excellent) return 'excellent'
  if (rate >= ATTENDANCE_BANDS.good) return 'good'
  return 'attention'
}

export function formatRate(rate: number | null): string {
  return rate === null ? 'ยังไม่มีข้อมูล' : `${rate.toFixed(1)}%`
}

function emptyCounts(): StatusCounts {
  return { present: 0, late: 0, leave: 0, absent: 0, total: 0 }
}

function add(counts: StatusCounts, status: AttendanceStatus): void {
  counts[status] += 1
  counts.total += 1
}

/** Follow-up indicator — the same absence threshold as the
 * "นักเรียนที่ควรติดตาม" tab, plus a low attendance rate. */
export function followUpReasons(counts: StatusCounts, rate: number | null): string[] {
  const reasons: string[] = []
  if (counts.absent >= FOLLOWUP_RULES.ABSENCE_THRESHOLD) reasons.push(`ขาดเรียน ${counts.absent} ครั้ง (เกณฑ์ ${FOLLOWUP_RULES.ABSENCE_THRESHOLD} ครั้งขึ้นไป)`)
  if (rate !== null && rate < ATTENDANCE_BANDS.good) reasons.push(`มาเรียน ${rate.toFixed(1)}% (เกณฑ์ต่ำกว่า ${ATTENDANCE_BANDS.good}%)`)
  return reasons
}

function compareRows(sort: AttendanceSortKey, direction: SortDirection) {
  const sign = direction === 'asc' ? 1 : -1
  const byNumber = (a: StudentAttendanceRow, b: StudentAttendanceRow) =>
    (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER) || `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'th')
  return (a: StudentAttendanceRow, b: StudentAttendanceRow): number => {
    let primary = 0
    switch (sort) {
      case 'name':
        primary = `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'th')
        break
      case 'classroom':
        primary = (a.classroomNames[0] ?? '').localeCompare(b.classroomNames[0] ?? '', 'th', { numeric: true })
        break
      case 'rate':
        // "ยังไม่มีข้อมูล" always sorts last.
        if (a.rate === null || b.rate === null) return a.rate === b.rate ? byNumber(a, b) : a.rate === null ? 1 : -1
        primary = a.rate - b.rate
        break
      case 'number':
        return sign * byNumber(a, b)
      default:
        primary = a[sort] - b[sort]
    }
    return sign * primary || byNumber(a, b)
  }
}

export function sortAttendanceRows(rows: StudentAttendanceRow[], sort: AttendanceSortKey, direction: SortDirection): StudentAttendanceRow[] {
  return [...rows].sort(compareRows(sort, direction))
}

export function paginate<T>(items: T[], page: number, pageSize: number): { items: T[]; page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const current = Math.min(Math.max(1, page), pageCount)
  return { items: items.slice((current - 1) * pageSize, current * pageSize), page: current, pageCount }
}

function matchesSearch(student: AnalyticsStudent, query: string): boolean {
  if (!query) return true
  return [`${student.firstName} ${student.lastName}`, student.studentCode ?? '', student.number === null ? '' : String(student.number)].join(' ').toLowerCase().includes(query)
}

function matchesBand(row: StudentAttendanceRow, band: BandFilter): boolean {
  if (band === 'all') return true
  if (band === 'follow_up') return row.followUp
  return row.band === band
}

// ==================================================
// The report
// ==================================================

export interface BuildAttendanceReportInput {
  context: AnalyticsContext
  scope: SemesterScope
  roster: AnalyticsRoster
  records: AnalyticsAttendanceRecord[]
  filters: AttendanceReportFilters
  /** YYYY-MM-DD (local). */
  today: string
}

export function buildAttendanceReport({ context, scope, roster, records, filters, today }: BuildAttendanceReportInput): AttendanceReport {
  const range = resolveDateRange(filters, today)
  const classroomName = new Map(context.classrooms.map((c) => [c.id, c.name]))
  const subjectName = new Map(context.subjects.map((s) => [s.id, s.name]))
  const studentById = new Map(roster.students.map((s) => [s.id, s]))

  // Classrooms considered: the semester's, narrowed to the subject's
  // linked classrooms when a subject is chosen.
  const linkedToSubject = filters.subjectId ? new Set(context.links.filter((l) => l.subjectId === filters.subjectId).map((l) => l.classroomId)) : null
  const semesterClassrooms = scope.classrooms.filter((c) => !linkedToSubject || linkedToSubject.has(c.id))
  const semesterIds = new Set(semesterClassrooms.map((c) => c.id))

  // Clean (dedupe, drop future/invalid/out-of-scope), then subject + date.
  const inRange = (date: string) => (!range.from || date.slice(0, 10) >= range.from) && (!range.to || date.slice(0, 10) <= range.to)
  const semesterRecords = cleanAttendanceRecords(records, semesterIds, today).filter(
    (r) => (!filters.subjectId || r.subjectId === filters.subjectId) && inRange(r.date),
  )

  // Per-classroom stats (classroom panel): every semester classroom.
  const activeMembers = new Map<string, Set<string>>()
  for (const m of roster.memberships) {
    if (!semesterIds.has(m.classroomId) || studentById.get(m.studentId)?.status === 'inactive') continue
    if (!activeMembers.has(m.classroomId)) activeMembers.set(m.classroomId, new Set())
    activeMembers.get(m.classroomId)!.add(m.studentId)
  }

  function rowsFor(recordSet: AnalyticsAttendanceRecord[], memberClassroomIds: Set<string>): StudentAttendanceRow[] {
    const counts = new Map<string, StatusCounts>()
    const classroomsOf = new Map<string, Set<string>>()
    const touch = (studentId: string, classroomId: string) => {
      if (!counts.has(studentId)) counts.set(studentId, emptyCounts())
      if (!classroomsOf.has(studentId)) classroomsOf.set(studentId, new Set())
      classroomsOf.get(studentId)!.add(classroomId)
    }
    for (const classroomId of memberClassroomIds) for (const studentId of activeMembers.get(classroomId) ?? []) touch(studentId, classroomId)
    for (const r of recordSet) {
      if (!studentById.has(r.studentId)) continue
      touch(r.studentId, r.classroomId)
      add(counts.get(r.studentId)!, r.status)
    }
    return [...counts.entries()].map(([studentId, c]) => {
      const s = studentById.get(studentId)!
      const rate = rateOf(c)
      const reasons = followUpReasons(c, rate)
      const ids = [...(classroomsOf.get(studentId) ?? [])].sort((a, b) => (classroomName.get(a) ?? '').localeCompare(classroomName.get(b) ?? '', 'th', { numeric: true }))
      return {
        studentId,
        studentCode: s.studentCode,
        number: s.number,
        firstName: s.firstName,
        lastName: s.lastName,
        classroomIds: ids,
        classroomNames: ids.map((id) => classroomName.get(id) ?? '-'),
        ...c,
        rate,
        band: bandOf(rate),
        followUp: reasons.length > 0,
        followUpReasons: reasons,
        inactive: s.status === 'inactive',
      }
    })
  }

  function classroomStat(classroomId: string): ClassroomAttendanceStat {
    const recs = semesterRecords.filter((r) => r.classroomId === classroomId)
    const c = emptyCounts()
    for (const r of recs) add(c, r.status)
    const rows = rowsFor(recs, new Set([classroomId]))
    return {
      classroomId,
      classroomName: classroomName.get(classroomId) ?? '-',
      students: activeMembers.get(classroomId)?.size ?? 0,
      sessions: new Set(recs.map((r) => r.sessionId)).size,
      ...c,
      rate: rateOf(c),
      followUpCount: rows.filter((r) => r.followUp).length,
    }
  }

  const classrooms = semesterClassrooms
    .map((c) => classroomStat(c.id))
    .sort((a, b) => a.classroomName.localeCompare(b.classroomName, 'th', { numeric: true }))

  // Classroom filter (classroom view, or any view with a classroom chosen).
  const selectedIds = filters.classroomId && semesterIds.has(filters.classroomId) ? new Set([filters.classroomId]) : semesterIds
  const scopedRecords = semesterRecords.filter((r) => selectedIds.has(r.classroomId))
  const query = filters.search.trim().toLowerCase()
  const allRows = rowsFor(scopedRecords, selectedIds)
  const visibleRows = allRows.filter((row) => matchesSearch(studentById.get(row.studentId)!, query) && matchesBand(row, filters.band))
  const visibleIds = new Set(visibleRows.map((r) => r.studentId))
  const summaryRecords = scopedRecords.filter((r) => visibleIds.has(r.studentId))

  const totals = emptyCounts()
  for (const r of summaryRecords) add(totals, r.status)

  let student: StudentDetail | null = null
  // The student focus only applies in the รายนักเรียน view — other views
  // (and their exports) always cover the whole filtered report.
  if (filters.view === 'student' && filters.studentId) {
    const row = allRows.find((r) => r.studentId === filters.studentId) ?? null
    if (row) {
      const own = scopedRecords.filter((r) => r.studentId === row.studentId)
      const bySubject = new Map<string, number>()
      for (const r of own) if (r.subjectId) bySubject.set(r.subjectId, (bySubject.get(r.subjectId) ?? 0) + 1)
      const topSubject = [...bySubject.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
      const classroomForLink = row.classroomIds[0] ?? null
      const linkedSubject = classroomForLink ? (context.links.find((l) => l.classroomId === classroomForLink)?.subjectId ?? null) : null
      const analyticsSubjectId = topSubject ?? linkedSubject
      const analyticsClassroomId = topSubject ? (own.find((r) => r.subjectId === topSubject)?.classroomId ?? classroomForLink) : classroomForLink
      student = {
        row,
        history: own
          .map((r) => ({ sessionId: r.sessionId, date: r.date.slice(0, 10), classroomName: classroomName.get(r.classroomId) ?? '-', subjectName: r.subjectId ? (subjectName.get(r.subjectId) ?? '-') : null, status: r.status }))
          .sort((a, b) => b.date.localeCompare(a.date)),
        weekly: computeWeeklyTrend(own),
        analyticsSubjectId,
        analyticsClassroomId,
      }
    }
  }

  return {
    range,
    summary: {
      uniqueStudents: visibleRows.length,
      sessions: new Set(summaryRecords.map((r) => r.sessionId)).size,
      ...totals,
      rate: rateOf(totals),
      followUpCount: visibleRows.filter((r) => r.followUp).length,
      studentsWithoutRecords: visibleRows.filter((r) => r.total === 0).length,
    },
    students: sortAttendanceRows(visibleRows, filters.sort, filters.direction),
    classrooms,
    classroomDetail: filters.classroomId ? (classrooms.find((c) => c.classroomId === filters.classroomId) ?? null) : null,
    subjectBreakdown: filters.subjectId ? classrooms.filter((c) => c.total > 0 || c.students > 0) : [],
    student,
  }
}

// ==================================================
// Document metadata + CSV (shared by preview, PDF, Word)
// ==================================================

export const ATTENDANCE_REPORT_TITLE = 'รายงานสรุปการเข้าเรียนของนักเรียน'

export interface AttendanceReportMeta {
  title: string
  subtitle: string
  schoolName: string | null
  teacherName: string | null
  classroomLabel: string
  subjectLabel: string
  semesterLabel: string
  periodLabel: string
  filterLabel: string | null
  viewLabel: string
  generatedOn: string
}

export function periodLabel(range: { from: string | null; to: string | null }, preset: DatePreset): string {
  if (!range.from && !range.to) return 'ทั้งภาคเรียน'
  if (range.from && range.to && range.from === range.to) return `วันที่ ${formatThaiDate(range.from, 'long')}`
  return `วันที่ ${range.from ? formatThaiDate(range.from, 'long') : 'ตั้งแต่ต้น'} – ${range.to ? formatThaiDate(range.to, 'long') : 'ปัจจุบัน'}${preset === 'custom' ? '' : ` (${PRESET_LABEL[preset]})`}`
}

export function buildAttendanceMeta(input: {
  context: AnalyticsContext
  scope: SemesterScope
  filters: AttendanceReportFilters
  report: AttendanceReport
  teacherName: string | null
  schoolName?: string | null
  today: string
}): AttendanceReportMeta {
  const { context, filters, report } = input
  const classroom = filters.classroomId ? context.classrooms.find((c) => c.id === filters.classroomId)?.name : null
  const subject = filters.subjectId ? context.subjects.find((s) => s.id === filters.subjectId)?.name : null
  const parts = [filters.band !== 'all' ? BAND_FILTER_LABEL[filters.band] : null, filters.search.trim() ? `ค้นหา: “${filters.search.trim()}”` : null].filter(Boolean)
  return {
    title: ATTENDANCE_REPORT_TITLE,
    subtitle: 'ระบบ KrunameClass',
    schoolName: input.schoolName?.trim() || null,
    teacherName: input.teacherName?.trim() || null,
    classroomLabel: classroom ?? 'ทุกห้องเรียน',
    subjectLabel: subject ?? 'ทุกรายวิชา (รวมการเช็คชื่อประจำวัน)',
    semesterLabel: input.scope.label,
    periodLabel: periodLabel(report.range, filters.preset),
    filterLabel: parts.length ? parts.join(' | ') : null,
    viewLabel: VIEW_LABEL[filters.view],
    generatedOn: input.today,
  }
}

export function attendanceMetaLines(meta: AttendanceReportMeta): string[] {
  return [
    meta.schoolName,
    meta.teacherName ? `ครูผู้สอน ${meta.teacherName}` : null,
    `ห้องเรียน ${meta.classroomLabel} | รายวิชา ${meta.subjectLabel}`,
    `${meta.semesterLabel} | ${meta.periodLabel}`,
    meta.filterLabel,
    `วันที่จัดทำรายงาน ${formatThaiDate(meta.generatedOn, 'long')}`,
  ].filter((line): line is string => Boolean(line))
}

/** One row per student (the same rows as the on-screen table, all pages). */
export function buildAttendanceCsvTable(report: AttendanceReport, meta: AttendanceReportMeta): ExportTable {
  const rows = report.student ? [report.student.row] : report.students
  return {
    title: meta.title,
    subtitle: [meta.classroomLabel, meta.subjectLabel, meta.semesterLabel, meta.periodLabel].join(' · '),
    headers: ['เลขที่', 'รหัสนักเรียน', 'ชื่อ-นามสกุล', 'ห้องเรียน', 'มาเรียน (ครั้ง)', 'มาสาย (ครั้ง)', 'ลา (ครั้ง)', 'ขาดเรียน (ครั้ง)', 'รวมรายการเช็คชื่อ', 'ร้อยละการมาเรียน', 'สถานะ', 'ควรติดตาม'],
    rows: rows.map((r) => [
      r.number ?? '',
      r.studentCode ?? '',
      `${r.firstName} ${r.lastName}`,
      r.classroomNames.join(', '),
      r.present,
      r.late,
      r.leave,
      r.absent,
      r.total,
      r.rate === null ? 'ยังไม่มีข้อมูล' : r.rate.toFixed(1),
      BAND_LABEL[r.band],
      r.followUp ? r.followUpReasons.join('; ') : '',
    ]),
  }
}

export function attendanceFilenameBase(meta: AttendanceReportMeta): string {
  return `รายงานการเข้าเรียน-${meta.classroomLabel}-${meta.generatedOn}`.replace(/[\\/:*?"<>|]+/g, '-')
}

