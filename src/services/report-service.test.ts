import { describe, expect, it } from 'vitest'

import {
  aggregateAttendanceSummary,
  buildMissingAssignmentRows,
  filterAssignmentsByDateRange,
  groupAssignmentsBySubjectClassroom,
  type RawAttendanceRecord,
} from '@/services/report-service'
import type { Assignment, AssignmentSubmission } from '@/types/assignment'
import type { ReportStudentRef } from '@/types/report'

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: 'a1',
    subjectId: 'subj-1',
    classroomId: 'room-1',
    topicId: null,
    title: 'แบบฝึกหัด',
    description: null,
    maxScore: 100,
    dueDate: '2026-09-15',
    isArchived: false,
    createdBy: 'teacher-1',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

function studentRef(overrides: Partial<ReportStudentRef> = {}): ReportStudentRef {
  return {
    studentId: 's1',
    studentCode: 'S001',
    number: 1,
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    classroomId: 'room-1',
    classroomName: 'ม.5/1',
    ...overrides,
  }
}

describe('filterAssignmentsByDateRange — date-range correctness', () => {
  it('includes an assignment whose due date falls within the range', () => {
    const items = [assignment({ id: 'a1', dueDate: '2026-09-10' })]
    expect(filterAssignmentsByDateRange(items, '2026-09-01', '2026-09-30').map((a) => a.id)).toEqual(['a1'])
  })

  it('excludes an assignment whose due date falls outside the range', () => {
    const items = [
      assignment({ id: 'before', dueDate: '2026-08-31' }),
      assignment({ id: 'after', dueDate: '2026-10-01' }),
    ]
    expect(filterAssignmentsByDateRange(items, '2026-09-01', '2026-09-30')).toHaveLength(0)
  })

  it('includes boundary dates (inclusive range)', () => {
    const items = [assignment({ id: 'start', dueDate: '2026-09-01' }), assignment({ id: 'end', dueDate: '2026-09-30' })]
    expect(filterAssignmentsByDateRange(items, '2026-09-01', '2026-09-30').map((a) => a.id)).toEqual(['start', 'end'])
  })

  it('always includes an assignment with no due date, regardless of range', () => {
    const items = [assignment({ id: 'no-date', dueDate: null })]
    expect(filterAssignmentsByDateRange(items, '2026-01-01', '2026-01-02').map((a) => a.id)).toEqual(['no-date'])
  })
})

describe('groupAssignmentsBySubjectClassroom — subject isolation', () => {
  it('never merges two different subjects in the same classroom into one group', () => {
    const items = [
      assignment({ id: 'math1', subjectId: 'math', classroomId: 'room-1' }),
      assignment({ id: 'eng1', subjectId: 'eng', classroomId: 'room-1' }),
    ]
    const groups = groupAssignmentsBySubjectClassroom(items)
    expect(Object.keys(groups).sort()).toEqual(['eng:room-1', 'math:room-1'])
    expect(groups['math:room-1'].map((a) => a.id)).toEqual(['math1'])
    expect(groups['eng:room-1'].map((a) => a.id)).toEqual(['eng1'])
  })

  it('never merges the same subject across two different classrooms into one group', () => {
    const items = [
      assignment({ id: 'r1', subjectId: 'math', classroomId: 'room-1' }),
      assignment({ id: 'r2', subjectId: 'math', classroomId: 'room-2' }),
    ]
    const groups = groupAssignmentsBySubjectClassroom(items)
    expect(Object.keys(groups).sort()).toEqual(['math:room-1', 'math:room-2'])
  })
})

describe('aggregateAttendanceSummary — attendance totals + classroom isolation', () => {
  it('tallies present/late/leave/absent and computes the attendance rate for one student', () => {
    const refs = new Map([['s1:room-1', studentRef()]])
    const records: RawAttendanceRecord[] = [
      { studentId: 's1', classroomId: 'room-1', status: 'present' },
      { studentId: 's1', classroomId: 'room-1', status: 'present' },
      { studentId: 's1', classroomId: 'room-1', status: 'late' },
      { studentId: 's1', classroomId: 'room-1', status: 'absent' },
    ]
    const rows = aggregateAttendanceSummary(records, refs)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ present: 2, late: 1, leave: 0, absent: 1, total: 4 })
    expect(rows[0].attendanceRate).toBe(50)
  })

  it('never merges the same student\'s records across two different classrooms into one row', () => {
    const refs = new Map([
      ['s1:room-1', studentRef({ classroomId: 'room-1', classroomName: 'ม.5/1' })],
      ['s1:room-2', studentRef({ classroomId: 'room-2', classroomName: 'ม.5/2' })],
    ])
    const records: RawAttendanceRecord[] = [
      { studentId: 's1', classroomId: 'room-1', status: 'present' },
      { studentId: 's1', classroomId: 'room-2', status: 'absent' },
    ]
    const rows = aggregateAttendanceSummary(records, refs)
    expect(rows).toHaveLength(2)
    const room1 = rows.find((r) => r.classroomId === 'room-1')!
    const room2 = rows.find((r) => r.classroomId === 'room-2')!
    expect(room1).toMatchObject({ present: 1, absent: 0, total: 1 })
    expect(room2).toMatchObject({ present: 0, absent: 1, total: 1 })
  })

  it('returns null attendanceRate (never NaN) for a student with zero records reachable — i.e. skips refs with no records', () => {
    const refs = new Map([['s1:room-1', studentRef()]])
    expect(aggregateAttendanceSummary([], refs)).toEqual([])
  })

  it('skips a record whose (student, classroom) has no matching ref, instead of crashing', () => {
    const refs = new Map<string, ReportStudentRef>()
    const records: RawAttendanceRecord[] = [{ studentId: 'ghost', classroomId: 'room-9', status: 'present' }]
    expect(aggregateAttendanceSummary(records, refs)).toEqual([])
  })
})

describe('buildMissingAssignmentRows — missing-work detection', () => {
  const roster = [
    { id: 's1', studentCode: 'S001', number: 1, firstName: 'สมชาย', lastName: 'ใจดี', nickname: null, email: null, phone: null, status: 'active' as const, createdAt: '', updatedAt: '', classroomStudentId: 'cs1', joinedAt: '' },
    { id: 's2', studentCode: 'S002', number: 2, firstName: 'สมหญิง', lastName: 'รักเรียน', nickname: null, email: null, phone: null, status: 'active' as const, createdAt: '', updatedAt: '', classroomStudentId: 'cs2', joinedAt: '' },
  ]
  const rosterByClassroom = new Map([['room-1', roster]])
  const subjectNameById = new Map([['subj-1', 'คณิตศาสตร์']])
  const classroomNameById = new Map([['room-1', 'ม.5/1']])

  function submission(overrides: Partial<AssignmentSubmission> = {}): AssignmentSubmission {
    return { studentId: 's1', status: 'not_submitted', score: null, note: null, ...overrides }
  }

  it('flags a student with no submission row as not_submitted', () => {
    const items = [assignment()]
    const rows = buildMissingAssignmentRows(items, {}, rosterByClassroom, subjectNameById, classroomNameById)
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.status === 'not_submitted')).toBe(true)
  })

  it('excludes a student whose status is submitted', () => {
    const items = [assignment()]
    const submissions = { a1: { s1: submission({ studentId: 's1', status: 'submitted' }) } }
    const rows = buildMissingAssignmentRows(items, submissions, rosterByClassroom, subjectNameById, classroomNameById)
    expect(rows.map((r) => r.studentId)).toEqual(['s2'])
  })

  it('includes late and missing statuses (not just not_submitted)', () => {
    const items = [assignment()]
    const submissions = {
      a1: {
        s1: submission({ studentId: 's1', status: 'late' }),
        s2: submission({ studentId: 's2', status: 'missing' }),
      },
    }
    const rows = buildMissingAssignmentRows(items, submissions, rosterByClassroom, subjectNameById, classroomNameById)
    expect(rows.map((r) => r.status).sort()).toEqual(['late', 'missing'])
  })

  it('resolves subject/classroom names via the provided maps', () => {
    const items = [assignment()]
    const rows = buildMissingAssignmentRows(items, {}, rosterByClassroom, subjectNameById, classroomNameById)
    expect(rows[0].subjectName).toBe('คณิตศาสตร์')
    expect(rows[0].classroomName).toBe('ม.5/1')
  })
})
