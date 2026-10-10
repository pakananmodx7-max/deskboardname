import type { AnalyticsAssignmentData, AnalyticsContext, AnalyticsRoster, AnalyticsStudent, SemesterScope } from '@/features/classroom-analytics/analytics'
import type { ExportTable } from '@/lib/export/export-table'

/**
 * Missing-assignment report — the ONE calculation behind the on-screen
 * report, the A4 print preview, and the PDF/Word/CSV exports.
 *
 * DATA MODEL (verified against 0006_subject_assignments.sql):
 *   - assignments: one subject + one classroom; `due_date` is a DATE (or
 *     null); `is_archived` is the only "removed" flag. There is no draft,
 *     cancelled, or published flag. Every non-archived assignment is
 *     assigned to every student of its classroom.
 *   - assignment_submissions: at most ONE row per (assignment, student)
 *     (unique constraint), so a submission can never be double-counted.
 *     Status is one of not_submitted | submitted | late | missing. No
 *     row means not_submitted (the app's existing default). There are no
 *     graded / returned / resubmission statuses in this schema.
 *
 * OBLIGATION RULES (one obligation = one eligible student × one assignment):
 *   - submitted / late (ส่งช้า = submitted late)  → done, not counted.
 *   - missing (teacher marked ขาดส่ง)              → ขาดส่ง (overdue).
 *   - not_submitted / no row:
 *       no due date                                → ไม่มีกำหนดส่ง (never overdue)
 *       due date before today                      → ขาดส่ง (overdue)
 *       due date today or later                    → ยังไม่ส่ง (pending)
 *
 * ELIGIBLE STUDENT: a current member of the assignment's classroom whose
 * student record is active. A student who joined the classroom after the
 * due date is not expected to have submitted it, unless the teacher has
 * already recorded a status row for them. A student no longer on the
 * roster is not counted; their saved rows are kept, never invented.
 *
 * DATE RANGE (same convention as the other reports): it filters by DUE
 * DATE — an assignment counts when its due date falls within [from, to]
 * (inclusive). Assignments with no due date are always included.
 *
 * Access: the data comes only through RLS-scoped queries of the signed-in
 * teacher's own classrooms; nothing here widens access.
 */

export type ObligationStatus = 'pending' | 'overdue' | 'no_due'
export type StatusFilter = 'all' | ObligationStatus
export type SortKey = 'total' | 'number' | 'name' | 'classroom' | 'overdue'

export const OBLIGATION_STATUS_LABEL: Record<ObligationStatus, string> = {
  pending: 'ยังไม่ส่ง',
  overdue: 'ขาดส่ง',
  no_due: 'ไม่มีกำหนดส่ง',
}

export const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  all: 'งานค้างทั้งหมด',
  pending: 'ยังไม่ส่ง (ยังไม่เลยกำหนด)',
  overdue: 'ขาดส่ง (เลยกำหนด)',
  no_due: 'ไม่มีกำหนดส่ง',
}

export const SORT_LABEL: Record<SortKey, string> = {
  total: 'งานค้างมากที่สุด',
  overdue: 'ขาดส่งมากที่สุด',
  number: 'เลขที่',
  name: 'ชื่อ',
  classroom: 'ห้องเรียน',
}

export interface MissingReportFilters {
  classroomId: string | null
  subjectId: string | null
  /** YYYY-MM-DD, inclusive; null = no bound. Applies to the DUE DATE. */
  from: string | null
  to: string | null
  status: StatusFilter
  search: string
  sort: SortKey
}

export const DEFAULT_MISSING_FILTERS: MissingReportFilters = {
  classroomId: null,
  subjectId: null,
  from: null,
  to: null,
  status: 'all',
  search: '',
  sort: 'total',
}

export interface MissingObligation {
  studentId: string
  studentCode: string | null
  number: number | null
  firstName: string
  lastName: string
  classroomId: string
  classroomName: string
  subjectId: string
  subjectName: string
  assignmentId: string
  assignmentTitle: string
  /** YYYY-MM-DD or null. */
  dueDate: string | null
  status: ObligationStatus
  /** Whole days past the due date (≥ 1) for overdue work with a due date. */
  daysOverdue: number | null
  /** The teacher explicitly marked this as ขาดส่ง (status 'missing'). */
  markedMissing: boolean
}

export interface StudentMissingRow {
  studentId: string
  studentCode: string | null
  number: number | null
  firstName: string
  lastName: string
  /** Every classroom the student's listed obligations belong to. */
  classroomNames: string[]
  /** ยังไม่ส่ง column: pending + no due date (not overdue). */
  pending: number
  /** Of `pending`, how many have no due date. */
  noDue: number
  overdue: number
  total: number
  obligations: MissingObligation[]
}

export interface ClassroomGroup {
  classroomId: string
  classroomName: string
  /** One row per student, counting only this classroom's obligations. */
  students: StudentMissingRow[]
  subtotal: { pending: number; noDue: number; overdue: number; total: number; students: number }
}

export interface MissingReportSummary {
  /** Unique students in the selected scope (student count). */
  totalStudents: number
  /** Unique students with at least one listed obligation (student count). */
  studentsWithMissing: number
  /** Obligation counts (student × assignment). */
  pending: number
  noDue: number
  overdue: number
  totalObligations: number
}

export interface MissingReport {
  summary: MissingReportSummary
  /** Sorted by `filters.sort`; one row per student. */
  students: StudentMissingRow[]
  /** Same data grouped by classroom (for the A4 document). */
  groups: ClassroomGroup[]
  /** All obligations in report order (student order, then due date). */
  obligations: MissingObligation[]
}

// ==================================================
// Dates
// ==================================================

export function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value)
  return match ? match[1] : null
}

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000)
}

export function daysBetween(fromIso: string, toIso: string): number {
  return dayNumber(toIso) - dayNumber(fromIso)
}

const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const THAI_MONTHS_LONG = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']

/** "3 ต.ค. 2569" (Buddhist year); '-' for null. Deterministic (no locale). */
export function formatThaiDate(iso: string | null, style: 'short' | 'long' = 'short'): string {
  const date = dateOnly(iso)
  if (!date) return '-'
  const [y, m, d] = date.split('-').map(Number)
  const months = style === 'long' ? THAI_MONTHS_LONG : THAI_MONTHS_SHORT
  return `${d} ${months[m - 1]} ${y + 543}`
}

// ==================================================
// Classification
// ==================================================

export function classifyObligation(
  submissionStatus: 'not_submitted' | 'submitted' | 'late' | 'missing' | undefined,
  dueDate: string | null,
  today: string,
): { status: ObligationStatus; daysOverdue: number | null; markedMissing: boolean } | null {
  if (submissionStatus === 'submitted' || submissionStatus === 'late') return null
  const due = dateOnly(dueDate)
  const lateBy = due && due < today ? daysBetween(due, today) : null
  if (submissionStatus === 'missing') return { status: 'overdue', daysOverdue: lateBy, markedMissing: true }
  if (!due) return { status: 'no_due', daysOverdue: null, markedMissing: false }
  if (due < today) return { status: 'overdue', daysOverdue: lateBy, markedMissing: false }
  return { status: 'pending', daysOverdue: null, markedMissing: false }
}

export function inDueDateRange(dueDate: string | null, from: string | null, to: string | null): boolean {
  const due = dateOnly(dueDate)
  if (!due) return true
  if (from && due < from) return false
  if (to && due > to) return false
  return true
}

function studentMatchesSearch(student: AnalyticsStudent, query: string): boolean {
  if (!query) return true
  const haystack = [`${student.firstName} ${student.lastName}`, student.studentCode ?? '', student.number === null ? '' : String(student.number)].join(' ').toLowerCase()
  return haystack.includes(query)
}

function compareNumberThenName(a: { number: number | null; firstName: string; lastName: string }, b: typeof a): number {
  return (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER) || `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'th')
}

export function sortStudentRows(rows: StudentMissingRow[], sort: SortKey): StudentMissingRow[] {
  const byName = (a: StudentMissingRow, b: StudentMissingRow) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'th')
  const sorted = [...rows]
  sorted.sort((a, b) => {
    switch (sort) {
      case 'number':
        return compareNumberThenName(a, b)
      case 'name':
        return byName(a, b) || compareNumberThenName(a, b)
      case 'classroom':
        return (a.classroomNames[0] ?? '').localeCompare(b.classroomNames[0] ?? '', 'th', { numeric: true }) || compareNumberThenName(a, b)
      case 'overdue':
        return b.overdue - a.overdue || b.total - a.total || compareNumberThenName(a, b)
      default:
        return b.total - a.total || b.overdue - a.overdue || compareNumberThenName(a, b)
    }
  })
  return sorted
}

function compareObligations(a: MissingObligation, b: MissingObligation): number {
  return (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99') || a.subjectName.localeCompare(b.subjectName, 'th') || a.assignmentTitle.localeCompare(b.assignmentTitle, 'th')
}

function summarizeStudent(base: AnalyticsStudent, obligations: MissingObligation[]): StudentMissingRow {
  const sorted = [...obligations].sort(compareObligations)
  const overdue = sorted.filter((o) => o.status === 'overdue').length
  const noDue = sorted.filter((o) => o.status === 'no_due').length
  return {
    studentId: base.id,
    studentCode: base.studentCode,
    number: base.number,
    firstName: base.firstName,
    lastName: base.lastName,
    classroomNames: [...new Set(sorted.map((o) => o.classroomName))].sort((x, y) => x.localeCompare(y, 'th', { numeric: true })),
    pending: sorted.length - overdue,
    noDue,
    overdue,
    total: sorted.length,
    obligations: sorted,
  }
}

// ==================================================
// The report
// ==================================================

export interface BuildMissingReportInput {
  context: AnalyticsContext
  scope: SemesterScope
  roster: AnalyticsRoster
  assignments: AnalyticsAssignmentData
  filters: MissingReportFilters
  /** YYYY-MM-DD (local). */
  today: string
}

/** Classrooms the report covers: the semester's, narrowed by the
 * classroom filter and (when a subject is chosen) to classrooms linked
 * to that subject. */
export function reportClassroomIds(context: AnalyticsContext, scope: SemesterScope, filters: MissingReportFilters): Set<string> {
  const ids = new Set([...scope.classroomIds].filter((id) => !filters.classroomId || id === filters.classroomId))
  if (filters.subjectId) {
    const linked = new Set(context.links.filter((l) => l.subjectId === filters.subjectId).map((l) => l.classroomId))
    for (const id of [...ids]) if (!linked.has(id)) ids.delete(id)
  }
  return ids
}

export function buildMissingReport({ context, scope, roster, assignments, filters, today }: BuildMissingReportInput): MissingReport {
  const classroomIds = reportClassroomIds(context, scope, filters)
  const query = filters.search.trim().toLowerCase()
  const classroomName = new Map(context.classrooms.map((c) => [c.id, c.name]))
  const subjectName = new Map(context.subjects.map((s) => [s.id, s.name]))
  const studentById = new Map(roster.students.map((s) => [s.id, s]))
  const eligible = (s: AnalyticsStudent | undefined): s is AnalyticsStudent => Boolean(s) && s!.status !== 'inactive' && studentMatchesSearch(s!, query)

  // Students in scope (deduplicated across classrooms).
  const membersByClassroom = new Map<string, { student: AnalyticsStudent; joinedAt: string | null }[]>()
  const scopeStudents = new Set<string>()
  for (const m of roster.memberships) {
    if (!classroomIds.has(m.classroomId)) continue
    const student = studentById.get(m.studentId)
    if (!eligible(student)) continue
    scopeStudents.add(student.id)
    const list = membersByClassroom.get(m.classroomId) ?? []
    if (!list.some((x) => x.student.id === student.id)) list.push({ student, joinedAt: dateOnly(m.joinedAt ?? null) })
    membersByClassroom.set(m.classroomId, list)
  }

  const statusByKey = new Map(assignments.submissions.map((s) => [`${s.assignmentId}:${s.studentId}`, s.status]))
  const obligations: MissingObligation[] = []
  for (const assignment of assignments.assignments) {
    if (!classroomIds.has(assignment.classroomId)) continue
    if (filters.subjectId && assignment.subjectId !== filters.subjectId) continue
    if (!inDueDateRange(assignment.dueDate, filters.from, filters.to)) continue
    const due = dateOnly(assignment.dueDate)
    for (const { student, joinedAt } of membersByClassroom.get(assignment.classroomId) ?? []) {
      const key = `${assignment.id}:${student.id}`
      const recorded = statusByKey.get(key)
      // Joined after the deadline and no status recorded → not expected.
      if (recorded === undefined && due && joinedAt && joinedAt > due) continue
      const result = classifyObligation(recorded, assignment.dueDate, today)
      if (!result) continue
      if (filters.status !== 'all' && result.status !== filters.status) continue
      obligations.push({
        studentId: student.id,
        studentCode: student.studentCode,
        number: student.number,
        firstName: student.firstName,
        lastName: student.lastName,
        classroomId: assignment.classroomId,
        classroomName: classroomName.get(assignment.classroomId) ?? '-',
        subjectId: assignment.subjectId,
        subjectName: subjectName.get(assignment.subjectId) ?? '-',
        assignmentId: assignment.id,
        assignmentTitle: assignment.title,
        dueDate: due,
        ...result,
      })
    }
  }

  const byStudent = new Map<string, MissingObligation[]>()
  for (const o of obligations) byStudent.set(o.studentId, [...(byStudent.get(o.studentId) ?? []), o])
  const students = sortStudentRows(
    [...byStudent.entries()].map(([id, list]) => summarizeStudent(studentById.get(id)!, list)),
    filters.sort,
  )

  const groupMap = new Map<string, MissingObligation[]>()
  for (const o of obligations) groupMap.set(o.classroomId, [...(groupMap.get(o.classroomId) ?? []), o])
  const groups: ClassroomGroup[] = [...groupMap.entries()]
    .map(([classroomId, list]) => {
      const perStudent = new Map<string, MissingObligation[]>()
      for (const o of list) perStudent.set(o.studentId, [...(perStudent.get(o.studentId) ?? []), o])
      const rows = sortStudentRows(
        [...perStudent.entries()].map(([id, items]) => summarizeStudent(studentById.get(id)!, items)),
        filters.sort === 'total' || filters.sort === 'overdue' ? filters.sort : 'number',
      )
      return {
        classroomId,
        classroomName: classroomName.get(classroomId) ?? '-',
        students: rows,
        subtotal: {
          pending: rows.reduce((n, r) => n + r.pending, 0),
          noDue: rows.reduce((n, r) => n + r.noDue, 0),
          overdue: rows.reduce((n, r) => n + r.overdue, 0),
          total: rows.reduce((n, r) => n + r.total, 0),
          students: rows.length,
        },
      }
    })
    .sort((a, b) => a.classroomName.localeCompare(b.classroomName, 'th', { numeric: true }))

  const overdue = obligations.filter((o) => o.status === 'overdue').length
  return {
    summary: {
      totalStudents: scopeStudents.size,
      studentsWithMissing: students.length,
      pending: obligations.length - overdue,
      noDue: obligations.filter((o) => o.status === 'no_due').length,
      overdue,
      totalObligations: obligations.length,
    },
    students,
    groups,
    obligations: students.flatMap((s) => s.obligations),
  }
}

// ==================================================
// Document metadata + exports (shared by preview, PDF, Word, CSV)
// ==================================================

export interface MissingReportMeta {
  title: string
  subtitle: string
  schoolName: string | null
  teacherName: string | null
  classroomLabel: string
  subjectLabel: string
  semesterLabel: string
  periodLabel: string
  statusLabel: string
  searchLabel: string | null
  /** YYYY-MM-DD */
  generatedOn: string
}

export const MISSING_REPORT_TITLE = 'รายงานติดตามการส่งงานของนักเรียน'

export function buildReportMeta(input: {
  context: AnalyticsContext
  scope: SemesterScope
  filters: MissingReportFilters
  teacherName: string | null
  schoolName?: string | null
  today: string
}): MissingReportMeta {
  const { context, scope, filters } = input
  const classroom = filters.classroomId ? context.classrooms.find((c) => c.id === filters.classroomId)?.name : null
  const subject = filters.subjectId ? context.subjects.find((s) => s.id === filters.subjectId)?.name : null
  const period =
    filters.from || filters.to
      ? `กำหนดส่ง ${filters.from ? formatThaiDate(filters.from, 'long') : 'ตั้งแต่ต้น'} – ${filters.to ? formatThaiDate(filters.to, 'long') : 'ปัจจุบัน'} (รวมงานที่ไม่มีกำหนดส่ง)`
      : 'ทุกกำหนดส่งในภาคเรียนที่เลือก'
  return {
    title: MISSING_REPORT_TITLE,
    subtitle: 'ระบบ KrunameClass',
    schoolName: input.schoolName?.trim() || null,
    teacherName: input.teacherName?.trim() || null,
    classroomLabel: classroom ?? 'ทุกห้องเรียน',
    subjectLabel: subject ?? 'ทุกรายวิชา',
    semesterLabel: scope.label,
    periodLabel: period,
    statusLabel: STATUS_FILTER_LABEL[filters.status],
    searchLabel: filters.search.trim() ? `ค้นหา: “${filters.search.trim()}”` : null,
    generatedOn: input.today,
  }
}

export function obligationStatusText(o: MissingObligation): string {
  if (o.status === 'overdue') return o.daysOverdue ? `ขาดส่ง (เลยกำหนด ${o.daysOverdue} วัน)` : 'ขาดส่ง'
  return OBLIGATION_STATUS_LABEL[o.status]
}

export function studentDisplayName(s: { firstName: string; lastName: string }): string {
  return `${s.firstName} ${s.lastName}`.trim()
}

/** Detailed CSV: one row per student-assignment obligation. */
export function buildMissingCsvTable(report: MissingReport, meta: MissingReportMeta): ExportTable {
  return {
    title: meta.title,
    subtitle: [meta.classroomLabel, meta.subjectLabel, meta.semesterLabel, meta.periodLabel].join(' · '),
    headers: ['เลขที่', 'รหัสนักเรียน', 'ชื่อ-นามสกุล', 'ห้องเรียน', 'รายวิชา', 'ชื่องาน', 'กำหนดส่ง', 'สถานะ', 'จำนวนวันที่เลยกำหนด'],
    rows: report.obligations.map((o) => [
      o.number ?? '',
      o.studentCode ?? '',
      studentDisplayName(o),
      o.classroomName,
      o.subjectName,
      o.assignmentTitle,
      o.dueDate ?? '',
      OBLIGATION_STATUS_LABEL[o.status],
      o.daysOverdue ?? '',
    ]),
  }
}

export function reportFilenameBase(meta: MissingReportMeta): string {
  return `รายงานงานค้างส่ง-${meta.classroomLabel}-${meta.generatedOn}`.replace(/[\\/:*?"<>|]+/g, '-')
}
