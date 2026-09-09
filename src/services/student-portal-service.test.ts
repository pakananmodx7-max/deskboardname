import { describe, expect, it } from 'vitest'

import {
  computeAttendanceRate,
  computeMyGrades,
  filterMyAssignments,
  getPendingAssignments,
  summarizeMyAttendance,
} from '@/services/student-portal-service'
import type { MyAssignment, MyAttendanceRecord } from '@/types/student-portal'

function assignment(overrides: Partial<MyAssignment> = {}): MyAssignment {
  return {
    id: 'a1',
    subjectId: 'subj-1',
    subjectName: 'คณิตศาสตร์',
    classroomId: 'room-1',
    classroomName: 'ม.5/1',
    title: 'แบบฝึกหัด',
    description: null,
    maxScore: 100,
    dueDate: '2026-09-01',
    status: 'not_submitted',
    score: null,
    ...overrides,
  }
}

function attendance(overrides: Partial<MyAttendanceRecord> = {}): MyAttendanceRecord {
  return {
    sessionId: 's1',
    classroomId: 'room-1',
    classroomName: 'ม.5/1',
    subjectId: null,
    subjectName: null,
    periodNumber: null,
    attendanceDate: '2026-09-01',
    status: 'present',
    ...overrides,
  }
}

describe('filterMyAssignments — /student/assignments filter tabs', () => {
  const items = [
    assignment({ id: 'a1', status: 'not_submitted' }),
    assignment({ id: 'a2', status: 'submitted' }),
    assignment({ id: 'a3', status: 'late' }),
    assignment({ id: 'a4', status: 'missing' }),
  ]

  it('"all" returns every assignment unfiltered', () => {
    expect(filterMyAssignments(items, 'all')).toHaveLength(4)
  })

  it('filters to exactly one status at a time', () => {
    expect(filterMyAssignments(items, 'not_submitted').map((a) => a.id)).toEqual(['a1'])
    expect(filterMyAssignments(items, 'submitted').map((a) => a.id)).toEqual(['a2'])
    expect(filterMyAssignments(items, 'late').map((a) => a.id)).toEqual(['a3'])
    expect(filterMyAssignments(items, 'missing').map((a) => a.id)).toEqual(['a4'])
  })
})

describe('getPendingAssignments — dashboard "งานที่ต้องทำ"', () => {
  it('includes not_submitted and late, excludes submitted and missing', () => {
    const items = [
      assignment({ id: 'a1', status: 'not_submitted' }),
      assignment({ id: 'a2', status: 'submitted' }),
      assignment({ id: 'a3', status: 'late' }),
      assignment({ id: 'a4', status: 'missing' }),
    ]
    expect(getPendingAssignments(items).map((a) => a.id)).toEqual(['a1', 'a3'])
  })
})

describe('summarizeMyAttendance / computeAttendanceRate', () => {
  it('tallies each status and computes the present-rate percentage', () => {
    const records = [
      attendance({ status: 'present' }),
      attendance({ status: 'present' }),
      attendance({ status: 'late' }),
      attendance({ status: 'absent' }),
    ]
    const summary = summarizeMyAttendance(records)
    expect(summary).toEqual({ present: 2, late: 1, leave: 0, absent: 1, total: 4 })
    expect(computeAttendanceRate(summary)).toBe(50)
  })

  it('returns null attendance rate (never NaN) when there is no history yet', () => {
    const summary = summarizeMyAttendance([])
    expect(summary.total).toBe(0)
    expect(computeAttendanceRate(summary)).toBeNull()
  })
})

describe('computeMyGrades — /student/grades, never another student\'s data', () => {
  it('groups by subject+classroom, computing per-subject and grand totals', () => {
    const items = [
      assignment({ id: 'a1', subjectId: 'math', subjectName: 'คณิตศาสตร์', classroomId: 'r1', maxScore: 100, score: 80 }),
      assignment({ id: 'a2', subjectId: 'math', subjectName: 'คณิตศาสตร์', classroomId: 'r1', maxScore: 50, score: null }),
      assignment({ id: 'a3', subjectId: 'eng', subjectName: 'อังกฤษ', classroomId: 'r1', maxScore: 100, score: 60 }),
    ]
    const result = computeMyGrades(items)

    expect(result.bySubject).toHaveLength(2)
    const math = result.bySubject.find((s) => s.subjectId === 'math')!
    expect(math.earned).toBe(80)
    expect(math.possible).toBe(150)
    expect(math.percentage).toBeCloseTo((80 / 150) * 100)
    expect(math.assignments.find((a) => a.assignmentId === 'a2')?.percentage).toBeNull()

    expect(result.totalEarned).toBe(140)
    expect(result.totalPossible).toBe(250)
    expect(result.totalPercentage).toBeCloseTo((140 / 250) * 100)
  })

  it('never shows a class average/highest/lowest — the summary has no such fields', () => {
    const result = computeMyGrades([assignment()])
    expect(result).not.toHaveProperty('classAverage')
    expect(result).not.toHaveProperty('highest')
    expect(result).not.toHaveProperty('lowest')
  })

  it('returns an empty summary (0/0/null) with no assignments', () => {
    const result = computeMyGrades([])
    expect(result).toEqual({ bySubject: [], totalEarned: 0, totalPossible: 0, totalPercentage: null })
  })
})
