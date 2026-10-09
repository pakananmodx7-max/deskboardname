import { readFileSync } from 'node:fs'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ToastProvider } from '@/components/ui/toast'

import {
  ALL_SEMESTERS,
  attendanceDateSpan,
  buildClassroomCards,
  classroomGradeLabel,
  cleanAttendanceRecords,
  computeAssignmentProgress,
  computeAttendanceBreakdown,
  computeSummary,
  filterClassroomCards,
  listSemesterOptions,
  rankMostAbsences,
  computeStudentAttendanceStats,
  resolveSemesterScope,
  UNASSIGNED_SEMESTER,
  type AnalyticsAssignmentData,
  type AnalyticsAttendanceRecord,
  type AnalyticsContext,
  type AnalyticsRoster,
} from './analytics'
import { ClassroomAnalyticsDashboard, type ClassroomAnalyticsDashboardProps } from './components/classroom-analytics-dashboard'
import { WidgetBoundary } from './components/widget-boundary'
import { success } from './resource'

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf-8')
}

// Two real semesters + one classroom with no semester. Student "shared"
// is on a classroom in each semester.
const CONTEXT: AnalyticsContext = {
  classrooms: [
    { id: 'a1', name: 'ม.1/1', academicYear: '2569', semester: '1', isActive: true, gradeLevel: 'ม.1' },
    { id: 'a2', name: 'ม.2/1', academicYear: '2569', semester: '1', isActive: false },
    { id: 'b1', name: 'ม.1/1', academicYear: '2568', semester: '2', isActive: true },
    { id: 'u1', name: 'ชุมนุมดนตรี', academicYear: null, semester: null, isActive: true },
  ],
  subjects: [
    { id: 'thai', name: 'ภาษาไทย', academicYear: '2569', semester: '1' },
    { id: 'math', name: 'คณิตศาสตร์', academicYear: '2569', semester: '1' },
    { id: 'old', name: 'วิทยาศาสตร์', academicYear: '2568', semester: '2' },
  ],
  links: [
    { subjectId: 'thai', classroomId: 'a1' },
    { subjectId: 'math', classroomId: 'a1' },
    { subjectId: 'math', classroomId: 'a2' },
    { subjectId: 'old', classroomId: 'b1' },
  ],
}

function student(id: string, firstName: string) {
  return { id, firstName, lastName: 'ทดสอบ', studentCode: id, number: 1, status: 'active' as const }
}

const ROSTER: AnalyticsRoster = {
  memberships: [
    { studentId: 'shared', classroomId: 'a1' },
    { studentId: 'shared', classroomId: 'b1' },
    { studentId: 'x', classroomId: 'a1' },
    { studentId: 'y', classroomId: 'a2' },
    { studentId: 'z', classroomId: 'b1' },
    { studentId: 'club', classroomId: 'u1' },
  ],
  students: [student('shared', 'สมชาย'), student('x', 'เอก'), student('y', 'วาย'), student('z', 'แซด'), student('club', 'ชมรม')],
}

const RECORDS: AnalyticsAttendanceRecord[] = [
  { sessionId: 's1', classroomId: 'a1', subjectId: 'thai', date: '2026-08-03', studentId: 'shared', status: 'present' },
  { sessionId: 's1', classroomId: 'a1', subjectId: 'thai', date: '2026-08-03', studentId: 'x', status: 'absent' },
  { sessionId: 's2', classroomId: 'a1', subjectId: 'thai', date: '2026-08-10', studentId: 'x', status: 'absent' },
  { sessionId: 'o1', classroomId: 'b1', subjectId: 'old', date: '2026-01-12', studentId: 'z', status: 'absent' },
  { sessionId: 'o1', classroomId: 'b1', subjectId: 'old', date: '2026-01-12', studentId: 'shared', status: 'present' },
  { sessionId: 'c1', classroomId: 'u1', subjectId: null, date: '2026-07-01', studentId: 'club', status: 'late' },
]

const ASSIGNMENTS: AnalyticsAssignmentData = {
  assignments: [
    { id: 'w1', classroomId: 'a1', subjectId: 'thai', title: 'เรียงความ', dueDate: '2026-12-01' },
    { id: 'w2', classroomId: 'a1', subjectId: 'math', title: 'แบบฝึกหัด', dueDate: '2026-08-01' },
    { id: 'w3', classroomId: 'b1', subjectId: 'old', title: 'รายงานเก่า', dueDate: '2026-01-01' },
  ],
  submissions: [{ assignmentId: 'w1', studentId: 'x', status: 'submitted' }],
}

const TODAY = '2026-09-30'

describe('semester scope — every widget follows one semester', () => {
  it('cross-semester isolation: another semester\'s classrooms, students, records and assignments never count', () => {
    const scope = resolveSemesterScope(CONTEXT, '2569|1')
    expect([...scope.classroomIds].sort()).toEqual(['a1', 'a2'])
    expect(computeSummary(scope, ROSTER)).toMatchObject({ uniqueStudents: 3, classroomsInScope: 2, activeClassrooms: 1, subjects: 2 })
    const records = cleanAttendanceRecords(RECORDS, scope.classroomIds, TODAY)
    expect(records.every((r) => scope.classroomIds.has(r.classroomId))).toBe(true)
    expect(computeAttendanceBreakdown(records)).toMatchObject({ total: 3, present: 1, absent: 2 })
    expect(computeAssignmentProgress(ASSIGNMENTS, ROSTER, scope, TODAY).assignmentCount).toBe(2)
    expect(attendanceDateSpan(records)).toEqual({ first: '2026-08-03', last: '2026-08-10' })
  })

  it('ทุกภาคเรียน aggregates every classroom and counts a student on two classrooms once', () => {
    const scope = resolveSemesterScope(CONTEXT, ALL_SEMESTERS)
    expect(scope.classroomIds.size).toBe(4)
    expect(computeSummary(scope, ROSTER).uniqueStudents).toBe(5) // "shared" once, not twice
    expect(buildClassroomCards(CONTEXT, scope, ROSTER)).toHaveLength(4)
    expect(computeAttendanceBreakdown(cleanAttendanceRecords(RECORDS, scope.classroomIds, TODAY)).total).toBe(6)
  })

  it('ไม่ระบุภาคเรียน contains only records explicitly without a semester', () => {
    expect(listSemesterOptions(CONTEXT).map((o) => o.key)).toContain(UNASSIGNED_SEMESTER)
    const scope = resolveSemesterScope(CONTEXT, UNASSIGNED_SEMESTER)
    expect([...scope.classroomIds]).toEqual(['u1'])
    expect(computeSummary(scope, ROSTER).uniqueStudents).toBe(1)
    expect(cleanAttendanceRecords(RECORDS, scope.classroomIds, TODAY).map((r) => r.studentId)).toEqual(['club'])
  })

  it('attendance ranking within a semester uses only that semester\'s records', () => {
    const scope = resolveSemesterScope(CONTEXT, '2568|2')
    const records = cleanAttendanceRecords(RECORDS, scope.classroomIds, TODAY)
    const ranked = rankMostAbsences(computeStudentAttendanceStats(records, ROSTER, scope, CONTEXT.links))
    expect(ranked.map((r) => [r.item.studentId, r.item.absent, r.rank])).toEqual([['z', 1, 1]])
  })

  it('assignment status can be narrowed to one subject ("ทุกวิชา" = all)', () => {
    const scope = resolveSemesterScope(CONTEXT, '2569|1')
    const all = computeAssignmentProgress(ASSIGNMENTS, ROSTER, scope, TODAY)
    const thai = computeAssignmentProgress(ASSIGNMENTS, ROSTER, scope, TODAY, 'thai')
    expect(all.assignmentCount).toBe(2)
    expect(thai).toMatchObject({ assignmentCount: 1, slots: 2, completed: 1, pending: 1, notSubmitted: 0 })
    expect(computeAssignmentProgress(ASSIGNMENTS, ROSTER, scope, TODAY, 'old').assignmentCount).toBe(0)
  })
})

describe('classroom section data', () => {
  const scope = resolveSemesterScope(CONTEXT, '2569|1')

  it('cards: student count from the semester roster, linked subjects, semester label; active first', () => {
    const cards = buildClassroomCards(CONTEXT, scope, ROSTER)
    expect(cards.map((c) => [c.classroom.id, c.studentCount, c.subjectNames, c.semesterLabel, c.gradeLabel])).toEqual([
      ['a1', 2, ['คณิตศาสตร์', 'ภาษาไทย'], 'ภาคเรียนที่ 1/2569', 'ม.1'],
      ['a2', 1, ['คณิตศาสตร์'], 'ภาคเรียนที่ 1/2569', 'ม.2'],
    ])
    // Roster still loading: cards render, counts unknown (0 until ready).
    expect(buildClassroomCards(CONTEXT, scope, null).map((c) => c.studentCount)).toEqual([0, 0])
  })

  it('grade label: explicit grade level, else from the name, else "-"', () => {
    expect(classroomGradeLabel({ id: '1', name: 'ม.3/2', academicYear: null, semester: null, isActive: true })).toBe('ม.3')
    expect(classroomGradeLabel({ id: '1', name: 'x', academicYear: null, semester: null, isActive: true, gradeLevel: 'ป.6' })).toBe('ป.6')
    expect(classroomGradeLabel({ id: '1', name: 'ชุมนุม', academicYear: null, semester: null, isActive: true })).toBe('-')
  })

  it('filters: name/subject search, grade and status combine', () => {
    const cards = buildClassroomCards(CONTEXT, scope, ROSTER)
    expect(filterClassroomCards(cards, { search: 'ไทย', grade: '', status: 'all' }).map((c) => c.classroom.id)).toEqual(['a1'])
    expect(filterClassroomCards(cards, { search: '', grade: 'ม.2', status: 'all' }).map((c) => c.classroom.id)).toEqual(['a2'])
    expect(filterClassroomCards(cards, { search: '', grade: '', status: 'archived' }).map((c) => c.classroom.id)).toEqual(['a2'])
    expect(filterClassroomCards(cards, { search: '', grade: '', status: 'active' }).map((c) => c.classroom.id)).toEqual(['a1'])
    expect(filterClassroomCards(cards, { search: 'ไม่มี', grade: '', status: 'all' })).toEqual([])
  })
})

const noop = () => {}

function render(semesterKey: string | null, overrides: Partial<ClassroomAnalyticsDashboardProps> = {}): string {
  const props: ClassroomAnalyticsDashboardProps = {
    context: success(CONTEXT),
    onRetryContext: noop,
    scope: semesterKey ? resolveSemesterScope(CONTEXT, semesterKey) : null,
    roster: success(ROSTER),
    onRetryRoster: noop,
    attendance: success(RECORDS),
    onRetryAttendance: noop,
    assignments: success(ASSIGNMENTS),
    onRetryAssignments: noop,
    teacherName: 'ครูสมศรี',
    classroomsEditable: false,
    onClassroomsChanged: noop,
    today: TODAY,
    ...overrides,
  }
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ToastProvider, null, createElement(ClassroomAnalyticsDashboard, props))))
}

describe('unified dashboard (rendered)', () => {
  it('greeting, semester card, summary, charts, rankings and the classroom section on one page', () => {
    const html = render('2569|1')
    expect(html).toContain('สวัสดี, ครูสมศรี')
    expect(html).toContain('ในภาคเรียนที่ 1/2569')
    expect(html).toContain('2 ห้องเรียน · 2 รายวิชา')
    expect(html).toContain('เช็คชื่อ 3 ส.ค. 2569 – 10 ส.ค. 2569')
    expect(html).toContain('ใช้งานอยู่ 1 ห้อง')
    expect(html).toContain('ภาพรวมการเข้าเรียน')
    expect(html).toContain('สถานะการส่งงาน')
    expect(html).toMatch(/<option value=""[^>]*>ทุกวิชา<\/option>/)
    expect(html).toContain('id="classrooms"')
    expect(html).toContain('ห้องเรียนของฉัน (2 ห้อง)')
    expect(html).toContain('href="/teacher/classrooms/a1"')
    // Other semester's classroom is not listed.
    expect(html).not.toContain('href="/teacher/classrooms/b1"')
  })

  it('ทุกภาคเรียน labels the aggregation period', () => {
    const html = render(ALL_SEMESTERS)
    expect(html).toContain('รวมทุกภาคเรียน')
    expect(html).toContain('ทุกภาคเรียน (รวม 3 ภาคเรียน)')
    expect(html).toContain('ห้องเรียนของฉัน (4 ห้อง)')
  })

  it('a semester without roll calls says so in the semester card', () => {
    const html = render('2569|1', { attendance: success([]) })
    expect(html).toContain('ยังไม่มีบันทึกเช็คชื่อ')
  })

  it('roster still loading: classroom cards show a pending count, never "0 คน"', () => {
    const html = render('2569|1', { roster: { status: 'loading' } })
    expect(html).toContain('… คน')
    expect(html).not.toContain('>0 คน')
  })

  it('Demo Mode: create classroom disabled with a reason; real mode enables it', () => {
    expect(render('2569|1')).toContain('title="ไม่รองรับในโหมดสาธิต"')
    expect(render('2569|1', { classroomsEditable: true })).not.toContain('ไม่รองรับในโหมดสาธิต')
  })

  it('context error: classroom section is replaced by the page-level error, not an empty list', () => {
    const html = render(null, { context: { status: 'error', error: 'โหลดไม่สำเร็จ' } })
    expect(html).toContain('ลองใหม่')
    expect(html).not.toContain('id="classrooms"')
  })

  it('a widget that throws while rendering is contained by its error boundary', () => {
    expect(WidgetBoundary.getDerivedStateFromError()).toEqual({ failed: true })
    const boundary = new WidgetBoundary({ title: 'ทดสอบ', children: null })
    boundary.state = { failed: true }
    const html = renderToStaticMarkup(createElement(() => boundary.render()))
    expect(html).toContain('แสดงส่วน “ทดสอบ” ไม่สำเร็จ')
    expect(html).toContain('ลองใหม่')
  })
})

describe('classroom management actions reuse existing dialogs, services and routes', () => {
  const section = readSource('./components/classroom-section.tsx')

  it('create / edit / archive / restore go through the existing dialogs and classroom-service', () => {
    expect(section).toContain("from '@/features/classroom-management/create-classroom-dialog'")
    expect(section).toContain("from '@/features/classroom-management/edit-classroom-dialog'")
    expect(section).toContain("import { archiveClassroom, reactivateClassroom } from '@/services/classroom-service'")
    expect(section).toContain('<ConfirmDialog')
    expect(section).not.toMatch(/\.from\('classrooms'\)|getSupabaseClient/)
  })

  it('open / view students / manage subjects use the existing routes', () => {
    expect(section).toContain('`/teacher/classrooms/${id}`')
    expect(section).toContain("buildClassroomTabPath(card.classroom.id, 'students')")
    expect(section).toContain("navigate('/teacher/subjects')")
  })

  it('mutating actions are only offered when editable (real mode)', () => {
    expect(section).toContain('...(editable && record')
    expect(section).toContain('disabled={!editable}')
  })

  it('no per-classroom requests: counts come from the semester roster already loaded', () => {
    expect(section).not.toMatch(/getStudentsByClassroom|getClassroomSubjects/)
  })
})
