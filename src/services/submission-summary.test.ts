import { describe, expect, it } from 'vitest'

import { computeClassroomSubmissionSummary } from '../../supabase/functions/teacher-agent-tools/tools/submission-summary'

const SUBMITTED_STATUSES = ['submitted', 'late'] as const

describe('computeClassroomSubmissionSummary — get_classroom_submission_summary\'s core aggregation', () => {
  const roster = [{ id: 's1', number: 1 }, { id: 's2', number: 2 }, { id: 's3', number: 3 }, { id: 's4', number: 4 }]

  it('a classroom with multiple assignments returns one compact entry per assignment', () => {
    const assignments = [
      { id: 'a1', title: 'งาน 1', isArchived: false },
      { id: 'a2', title: 'งาน 2', isArchived: false },
    ]
    const submissions = [
      { assignmentId: 'a1', studentId: 's1', status: 'submitted' },
      { assignmentId: 'a2', studentId: 's1', status: 'submitted' },
      { assignmentId: 'a2', studentId: 's2', status: 'late' },
    ]

    const result = computeClassroomSubmissionSummary(assignments, roster, submissions, SUBMITTED_STATUSES)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      assignmentId: 'a1',
      title: 'งาน 1',
      totalStudents: 4,
      submittedCount: 1,
      missingCount: 3,
      missingStudentNumbers: [2, 3, 4],
    })
    expect(result[1]).toEqual({
      assignmentId: 'a2',
      title: 'งาน 2',
      totalStudents: 4,
      submittedCount: 2,
      missingCount: 2,
      missingStudentNumbers: [3, 4],
    })
  })

  it('an assignment with no missing students reports missingCount 0 and an empty missingStudentNumbers array', () => {
    const assignments = [{ id: 'a1', title: 'ครบทุกคน', isArchived: false }]
    const submissions = roster.map((s) => ({ assignmentId: 'a1', studentId: s.id, status: 'submitted' }))

    const result = computeClassroomSubmissionSummary(assignments, roster, submissions, SUBMITTED_STATUSES)

    expect(result[0].submittedCount).toBe(4)
    expect(result[0].missingCount).toBe(0)
    expect(result[0].missingStudentNumbers).toEqual([])
  })

  it('an assignment with missing students lists exactly those students as missing (no submission row at all counts as missing)', () => {
    const assignments = [{ id: 'a1', title: 'บางคนค้าง', isArchived: false }]
    const submissions = [{ assignmentId: 'a1', studentId: 's1', status: 'submitted' }]

    const result = computeClassroomSubmissionSummary(assignments, roster, submissions, SUBMITTED_STATUSES)

    expect(result[0].submittedCount).toBe(1)
    expect(result[0].missingCount).toBe(3)
    expect(result[0].missingStudentNumbers).toEqual([2, 3, 4])
  })

  it('an explicit not_submitted/missing status row is treated the same as no row at all — still missing', () => {
    const assignments = [{ id: 'a1', title: 'สถานะไม่ส่ง', isArchived: false }]
    const submissions = [
      { assignmentId: 'a1', studentId: 's1', status: 'submitted' },
      { assignmentId: 'a1', studentId: 's2', status: 'not_submitted' },
      { assignmentId: 'a1', studentId: 's3', status: 'missing' },
    ]

    const result = computeClassroomSubmissionSummary(assignments, roster, submissions, SUBMITTED_STATUSES)

    expect(result[0].missingStudentNumbers).toEqual([2, 3, 4])
  })

  it('archived assignments are excluded entirely from the output', () => {
    const assignments = [
      { id: 'a1', title: 'active', isArchived: false },
      { id: 'a2', title: 'archived', isArchived: true },
    ]

    const result = computeClassroomSubmissionSummary(assignments, roster, [], SUBMITTED_STATUSES)

    expect(result).toHaveLength(1)
    expect(result[0].assignmentId).toBe('a1')
    expect(result.some((a) => a.assignmentId === 'a2')).toBe(false)
  })

  it('missingStudentNumbers is always sorted ascending, regardless of roster/submission order', () => {
    const shuffledRoster = [{ id: 's4', number: 40 }, { id: 's1', number: 5 }, { id: 's3', number: 12 }, { id: 's2', number: 1 }]
    const assignments = [{ id: 'a1', title: 'x', isArchived: false }]

    const result = computeClassroomSubmissionSummary(assignments, shuffledRoster, [], SUBMITTED_STATUSES)

    expect(result[0].missingStudentNumbers).toEqual([1, 5, 12, 40])
  })

  it('a student with a null class number is excluded from missingStudentNumbers (never null in the array)', () => {
    const rosterWithNull = [{ id: 's1', number: 1 }, { id: 's2', number: null }]
    const assignments = [{ id: 'a1', title: 'x', isArchived: false }]

    const result = computeClassroomSubmissionSummary(assignments, rosterWithNull, [], SUBMITTED_STATUSES)

    expect(result[0].missingCount).toBe(2)
    expect(result[0].missingStudentNumbers).toEqual([1])
    expect(result[0].missingStudentNumbers).not.toContain(null)
  })

  it('the result shape is exactly the compact 6-key contract — no studentId/uuid/status/timestamp fields leak through', () => {
    const assignments = [{ id: 'a1', title: 'x', isArchived: false }]
    const submissions = [{ assignmentId: 'a1', studentId: 's1', status: 'submitted' }]

    const result = computeClassroomSubmissionSummary(assignments, roster, submissions, SUBMITTED_STATUSES)

    expect(Object.keys(result[0]).sort()).toEqual(
      ['assignmentId', 'title', 'totalStudents', 'submittedCount', 'missingCount', 'missingStudentNumbers'].sort(),
    )
  })

  it('never mutates its input arrays (assignments/roster/submissions all stay unchanged after the call)', () => {
    const assignments = [
      { id: 'a2', title: 'b', isArchived: false },
      { id: 'a1', title: 'a', isArchived: false },
    ]
    const shuffledRoster = [{ id: 's2', number: 2 }, { id: 's1', number: 1 }]
    const submissions = [{ assignmentId: 'a1', studentId: 's1', status: 'submitted' }]
    const assignmentsCopy = structuredClone(assignments)
    const rosterCopy = structuredClone(shuffledRoster)
    const submissionsCopy = structuredClone(submissions)

    computeClassroomSubmissionSummary(assignments, shuffledRoster, submissions, SUBMITTED_STATUSES)

    expect(assignments).toEqual(assignmentsCopy)
    expect(shuffledRoster).toEqual(rosterCopy)
    expect(submissions).toEqual(submissionsCopy)
  })

  it('an empty classroom (no active assignments) returns an empty array', () => {
    expect(computeClassroomSubmissionSummary([], roster, [], SUBMITTED_STATUSES)).toEqual([])
  })
})
