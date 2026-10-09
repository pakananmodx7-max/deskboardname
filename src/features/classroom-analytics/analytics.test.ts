import { describe, expect, it } from 'vitest'

import {
  ALL_SEMESTERS,
  ANALYTICS_RULES,
  assignRanks,
  attendanceUnit,
  buildTeacherInsights,
  classifyAbsenceRisk,
  cleanAttendanceRecords,
  computeAssignmentProgress,
  computeAttendanceBreakdown,
  computeRiskList,
  computeStudentAttendanceStats,
  computeSummary,
  computeWeeklyTrend,
  listSemesterOptions,
  percentOf,
  pickDefaultSemester,
  rankHighestAttendance,
  rankMostAbsences,
  resolveSemesterScope,
  weekStartOf,
  type AnalyticsAttendanceRecord,
  type AnalyticsContext,
  type AnalyticsRoster,
  type AttendanceStatus,
  type StudentAttendanceStat,
} from './analytics'
import { buildDemoAnalyticsDataset } from './demo-adapter'

// ==================================================
// Fixtures
// ==================================================

const CONTEXT: AnalyticsContext = {
  classrooms: [
    { id: 'c1', name: 'ม.1/1', academicYear: '2569', semester: '1', isActive: true },
    { id: 'c2', name: 'ม.1/2', academicYear: '2569', semester: '1', isActive: false },
    { id: 'old', name: 'ม.1/1', academicYear: '2568', semester: '2', isActive: true },
  ],
  subjects: [
    { id: 'thai', name: 'ภาษาไทย', academicYear: '2569', semester: '1' },
    { id: 'linked', name: 'วิชาเลือก', academicYear: null, semester: null },
    { id: 'oldsub', name: 'คณิต', academicYear: '2568', semester: '2' },
  ],
  links: [
    { subjectId: 'thai', classroomId: 'c1' },
    { subjectId: 'linked', classroomId: 'c2' },
    { subjectId: 'oldsub', classroomId: 'old' },
  ],
}

function student(id: string, firstName: string, status: 'active' | 'inactive' = 'active') {
  return { id, firstName, lastName: 'ทดสอบ', studentCode: id.toUpperCase(), number: 1, status }
}

const ROSTER: AnalyticsRoster = {
  memberships: [
    { studentId: 'a', classroomId: 'c1' },
    { studentId: 'b', classroomId: 'c1' },
    { studentId: 'c', classroomId: 'c1' },
    { studentId: 'd', classroomId: 'c2' },
    // 'a' is also in c2 — must be counted once.
    { studentId: 'a', classroomId: 'c2' },
    { studentId: 'x', classroomId: 'old' },
  ],
  students: [student('a', 'อนันต์'), student('b', 'บุญมี'), student('c', 'เกศินี'), student('d', 'ดารา', 'inactive'), student('x', 'เอ็กซ์')],
}

let seq = 0
function rec(studentId: string, date: string, status: AttendanceStatus, classroomId = 'c1', subjectId: string | null = null, sessionId?: string): AnalyticsAttendanceRecord {
  seq += 1
  return { sessionId: sessionId ?? `${classroomId}:${subjectId ?? 'home'}:${date}`, classroomId, subjectId, date, studentId, status }
}

const SCOPE = resolveSemesterScope(CONTEXT, '2569|1')
const TODAY = '2026-09-30'

/** n daily records for one student: `absent` absences, the rest present. */
function series(studentId: string, n: number, absent: number, classroomId = 'c1'): AnalyticsAttendanceRecord[] {
  return Array.from({ length: n }, (_, i) => {
    const day = String(1 + i).padStart(2, '0')
    return rec(studentId, `2026-08-${day}`, i < absent ? 'absent' : 'present', classroomId)
  })
}

function stat(overrides: Partial<StudentAttendanceStat>): StudentAttendanceStat {
  return {
    studentId: 's',
    fullName: 'นักเรียน',
    studentCode: null,
    classroomId: 'c1',
    classroomName: 'ม.1/1',
    present: 0,
    late: 0,
    leave: 0,
    absent: 0,
    total: 0,
    rate: null,
    analyticsSubjectId: null,
    ...overrides,
  }
}

// ==================================================
// Semester filtering
// ==================================================

describe('semester filtering', () => {
  it('lists every semester newest first, plus ทุกภาคเรียน', () => {
    expect(listSemesterOptions(CONTEXT).map((o) => o.label)).toEqual(['ภาคเรียนที่ 1/2569', 'ภาคเรียนที่ 2/2568', 'ไม่ระบุภาคเรียน', 'ทุกภาคเรียน'])
  })

  it('defaults to the newest semester with an active classroom', () => {
    expect(pickDefaultSemester(CONTEXT)).toBe('2569|1')
    const onlyOldActive: AnalyticsContext = { ...CONTEXT, classrooms: CONTEXT.classrooms.map((c) => ({ ...c, isActive: c.id === 'old' })) }
    expect(pickDefaultSemester(onlyOldActive)).toBe('2568|2')
    expect(pickDefaultSemester({ classrooms: [], subjects: [], links: [] })).toBe(ALL_SEMESTERS)
  })

  it('scope = classrooms of that semester; subjects linked to them or of that semester', () => {
    expect(SCOPE.classrooms.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(SCOPE.subjects.map((s) => s.id).sort()).toEqual(['linked', 'thai'])
    const old = resolveSemesterScope(CONTEXT, '2568|2')
    expect(old.classrooms.map((c) => c.id)).toEqual(['old'])
    expect(old.subjects.map((s) => s.id)).toEqual(['oldsub'])
    expect(resolveSemesterScope(CONTEXT, ALL_SEMESTERS).classrooms).toHaveLength(3)
  })

  it('records of another semester\'s classrooms never count', () => {
    const records = [rec('a', '2026-08-03', 'absent'), rec('x', '2026-08-03', 'absent', 'old')]
    expect(cleanAttendanceRecords(records, SCOPE.classroomIds, TODAY).map((r) => r.studentId)).toEqual(['a'])
  })

  it('summary: unique students (a student in two classrooms counts once), active classrooms, subjects', () => {
    expect(computeSummary(SCOPE, ROSTER)).toEqual({ uniqueStudents: 4, activeStudents: 3, activeClassrooms: 1, classroomsInScope: 2, subjects: 2 })
  })
})

// ==================================================
// Attendance percentages + missing/incomplete records
// ==================================================

describe('attendance calculations', () => {
  it('rate = present / recorded entries; late/leave/absent are separate; denominator is entries, not students', () => {
    const records = [rec('a', '2026-08-03', 'present'), rec('a', '2026-08-04', 'late'), rec('b', '2026-08-03', 'absent'), rec('b', '2026-08-04', 'leave')]
    const b = computeAttendanceBreakdown(records)
    expect(b).toMatchObject({ present: 1, late: 1, leave: 1, absent: 1, total: 4, sessions: 2, studentsWithRecords: 2 })
    expect(b.rate).toBe(25)
    expect(percentOf(1, 4)).toBe(25)
    expect(percentOf(1, 0)).toBeNull()
  })

  it('no records -> rate null (never 0%)', () => {
    expect(computeAttendanceBreakdown([]).rate).toBeNull()
  })

  it('drops duplicates, future-dated, invalid-status and out-of-scope records', () => {
    const dup = rec('a', '2026-08-03', 'present', 'c1', null, 'S1')
    const records = [
      dup,
      { ...dup, status: 'absent' as const },
      rec('a', '2026-10-05', 'absent'), // after today
      { ...rec('b', '2026-08-03', 'present'), status: 'unknown' as AttendanceStatus },
      { ...rec('c', 'not-a-date', 'present') },
      rec('d', '2026-08-03', 'absent', 'elsewhere'),
    ]
    const cleaned = cleanAttendanceRecords(records, SCOPE.classroomIds, TODAY)
    expect(cleaned).toHaveLength(1)
    expect(cleaned[0].status).toBe('present')
  })

  it('labels absences by the actual data model: วัน (homeroom), คาบ (subject), ครั้ง (mixed)', () => {
    expect(attendanceUnit([rec('a', '2026-08-03', 'absent')])).toBe('วัน')
    expect(attendanceUnit([rec('a', '2026-08-03', 'absent', 'c1', 'thai')])).toBe('คาบ')
    expect(attendanceUnit([rec('a', '2026-08-03', 'absent'), rec('a', '2026-08-03', 'absent', 'c1', 'thai')])).toBe('ครั้ง')
  })

  it('a record for a student no longer on any roster counts in totals but is left out of rankings', () => {
    const records = [rec('ghost', '2026-08-03', 'absent'), rec('a', '2026-08-03', 'absent')]
    expect(computeAttendanceBreakdown(records).absent).toBe(2)
    expect(computeStudentAttendanceStats(records, ROSTER, SCOPE, CONTEXT.links).map((s) => s.studentId)).toEqual(['a'])
  })
})

describe('weekly trend', () => {
  it('weeks start on Monday', () => {
    expect(weekStartOf('2026-08-03')).toBe('2026-08-03') // Monday
    expect(weekStartOf('2026-08-09')).toBe('2026-08-03') // Sunday
    expect(weekStartOf('2026-08-10')).toBe('2026-08-10')
  })

  it('is chronological regardless of input order, and a week with no roll call is a gap (null), not 0%', () => {
    const records = [
      rec('a', '2026-08-24', 'absent'),
      rec('a', '2026-08-03', 'present'),
      rec('b', '2026-08-04', 'absent'),
      // week of 08-10: nothing recorded
      rec('a', '2026-08-17', 'present'),
    ]
    const weeks = computeWeeklyTrend(records)
    expect(weeks.map((w) => [w.weekStart, w.index, w.rate])).toEqual([
      ['2026-08-03', 1, 50],
      ['2026-08-10', 2, null],
      ['2026-08-17', 3, 100],
      ['2026-08-24', 4, 0],
    ])
    expect(weeks[0]).toMatchObject({ weekEnd: '2026-08-09', present: 1, total: 2 })
  })

  it('classroom filter; empty input -> no points', () => {
    const records = [rec('a', '2026-08-03', 'present'), rec('d', '2026-08-03', 'absent', 'c2')]
    expect(computeWeeklyTrend(records, 'c2').map((w) => w.rate)).toEqual([0])
    expect(computeWeeklyTrend([])).toEqual([])
  })
})

// ==================================================
// Rankings and ties
// ==================================================

describe('rankings', () => {
  it('competition ranking: equal keys share a rank, the next rank skips (1, 1, 3)', () => {
    expect(assignRanks([5, 5, 3, 3, 1], String).map((r) => r.rank)).toEqual([1, 1, 3, 3, 5])
  })

  it('most absences: highest first, ties share a rank (ordered by lower rate, then name), zero-absence students excluded', () => {
    const stats = [
      stat({ studentId: 'p', fullName: 'ข', absent: 4, total: 10, rate: 60 }),
      stat({ studentId: 'q', fullName: 'ก', absent: 4, total: 10, rate: 50 }),
      stat({ studentId: 'r', fullName: 'ค', absent: 9, total: 10, rate: 10 }),
      stat({ studentId: 's', fullName: 'ง', absent: 0, total: 10, rate: 100 }),
    ]
    expect(rankMostAbsences(stats).map((r) => [r.rank, r.item.studentId])).toEqual([
      [1, 'r'],
      [2, 'q'],
      [2, 'p'],
    ])
  })

  it('top five only', () => {
    const stats = Array.from({ length: 8 }, (_, i) => stat({ studentId: `s${i}`, fullName: `n${i}`, absent: i + 1, total: 20, rate: 50 }))
    expect(rankMostAbsences(stats)).toHaveLength(ANALYTICS_RULES.TOP_N)
  })

  it('highest attendance: students with too few recorded sessions are never ranked above well-covered ones', () => {
    const stats = [
      stat({ studentId: 'few', fullName: 'ก', present: 2, total: 2, rate: 100 }), // < MIN_SESSIONS
      stat({ studentId: 'partial', fullName: 'ข', present: 10, total: 10, rate: 100 }), // < 80% of 40
      stat({ studentId: 'full', fullName: 'ค', present: 39, total: 40, rate: 97.5 }),
      stat({ studentId: 'full2', fullName: 'ง', present: 36, total: 40, rate: 90 }),
    ]
    expect(rankHighestAttendance(stats).map((r) => r.item.studentId)).toEqual(['full', 'full2'])
  })

  it('highest attendance ties: same rate shares a rank, more recorded sessions listed first', () => {
    const stats = [
      stat({ studentId: 'x', fullName: 'ข', present: 32, total: 32, rate: 100 }),
      stat({ studentId: 'y', fullName: 'ก', present: 40, total: 40, rate: 100 }),
      stat({ studentId: 'z', fullName: 'ค', present: 36, total: 40, rate: 90 }),
    ]
    expect(rankHighestAttendance(stats).map((r) => [r.rank, r.item.studentId])).toEqual([
      [1, 'y'],
      [1, 'x'],
      [3, 'z'],
    ])
  })

  it('per-student stats: a student on two classrooms is shown under the one holding most records; link subject = most-recorded subject', () => {
    const records = [
      rec('a', '2026-08-03', 'absent', 'c2', 'linked'),
      rec('a', '2026-08-04', 'absent', 'c2', 'linked'),
      rec('a', '2026-08-03', 'present', 'c1', 'thai'),
    ]
    const [s] = computeStudentAttendanceStats(records, ROSTER, SCOPE, CONTEXT.links)
    expect(s).toMatchObject({ classroomId: 'c2', classroomName: 'ม.1/2', absent: 2, present: 1, total: 3, analyticsSubjectId: 'linked' })
  })

  it('homeroom-only records fall back to a subject linked to the classroom (or null when none)', () => {
    const [s] = computeStudentAttendanceStats([rec('b', '2026-08-03', 'present')], ROSTER, SCOPE, CONTEXT.links)
    expect(s.analyticsSubjectId).toBe('thai')
    const [t] = computeStudentAttendanceStats([rec('b', '2026-08-03', 'present')], ROSTER, SCOPE, [])
    expect(t.analyticsSubjectId).toBeNull()
  })
})

// ==================================================
// Risk classification
// ==================================================

describe('risk classification (operational follow-up, not a diagnosis)', () => {
  it('thresholds: 5+ เฝ้าระวัง, 10+ ติดตามด่วน', () => {
    expect([0, 4, 5, 9, 10, 25].map(classifyAbsenceRisk)).toEqual([null, null, 'monitor', 'monitor', 'high', 'high'])
  })

  it('lists high before monitor, more absences first, each with the reason and the threshold used', () => {
    const records = [...series('a', 20, 12), ...series('b', 20, 6), ...series('c', 20, 4)]
    const stats = computeStudentAttendanceStats(records, ROSTER, SCOPE, CONTEXT.links)
    const list = computeRiskList(stats, attendanceUnit(records))
    expect(list.map((r) => [r.stat.studentId, r.level])).toEqual([
      ['a', 'high'],
      ['b', 'monitor'],
    ])
    expect(list[0].reason).toBe('ขาด 12 วัน จาก 20 วันที่เช็คชื่อ (เกณฑ์ติดตามด่วน 10 วันขึ้นไป)')
    expect(list[1].reason).toContain('เกณฑ์เฝ้าระวัง 5 วันขึ้นไป')
  })
})

// ==================================================
// Assignments
// ==================================================

describe('assignment progress', () => {
  const data = {
    assignments: [
      { id: 'past', classroomId: 'c1', subjectId: 'thai', title: 'งานเก่า', dueDate: '2026-09-01' },
      { id: 'future', classroomId: 'c1', subjectId: 'thai', title: 'งานใหม่', dueDate: '2026-10-15' },
      { id: 'other', classroomId: 'old', subjectId: 'oldsub', title: 'ภาคก่อน', dueDate: '2026-01-01' },
    ],
    submissions: [
      { assignmentId: 'past', studentId: 'a', status: 'submitted' as const },
      { assignmentId: 'past', studentId: 'b', status: 'late' as const },
      // c: no row on the past assignment -> not submitted (past due)
      { assignmentId: 'future', studentId: 'a', status: 'missing' as const },
    ],
  }

  it('counts student × assignment slots (labelled as such), split into completed / pending / not submitted', () => {
    const p = computeAssignmentProgress(data, ROSTER, SCOPE, TODAY)
    expect(p).toMatchObject({ assignmentCount: 2, openAssignmentCount: 1, slots: 6, completed: 2, completedLate: 1, pending: 2, notSubmitted: 2 })
  })

  it('inactive students are not expected to submit; other semesters are excluded', () => {
    const p = computeAssignmentProgress(
      { assignments: [{ id: 'x', classroomId: 'c2', subjectId: 'linked', title: 'x', dueDate: null }], submissions: [] },
      ROSTER,
      SCOPE,
      TODAY,
    )
    // c2 roster: a (active), d (inactive)
    expect(p).toMatchObject({ slots: 1, pending: 1 })
  })
})

// ==================================================
// Teacher insights
// ==================================================

describe('teacher insights (deterministic rules)', () => {
  const classroomName = (id: string) => (id === 'c1' ? 'ม.1/1' : 'ม.1/2')

  it('flags high-absence students, a declining classroom, a low latest week and a high non-submission assignment', () => {
    const weekly = [
      { weekStart: '2026-08-03', weekEnd: '2026-08-09', index: 1, present: 95, total: 100, rate: 95 },
      { weekStart: '2026-08-10', weekEnd: '2026-08-16', index: 2, present: 95, total: 100, rate: 95 },
      { weekStart: '2026-08-17', weekEnd: '2026-08-23', index: 3, present: 80, total: 100, rate: 80 },
      { weekStart: '2026-08-24', weekEnd: '2026-08-30', index: 4, present: 70, total: 100, rate: 70 },
    ]
    const insights = buildTeacherInsights({
      breakdown: { present: 340, late: 0, leave: 0, absent: 60, total: 400, sessions: 20, studentsWithRecords: 20, rate: 85 },
      weekly,
      weeklyByClassroom: [{ classroom: SCOPE.classrooms[0], points: weekly }],
      risk: [{ stat: stat({ absent: 12 }), level: 'high', reason: '' }],
      unit: 'วัน',
      assignments: {
        assignmentCount: 1,
        openAssignmentCount: 0,
        slots: 10,
        completed: 5,
        completedLate: 0,
        pending: 0,
        notSubmitted: 5,
        perAssignment: [{ assignment: { id: 'p', classroomId: 'c1', subjectId: 'thai', title: 'ใบงาน 1', dueDate: '2026-09-01' }, roster: 10, notSubmitted: 5, pastDue: true }],
      },
      classroomName,
    })
    expect(insights.map((i) => i.id)).toEqual(['risk-high', 'decline-c1', 'low-week', 'non-submission'])
    expect(insights[1].message).toBe('อัตรามาเรียนห้อง ม.1/1 ลดลงจาก 95% เหลือ 75% ใน 2 สัปดาห์ล่าสุด')
    expect(insights[3].message).toContain('ยังไม่ส่ง 5 จาก 10 คน (50%)')
  })

  it('good attendance and no problems -> one positive note; no data -> nothing', () => {
    const good = buildTeacherInsights({
      breakdown: { present: 95, late: 0, leave: 0, absent: 5, total: 100, sessions: 5, studentsWithRecords: 20, rate: 95 },
      weekly: [],
      weeklyByClassroom: [],
      risk: [],
      unit: 'วัน',
      assignments: null,
      classroomName,
    })
    expect(good.map((i) => i.tone)).toEqual(['positive'])
    expect(
      buildTeacherInsights({ breakdown: null, weekly: null, weeklyByClassroom: null, risk: null, unit: 'ครั้ง', assignments: null, classroomName }),
    ).toEqual([])
  })
})

// ==================================================
// Demo Mode compatibility
// ==================================================

describe('Demo Mode adapter', () => {
  it('maps demo data into the same dataset shape — semester from linked subjects, only attendance the demo holds', () => {
    const dataset = buildDemoAnalyticsDataset(
      {
        classroomName: 'ม.5/1',
        classrooms: [
          { id: 'd1', name: 'ม.5/1', studentIds: ['s1', 's2'] },
          { id: 'd2', name: 'ม.5/2', studentIds: ['s3'] },
        ],
        allStudents: [
          { id: 's1', number: 1, studentCode: '1', firstName: 'ก', lastName: 'ข', nickname: '', classroom: 'ม.5/1', status: 'active' },
          { id: 's2', number: 2, studentCode: '', firstName: 'ค', lastName: 'ง', nickname: '', classroom: 'ม.5/1', status: 'inactive' },
          { id: 's3', number: 1, studentCode: '3', firstName: 'จ', lastName: 'ฉ', nickname: '', classroom: 'ม.5/2', status: 'active' },
        ],
        subjects: [{ id: 'sub', name: 'ฟิสิกส์', code: 'ว1', academicYear: '2569', semester: '1', description: '', classroomIds: ['d1'] }],
        subjectAssignments: [
          { id: 'x1', subjectId: 'sub', classroomId: 'd1', topicId: null, title: 'งาน', type: 'worksheet', maxScore: 10, dueDate: '2026-09-01', description: '', isArchived: false, submissions: { s1: { status: 'submitted', score: 8, note: '' } } },
          { id: 'x2', subjectId: 'sub', classroomId: 'd1', topicId: null, title: 'เก็บแล้ว', type: 'worksheet', maxScore: 10, dueDate: '2026-09-01', description: '', isArchived: true, submissions: {} },
        ] as never,
        subjectAttendance: { sub: { d1: { '2026-09-01': { s1: 'absent', s2: 'present' } } } },
        attendance: { s1: 'present' },
      },
      '2026-09-15',
    )
    expect(dataset.context.classrooms.map((c) => [c.id, c.academicYear, c.semester])).toEqual([
      ['d1', '2569', '1'],
      ['d2', null, null],
    ])
    expect(dataset.attendance).toHaveLength(3)
    expect(dataset.attendance.filter((r) => r.subjectId === null)).toEqual([
      { sessionId: 'homeroom:d1:2026-09-15', classroomId: 'd1', subjectId: null, date: '2026-09-15', studentId: 's1', status: 'present' },
    ])
    expect(dataset.assignments.assignments.map((a) => a.id)).toEqual(['x1'])
    expect(dataset.roster.students.find((s) => s.id === 's2')?.studentCode).toBeNull()

    const scope = resolveSemesterScope(dataset.context, pickDefaultSemester(dataset.context))
    expect(scope.classrooms.map((c) => c.id)).toEqual(['d1'])
    expect(computeAttendanceBreakdown(cleanAttendanceRecords(dataset.attendance, scope.classroomIds, '2026-09-15'))).toMatchObject({ total: 3, absent: 1 })
  })
})
