import { describe, expect, it } from 'vitest'

import type { AnalyticsAttendanceRecord, AttendanceStatus } from '@/features/classroom-analytics/analytics'
import { CONTEXT, ROSTER, SCOPE, TODAY } from '@/features/reports-missing/missing-report.fixtures'
import { buildCsvContent } from '@/lib/export/export-table'

import {
  ATTENDANCE_BANDS,
  bandOf,
  buildAttendanceCsvTable,
  buildAttendanceMeta,
  buildAttendanceReport,
  DEFAULT_ATTENDANCE_FILTERS,
  followUpReasons,
  formatRate,
  paginate,
  rateOf,
  resolveDateRange,
  type AttendanceReportFilters,
} from './attendance-report-model'
import { attendanceBackHref, attendanceFiltersFromParams, attendanceFiltersToParams, attendancePrintHref } from './attendance-report-params'

// TODAY = 2026-10-10. Classrooms c1 (s1, s2, inactive s3), c2 (s4, s5), other semester "old" (s6).
let seq = 0
function rec(classroomId: string, studentId: string, status: AttendanceStatus, date: string, subjectId: string | null = 'hist', sessionId?: string): AnalyticsAttendanceRecord {
  return { sessionId: sessionId ?? `x${seq++}`, classroomId, subjectId, date, studentId, status }
}

const RECORDS: AnalyticsAttendanceRecord[] = [
  // Session A (c1, hist, 1 Oct): s1 present, s2 absent
  rec('c1', 's1', 'present', '2026-10-01', 'hist', 'A'),
  rec('c1', 's2', 'absent', '2026-10-01', 'hist', 'A'),
  // duplicate row of the same session × student — must count once
  rec('c1', 's1', 'present', '2026-10-01', 'hist', 'A'),
  // Session B (c1, sci, 5 Oct): s1 late, s2 absent
  rec('c1', 's1', 'late', '2026-10-05', 'sci', 'B'),
  rec('c1', 's2', 'absent', '2026-10-05', 'sci', 'B'),
  // Session C (c1 homeroom, 8 Oct): s2 absent, s1 leave
  rec('c1', 's2', 'absent', '2026-10-08', null, 'C'),
  rec('c1', 's1', 'leave', '2026-10-08', null, 'C'),
  // Session D (c2, hist, 9 Sep — outside 30 days): s4 present
  rec('c2', 's4', 'present', '2026-09-09', 'hist', 'D'),
  // Session E (c2, hist, 9 Oct): s4 present (s5 unchecked → NOT absent)
  rec('c2', 's4', 'present', '2026-10-09', 'hist', 'E'),
  // future-dated (ignored) and other-semester (ignored)
  rec('c1', 's1', 'absent', '2026-10-20', 'hist', 'F'),
  rec('old', 's6', 'absent', '2026-10-02', 'oldsub', 'G'),
]

function build(patch: Partial<AttendanceReportFilters> = {}) {
  return buildAttendanceReport({ context: CONTEXT, scope: SCOPE, roster: ROSTER, records: RECORDS, filters: { ...DEFAULT_ATTENDANCE_FILTERS, ...patch }, today: TODAY })
}

describe('calculation rules', () => {
  it('rate = present ÷ recorded entries; no entries → ยังไม่มีข้อมูล (never 0% or 100%)', () => {
    expect(rateOf({ present: 3, total: 4 })).toBe(75)
    expect(rateOf({ present: 0, total: 0 })).toBeNull()
    expect(formatRate(null)).toBe('ยังไม่มีข้อมูล')
    expect(formatRate(92.857)).toBe('92.9%')
  })

  it('bands are display indicators with configurable thresholds', () => {
    expect(ATTENDANCE_BANDS).toEqual({ excellent: 90, good: 80 })
    expect([bandOf(95), bandOf(90), bandOf(89.99), bandOf(80), bandOf(79.9), bandOf(null)]).toEqual(['excellent', 'excellent', 'good', 'good', 'attention', 'no_data'])
  })

  it('follow-up uses the follow-up tab absence threshold and the low-rate band', () => {
    expect(followUpReasons({ present: 0, late: 0, leave: 0, absent: 3, total: 3 }, 0)).toHaveLength(2)
    expect(followUpReasons({ present: 9, late: 0, leave: 0, absent: 1, total: 10 }, 90)).toEqual([])
  })

  it('date presets (local dates)', () => {
    expect(resolveDateRange({ preset: 'today', from: null, to: null }, TODAY)).toEqual({ from: TODAY, to: TODAY })
    expect(resolveDateRange({ preset: '7d', from: null, to: null }, TODAY)).toEqual({ from: '2026-10-04', to: TODAY })
    expect(resolveDateRange({ preset: '30d', from: null, to: null }, TODAY)).toEqual({ from: '2026-09-11', to: TODAY })
    expect(resolveDateRange({ preset: 'semester', from: null, to: null }, TODAY)).toEqual({ from: null, to: null })
    expect(resolveDateRange({ preset: 'custom', from: '2026-10-01', to: '2026-10-05' }, TODAY)).toEqual({ from: '2026-10-01', to: '2026-10-05' })
  })
})

describe('overview (semester 1/2569, last 30 days)', () => {
  const r = build()

  it('students are unique; status totals are recorded entries; duplicates counted once', () => {
    // Students: s1, s2, s4, s5 (s3 inactive, s6 other semester).
    expect(r.summary).toMatchObject({ uniqueStudents: 4, sessions: 4, present: 2, late: 1, leave: 1, absent: 3, total: 7 })
    expect(r.summary.rate).toBeCloseTo((2 / 7) * 100)
  })

  it('unchecked students are not counted as absent; a student with no entries shows no rate', () => {
    const s5 = r.students.find((s) => s.studentId === 's5')!
    expect(s5).toMatchObject({ total: 0, absent: 0, rate: null, band: 'no_data', followUp: false })
    expect(r.summary.studentsWithoutRecords).toBe(1)
  })

  it('per-student rows: counts, rate, band, follow-up', () => {
    const s2 = r.students.find((s) => s.studentId === 's2')!
    expect(s2).toMatchObject({ present: 0, absent: 3, total: 3, rate: 0, band: 'attention', followUp: true, classroomNames: ['ม.1/1'] })
    const s1 = r.students.find((s) => s.studentId === 's1')!
    expect(s1).toMatchObject({ present: 1, late: 1, leave: 1, total: 3 })
    expect(r.summary.followUpCount).toBe(2) // s1 (33% rate) and s2
  })

  it('classroom panel: every semester classroom with enrolled students, sessions and rate', () => {
    expect(r.classrooms.map((c) => [c.classroomName, c.students, c.sessions, c.total, c.rate === null ? null : Math.round(c.rate)])).toEqual([
      ['ม.1/1', 2, 3, 6, 17],
      ['ม.1/2', 2, 1, 1, 100],
    ])
  })
})

describe('filters', () => {
  it('classroom', () => {
    const r = build({ view: 'classroom', classroomId: 'c2' })
    expect(r.students.map((s) => s.studentId).sort()).toEqual(['s4', 's5'])
    expect(r.classroomDetail).toMatchObject({ classroomName: 'ม.1/2', students: 2, sessions: 1, followUpCount: 0 })
    expect(r.summary).toMatchObject({ uniqueStudents: 2, total: 1, present: 1 })
  })

  it('subject (homeroom roll calls are excluded when a subject is chosen)', () => {
    const r = build({ view: 'subject', subjectId: 'sci' })
    expect(r.summary).toMatchObject({ total: 2, late: 1, absent: 1, sessions: 1 })
    expect(r.subjectBreakdown.map((c) => c.classroomName)).toEqual(['ม.1/1'])
  })

  it('semester: another semester only sees its own classrooms', () => {
    const old = { ...SCOPE, classrooms: [CONTEXT.classrooms[2]], classroomIds: new Set(['old']), subjects: [CONTEXT.subjects[2]] }
    const r = buildAttendanceReport({ context: CONTEXT, scope: old, roster: ROSTER, records: RECORDS, filters: { ...DEFAULT_ATTENDANCE_FILTERS }, today: TODAY })
    expect(r.students.map((s) => s.studentId)).toEqual(['s6'])
    expect(r.summary.absent).toBe(1)
  })

  it('date range: whole semester includes older sessions; today only today', () => {
    expect(build({ preset: 'semester' }).summary.total).toBe(8)
    expect(build({ preset: 'today' }).summary.total).toBe(0)
    expect(build({ preset: 'custom', from: '2026-10-05', to: '2026-10-08' }).summary.total).toBe(4)
  })

  it('status band and follow-up filters', () => {
    expect(build({ band: 'no_data' }).students.map((s) => s.studentId)).toEqual(['s5'])
    expect(build({ band: 'follow_up' }).students.map((s) => s.studentId).sort()).toEqual(['s1', 's2'])
    expect(build({ band: 'excellent' }).students.map((s) => s.studentId)).toEqual(['s4'])
  })

  it('search by name, number or student code (summary follows the visible students)', () => {
    const r = build({ search: 'กัลย' })
    expect(r.students.map((s) => s.studentId)).toEqual(['s2'])
    expect(r.summary).toMatchObject({ uniqueStudents: 1, total: 3, absent: 3 })
    expect(build({ search: 'Ss4' }).students.map((s) => s.studentId)).toEqual(['s4'])
  })

  it('zero records at all', () => {
    const r = buildAttendanceReport({ context: CONTEXT, scope: SCOPE, roster: ROSTER, records: [], filters: DEFAULT_ATTENDANCE_FILTERS, today: TODAY })
    expect(r.summary).toMatchObject({ uniqueStudents: 4, total: 0, rate: null, sessions: 0, studentsWithoutRecords: 4 })
  })
})

describe('sorting and pagination', () => {
  it('sorts by number, name, rate (no-data last) and counts in both directions', () => {
    expect(build({ sort: 'number' }).students.map((s) => s.studentId)).toEqual(['s1', 's4', 's2', 's5'])
    expect(build({ sort: 'rate', direction: 'asc' }).students.map((s) => s.studentId)).toEqual(['s2', 's1', 's4', 's5'])
    expect(build({ sort: 'rate', direction: 'desc' }).students.map((s) => s.studentId)).toEqual(['s4', 's1', 's2', 's5'])
    expect(build({ sort: 'absent', direction: 'desc' }).students[0].studentId).toBe('s2')
    expect(build({ sort: 'name' }).students.map((s) => s.studentId)).toEqual(['s1', 's2', 's4', 's5'])
  })

  it('paginate clamps the page', () => {
    const items = Array.from({ length: 25 }, (_, i) => i)
    expect(paginate(items, 3, 10)).toEqual({ items: [20, 21, 22, 23, 24], page: 3, pageCount: 3 })
    expect(paginate(items, 9, 10).page).toBe(3)
    expect(paginate([], 1, 10)).toEqual({ items: [], page: 1, pageCount: 1 })
  })
})

describe('student detail', () => {
  it('history (newest first), weekly trend and the subject used for Student Analytics', () => {
    const r = build({ view: 'student', studentId: 's1' })
    expect(r.student?.history.map((h) => [h.date, h.status, h.subjectName])).toEqual([
      ['2026-10-08', 'leave', null],
      ['2026-10-05', 'late', 'วิทยาศาสตร์'],
      ['2026-10-01', 'present', 'ประวัติศาสตร์ไทย'],
    ])
    expect(r.student?.weekly.length).toBeGreaterThan(0)
    expect(r.student?.analyticsClassroomId).toBe('c1')
    expect(['hist', 'sci']).toContain(r.student?.analyticsSubjectId)
  })

  it('a remembered student does not narrow other views (or their exports)', () => {
    const r = build({ view: 'overview', studentId: 's1' })
    expect(r.student).toBeNull()
    expect(r.students.length).toBe(4)
  })
})

describe('URL filters and exports', () => {
  it('round-trips through the URL; invalid values fall back to defaults', () => {
    const f: AttendanceReportFilters = { view: 'classroom', classroomId: 'c1', subjectId: 'hist', preset: 'custom', from: '2026-10-01', to: '2026-10-09', band: 'follow_up', search: 'กฤษ', sort: 'rate', direction: 'desc', studentId: null }
    expect(attendanceFiltersFromParams(attendanceFiltersToParams(f))).toEqual(f)
    expect(attendanceFiltersFromParams(new URLSearchParams('av=nope&ap=x&ab=y&asort=z'))).toEqual(DEFAULT_ATTENDANCE_FILTERS)
    expect(attendancePrintHref({ ...DEFAULT_ATTENDANCE_FILTERS, classroomId: 'c1' })).toBe('/teacher/reports/attendance/print?ac=c1')
    expect(attendanceBackHref({ ...DEFAULT_ATTENDANCE_FILTERS, classroomId: 'c1' })).toBe('/teacher/reports?tab=attendance&ac=c1')
  })

  it('CSV: one row per student (all pages), Thai headers, UTF-8 BOM, entries labelled ครั้ง', () => {
    const r = build()
    const meta = buildAttendanceMeta({ context: CONTEXT, scope: SCOPE, filters: DEFAULT_ATTENDANCE_FILTERS, report: r, teacherName: 'ครูทดสอบ', today: TODAY })
    const table = buildAttendanceCsvTable(r, meta)
    expect(table.headers).toContain('มาเรียน (ครั้ง)')
    expect(table.rows).toHaveLength(r.students.length)
    expect(table.rows.find((row) => row[2] === 'ฐิติพงศ์ จุลไชย')?.[9]).toBe('ยังไม่มีข้อมูล')
    expect(buildCsvContent(table).charCodeAt(0)).toBe(0xfeff)
    expect(meta).toMatchObject({ schoolName: null, classroomLabel: 'ทุกห้องเรียน', semesterLabel: 'ภาคเรียนที่ 1/2569', periodLabel: 'วันที่ 11 กันยายน 2569 – 10 ตุลาคม 2569 (30 วันล่าสุด)' })
  })
})
