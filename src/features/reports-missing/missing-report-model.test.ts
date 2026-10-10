import { describe, expect, it } from 'vitest'

import { buildCsvContent } from '@/lib/export/export-table'

import { ASSIGNMENTS, CONTEXT, filters, ROSTER, SCOPE, TODAY } from './missing-report.fixtures'
import {
  buildMissingCsvTable,
  buildMissingReport,
  buildReportMeta,
  classifyObligation,
  daysBetween,
  formatThaiDate,
  inDueDateRange,
  type MissingReportFilters,
} from './missing-report-model'
import { backToReportHref, filtersFromParams, filtersToParams, printPreviewHref } from './missing-report-params'

function build(patch: Partial<MissingReportFilters> = {}, data = { roster: ROSTER, assignments: ASSIGNMENTS }) {
  return buildMissingReport({ context: CONTEXT, scope: SCOPE, roster: data.roster, assignments: data.assignments, filters: filters(patch), today: TODAY })
}

describe('classification (existing statuses: submitted / late / missing / not_submitted)', () => {
  it('submitted and late (ส่งช้า) are qualifying submissions — never counted', () => {
    expect(classifyObligation('submitted', '2026-01-01', TODAY)).toBeNull()
    expect(classifyObligation('late', '2026-01-01', TODAY)).toBeNull()
  })

  it('no submission row = not_submitted: pending before the due date, overdue after', () => {
    expect(classifyObligation(undefined, '2026-10-10', TODAY)).toEqual({ status: 'pending', daysOverdue: null, markedMissing: false })
    expect(classifyObligation(undefined, '2026-10-09', TODAY)).toEqual({ status: 'overdue', daysOverdue: 1, markedMissing: false })
  })

  it('no due date is never overdue — classified separately as ไม่มีกำหนดส่ง', () => {
    expect(classifyObligation('not_submitted', null, TODAY)).toEqual({ status: 'no_due', daysOverdue: null, markedMissing: false })
  })

  it('teacher-marked missing is overdue (days only when there is a past due date)', () => {
    expect(classifyObligation('missing', null, TODAY)).toEqual({ status: 'overdue', daysOverdue: null, markedMissing: true })
    expect(classifyObligation('missing', '2026-09-30', TODAY)).toEqual({ status: 'overdue', daysOverdue: 10, markedMissing: true })
  })

  it('date helpers', () => {
    expect(daysBetween('2026-09-01', TODAY)).toBe(39)
    expect(formatThaiDate('2026-10-10')).toBe('10 ต.ค. 2569')
    expect(formatThaiDate('2026-10-10', 'long')).toBe('10 ตุลาคม 2569')
    expect(formatThaiDate(null)).toBe('-')
  })
})

describe('report (semester 1/2569, all classrooms)', () => {
  const report = build()

  it('one row per student, sorted by total outstanding work', () => {
    expect(report.students.map((s) => [s.studentId, s.pending, s.overdue, s.total])).toEqual([
      ['s2', 1, 2, 3], // a1 overdue, a2 pending, a3 marked missing
      ['s4', 0, 1, 1], // a4 overdue (ties on total break by overdue count)
      ['s1', 1, 0, 1], // a3 no due date
    ])
    expect(new Set(report.students.map((s) => s.studentId)).size).toBe(report.students.length)
  })

  it('summary: students are counted once; obligations are student × assignment', () => {
    // In scope: s1, s2, s4, s5 (s3 inactive, s6 other semester).
    expect(report.summary).toEqual({ totalStudents: 4, studentsWithMissing: 3, pending: 2, noDue: 1, overdue: 3, totalObligations: 5 })
  })

  it('summary totals equal the sum of the detail rows', () => {
    const fromRows = report.students.reduce((acc, s) => ({ pending: acc.pending + s.pending, overdue: acc.overdue + s.overdue }), { pending: 0, overdue: 0 })
    expect(fromRows).toEqual({ pending: report.summary.pending, overdue: report.summary.overdue })
    expect(report.obligations).toHaveLength(report.summary.totalObligations)
  })

  it('inactive students and other semesters are excluded', () => {
    expect(report.obligations.some((o) => o.studentId === 's3' || o.studentId === 's6')).toBe(false)
    expect(report.obligations.some((o) => o.assignmentId === 'a5')).toBe(false)
  })

  it('a student who joined after the due date is not expected to have submitted it', () => {
    expect(report.obligations.some((o) => o.studentId === 's5')).toBe(false)
    const withRecordedRow = build({}, { roster: ROSTER, assignments: { ...ASSIGNMENTS, submissions: [...ASSIGNMENTS.submissions, { assignmentId: 'a4', studentId: 's5', status: 'missing' }] } })
    expect(withRecordedRow.obligations.some((o) => o.studentId === 's5')).toBe(true)
  })

  it('details carry title, subject, classroom, due date, status and days overdue', () => {
    const s2 = report.students[0]
    expect(s2.obligations.map((o) => [o.assignmentTitle, o.subjectName, o.classroomName, o.dueDate, o.status, o.daysOverdue])).toEqual([
      ['ใบงานที่ 1 ยุคหิน', 'ประวัติศาสตร์ไทย', 'ม.1/1', '2026-09-01', 'overdue', 39],
      ['ใบงานที่ 2 รัฐโบราณ', 'ประวัติศาสตร์ไทย', 'ม.1/1', '2026-10-20', 'pending', null],
      ['รายงานการทดลอง', 'วิทยาศาสตร์', 'ม.1/1', null, 'overdue', null],
    ])
  })

  it('groups by classroom with subtotals (for the A4 document)', () => {
    expect(report.groups.map((g) => [g.classroomName, g.subtotal])).toEqual([
      ['ม.1/1', { pending: 2, noDue: 1, overdue: 2, total: 4, students: 2 }],
      ['ม.1/2', { pending: 0, noDue: 0, overdue: 1, total: 1, students: 1 }],
    ])
  })

  it('a duplicated submission row cannot double-count (one status per assignment × student)', () => {
    const dup = build({}, { roster: ROSTER, assignments: { ...ASSIGNMENTS, submissions: [...ASSIGNMENTS.submissions, { assignmentId: 'a1', studentId: 's1', status: 'submitted' }] } })
    expect(dup.summary).toEqual(report.summary)
  })
})

describe('filters', () => {
  it('classroom', () => {
    const r = build({ classroomId: 'c2' })
    expect(r.summary).toMatchObject({ totalStudents: 2, studentsWithMissing: 1, overdue: 1, pending: 0 })
  })

  it('subject (and only classrooms linked to it)', () => {
    const sci = build({ subjectId: 'sci' })
    expect(sci.obligations.every((o) => o.subjectId === 'sci')).toBe(true)
    expect(sci.summary.totalStudents).toBe(2) // only c1 is linked to sci
  })

  it('semester: another semester sees only its own classrooms', () => {
    const r = buildMissingReport({ context: CONTEXT, scope: { ...SCOPE, classroomIds: new Set(['old']), classrooms: [CONTEXT.classrooms[2]] }, roster: ROSTER, assignments: ASSIGNMENTS, filters: filters(), today: TODAY })
    expect(r.obligations.map((o) => o.assignmentId)).toEqual(['a5'])
  })

  it('date range filters by due date; no-due-date work is always included', () => {
    expect(inDueDateRange(null, '2026-10-01', '2026-10-31')).toBe(true)
    const r = build({ from: '2026-10-01', to: '2026-10-31' })
    expect(r.obligations.map((o) => o.assignmentId).sort()).toEqual(['a2', 'a3', 'a3'])
  })

  it('status', () => {
    expect(build({ status: 'overdue' }).obligations.every((o) => o.status === 'overdue')).toBe(true)
    expect(build({ status: 'no_due' }).obligations.map((o) => o.studentId)).toEqual(['s1'])
    expect(build({ status: 'pending' }).summary).toMatchObject({ pending: 1, overdue: 0 })
  })

  it('search by name, number or student code', () => {
    expect(build({ search: 'กัลย' }).students.map((s) => s.studentId)).toEqual(['s2'])
    expect(build({ search: 'Ss4' }).students.map((s) => s.studentId)).toEqual(['s4'])
    expect(build({ search: 'ไม่มีชื่อนี้' }).summary).toMatchObject({ totalStudents: 0, studentsWithMissing: 0 })
  })

  it('sorting', () => {
    expect(build({ sort: 'number' }).students.map((s) => s.studentId)).toEqual(['s1', 's4', 's2'])
    expect(build({ sort: 'overdue' }).students.map((s) => s.studentId)).toEqual(['s2', 's4', 's1'])
    expect(build({ sort: 'classroom' }).students.map((s) => s.studentId)).toEqual(['s1', 's2', 's4'])
    expect(build({ sort: 'name' }).students.map((s) => s.studentId)).toEqual(['s1', 's2', 's4'])
  })

  it('empty report', () => {
    const r = build({}, { roster: ROSTER, assignments: { assignments: [], submissions: [] } })
    expect(r).toMatchObject({ students: [], groups: [], obligations: [], summary: { totalStudents: 4, studentsWithMissing: 0, pending: 0, overdue: 0 } })
  })
})

describe('filters survive the trip to the print preview (URL)', () => {
  it('round-trips and ignores invalid values', () => {
    const f = filters({ classroomId: 'c1', subjectId: 'hist', from: '2026-09-01', to: '2026-10-31', status: 'overdue', search: 'กฤษ', sort: 'name' })
    expect(filtersFromParams(filtersToParams(f))).toEqual(f)
    expect(filtersFromParams(new URLSearchParams('st=bogus&sort=x&from=yesterday'))).toEqual(filters())
  })

  it('preview and back links carry the same filters; the report tab is kept', () => {
    const f = filters({ classroomId: 'c1', status: 'overdue' })
    expect(printPreviewHref(f)).toBe('/teacher/reports/missing/print?mc=c1&st=overdue')
    expect(backToReportHref(f)).toBe('/teacher/reports?tab=missing&mc=c1&st=overdue')
  })
})

describe('CSV export (one row per obligation, UTF-8 BOM for Excel)', () => {
  const report = build()
  const meta = buildReportMeta({ context: CONTEXT, scope: SCOPE, filters: filters(), teacherName: 'ครูทดสอบ', today: TODAY })
  const table = buildMissingCsvTable(report, meta)

  it('has the agreed columns and exactly the report obligations', () => {
    expect(table.headers).toEqual(['เลขที่', 'รหัสนักเรียน', 'ชื่อ-นามสกุล', 'ห้องเรียน', 'รายวิชา', 'ชื่องาน', 'กำหนดส่ง', 'สถานะ', 'จำนวนวันที่เลยกำหนด'])
    expect(table.rows).toHaveLength(report.summary.totalObligations)
    expect(table.rows[0]).toEqual([2, 'Ss2', 'กัลยวรรณ ทองคำ', 'ม.1/1', 'ประวัติศาสตร์ไทย', 'ใบงานที่ 1 ยุคหิน', '2026-09-01', 'ขาดส่ง', 39])
  })

  it('Thai text is preserved with a UTF-8 BOM', () => {
    const csv = buildCsvContent(table)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('ใบงานที่ 2 รัฐโบราณ')
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(csv))).toBe(csv)
  })

  it('meta never invents a school name; labels the scope and period', () => {
    expect(meta).toMatchObject({ schoolName: null, teacherName: 'ครูทดสอบ', classroomLabel: 'ทุกห้องเรียน', subjectLabel: 'ทุกรายวิชา', semesterLabel: 'ภาคเรียนที่ 1/2569', periodLabel: 'ทุกกำหนดส่งในภาคเรียนที่เลือก' })
  })
})
