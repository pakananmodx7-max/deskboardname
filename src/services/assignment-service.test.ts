import { describe, expect, it } from 'vitest'

import {
  buildDefaultSubmissions,
  computeClassGradeStats,
  computeGradeRows,
  deriveAssignmentRoster,
  deriveGradeRoster,
  getSubmissionSummary,
  nextStatusAfterScore,
  parseScoreInput,
} from '@/services/assignment-service'
import type { Assignment, AssignmentSubmission } from '@/types/assignment'

describe('buildDefaultSubmissions', () => {
  it('defaults every given student id to not_submitted with no score/note', () => {
    const submissions = buildDefaultSubmissions(['s1', 's2'])
    expect(submissions).toEqual({
      s1: { studentId: 's1', status: 'not_submitted', score: null, note: null },
      s2: { studentId: 's2', status: 'not_submitted', score: null, note: null },
    })
  })

  it('returns an empty map for an empty roster (empty classroom)', () => {
    expect(buildDefaultSubmissions([])).toEqual({})
  })
})

describe('getSubmissionSummary', () => {
  it('tallies each status, the total, and the average of scored submissions', () => {
    const submissions: Record<string, AssignmentSubmission> = {
      s1: { studentId: 's1', status: 'submitted', score: 8, note: null },
      s2: { studentId: 's2', status: 'submitted', score: 10, note: null },
      s3: { studentId: 's3', status: 'late', score: 6, note: 'ส่งช้า' },
      s4: { studentId: 's4', status: 'not_submitted', score: null, note: null },
      s5: { studentId: 's5', status: 'missing', score: null, note: null },
    }
    expect(getSubmissionSummary(submissions)).toEqual({
      submitted: 2,
      notSubmitted: 1,
      late: 1,
      missing: 1,
      total: 5,
      average: 8,
    })
  })

  it('returns a null average when no submission has a score yet', () => {
    const submissions: Record<string, AssignmentSubmission> = {
      s1: { studentId: 's1', status: 'not_submitted', score: null, note: null },
    }
    expect(getSubmissionSummary(submissions).average).toBeNull()
  })

  it('returns all zeros and a null average for an empty roster', () => {
    expect(getSubmissionSummary({})).toEqual({
      submitted: 0,
      notSubmitted: 0,
      late: 0,
      missing: 0,
      total: 0,
      average: null,
    })
  })
})

describe('deriveAssignmentRoster', () => {
  const active = (id: string) => ({ id, status: 'active' as const })
  const inactive = (id: string) => ({ id, status: 'inactive' as const })

  it('includes every active student, with or without a submission', () => {
    const roster = deriveAssignmentRoster([active('s1'), active('s2')], {})
    expect(roster.map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('excludes an inactive (archived) student who has no saved submission for this assignment', () => {
    const roster = deriveAssignmentRoster([active('s1'), inactive('s2')], {})
    expect(roster.map((s) => s.id)).toEqual(['s1'])
  })

  it('keeps an inactive student who already has a saved submission — never silently drops history', () => {
    const submissions: Record<string, AssignmentSubmission> = {
      s2: { studentId: 's2', status: 'submitted', score: 9, note: null },
    }
    const roster = deriveAssignmentRoster([active('s1'), inactive('s2')], submissions)
    expect(roster.map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('returns an empty roster for an empty classroom', () => {
    expect(deriveAssignmentRoster([], {})).toEqual([])
  })
})

describe('parseScoreInput — score validation (0 <= score <= maxScore)', () => {
  it('accepts a blank/whitespace-only entry as "no score yet", not an error', () => {
    expect(parseScoreInput('', 100)).toEqual({ value: null, error: null })
    expect(parseScoreInput('   ', 100)).toEqual({ value: null, error: null })
  })

  it('accepts a valid in-range score', () => {
    expect(parseScoreInput('8', 10)).toEqual({ value: 8, error: null })
    expect(parseScoreInput('0', 10)).toEqual({ value: 0, error: null })
    expect(parseScoreInput('10', 10)).toEqual({ value: 10, error: null })
  })

  it('rejects a negative score', () => {
    const result = parseScoreInput('-1', 10)
    expect(result.value).toBeNull()
    expect(result.error).toBeTruthy()
  })

  it('rejects a score greater than max_score', () => {
    const result = parseScoreInput('11', 10)
    expect(result.value).toBeNull()
    expect(result.error).toBeTruthy()
  })

  it('rejects non-numeric input', () => {
    const result = parseScoreInput('abc', 10)
    expect(result.value).toBeNull()
    expect(result.error).toBeTruthy()
  })
})

describe('nextStatusAfterScore — submission-to-graded transition', () => {
  it('promotes not_submitted to submitted the moment a real score is entered', () => {
    expect(nextStatusAfterScore('not_submitted', 8)).toBe('submitted')
  })

  it('never overwrites an explicit late/missing/submitted status just because a score was entered', () => {
    expect(nextStatusAfterScore('late', 8)).toBe('late')
    expect(nextStatusAfterScore('missing', 8)).toBe('missing')
    expect(nextStatusAfterScore('submitted', 8)).toBe('submitted')
  })

  it('clearing a score back to blank never moves status backwards', () => {
    expect(nextStatusAfterScore('submitted', null)).toBe('submitted')
    expect(nextStatusAfterScore('not_submitted', null)).toBe('not_submitted')
  })
})

function assignment(id: string, maxScore: number, title = id): Assignment {
  return {
    id,
    subjectId: 'subject-1',
    classroomId: 'classroom-1',
    topicId: null,
    title,
    description: null,
    maxScore,
    dueDate: null,
    isArchived: false,
    createdBy: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

function submission(studentId: string, score: number | null, status: AssignmentSubmission['status'] = 'submitted'): AssignmentSubmission {
  return { studentId, status, score, note: null }
}

describe('computeGradeRows — the Grades tab matrix (student x assignment -> score, totals, percentage)', () => {
  const worksheet = assignment('a1', 10, 'ใบงาน 1')
  const quiz = assignment('a2', 20, 'Quiz 1')
  const project = assignment('a3', 30, 'Project')
  const assignments = [worksheet, quiz, project]

  it('sums only graded scores into total, but counts every assignment’s max_score into possible', () => {
    const submissionsByAssignment = {
      a1: { s1: submission('s1', 8) },
      a2: { s1: submission('s1', 15) },
      a3: { s1: submission('s1', 25) },
    }
    const [row] = computeGradeRows(['s1'], assignments, submissionsByAssignment)
    expect(row.total).toBe(48)
    expect(row.possible).toBe(60)
    expect(row.percentage).toBeCloseTo(80, 5)
  })

  it('an ungraded assignment counts toward possible but contributes 0 to total (matches the "36/60" example)', () => {
    const submissionsByAssignment = {
      a1: { s2: submission('s2', 9) },
      a2: {}, // Quiz 1 not graded for this student
      a3: { s2: submission('s2', 27) },
    }
    const [row] = computeGradeRows(['s2'], assignments, submissionsByAssignment)
    expect(row.total).toBe(36)
    expect(row.possible).toBe(60)
    expect(row.scoresByAssignment.a2).toBeNull()
  })

  it('a totally ungraded student still has the classroom’s full possible total (0%), not null', () => {
    const [row] = computeGradeRows(['s3'], assignments, {})
    expect(row.total).toBe(0)
    expect(row.possible).toBe(60)
    expect(row.percentage).toBe(0)
  })

  it('returns a null percentage when the classroom has no assignments at all (avoids divide-by-zero)', () => {
    const [row] = computeGradeRows(['s1'], [], {})
    expect(row.possible).toBe(0)
    expect(row.percentage).toBeNull()
  })

  it('never blends another assignment’s (or classroom’s) submissions into a student’s row', () => {
    // Only a1's submissions map has s1 — a2/a3 have nothing for s1, so
    // they must show up as ungraded (null), never accidentally pull in
    // a score meant for a different assignment or student.
    const submissionsByAssignment = { a1: { s1: submission('s1', 8) } }
    const [row] = computeGradeRows(['s1'], assignments, submissionsByAssignment)
    expect(row.scoresByAssignment).toEqual({ a1: 8, a2: null, a3: null })
  })

  it('classroom isolation: ignores submissionsByAssignment entries for an assignment id not in THIS classroom’s assignments list', () => {
    // Simulates another classroom's data (e.g. a foreign assignment id)
    // accidentally ending up in the submissions map — computeGradeRows
    // only ever iterates the `assignments` array it was given (which the
    // caller must have already scoped via getAssignments(subjectId,
    // classroomId)), so a stray key for a different classroom's
    // assignment can never leak into this classroom's total/possible.
    const foreignClassroomAssignmentId = 'foreign-classroom-assignment'
    const submissionsByAssignment = {
      a1: { s1: submission('s1', 8) },
      [foreignClassroomAssignmentId]: { s1: submission('s1', 999) },
    }
    const [row] = computeGradeRows(['s1'], [worksheet], submissionsByAssignment)
    expect(row.total).toBe(8)
    expect(row.possible).toBe(10)
    expect(Object.keys(row.scoresByAssignment)).toEqual(['a1'])
  })
})

describe('computeClassGradeStats — class average, highest, lowest', () => {
  it('computes the average/highest/lowest across student percentages', () => {
    const rows = computeGradeRows(
      ['s1', 's2'],
      [assignment('a1', 10)],
      { a1: { s1: submission('s1', 8), s2: submission('s2', 6) } },
    )
    const stats = computeClassGradeStats(rows)
    expect(stats.highest).toBeCloseTo(80, 5)
    expect(stats.lowest).toBeCloseTo(60, 5)
    expect(stats.classAverage).toBeCloseTo(70, 5)
  })

  it('returns all-null stats when there are no assignments (nothing to average)', () => {
    const rows = computeGradeRows(['s1'], [], {})
    expect(computeClassGradeStats(rows)).toEqual({ classAverage: null, highest: null, lowest: null })
  })
})

describe('deriveGradeRoster', () => {
  const active = (id: string) => ({ id, status: 'active' as const })
  const inactive = (id: string) => ({ id, status: 'inactive' as const })

  it('includes every active student regardless of assignment submissions', () => {
    const roster = deriveGradeRoster([active('s1'), active('s2')], {})
    expect(roster.map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('excludes an inactive student with no submission on any assignment', () => {
    const roster = deriveGradeRoster([active('s1'), inactive('s2')], { a1: {} })
    expect(roster.map((s) => s.id)).toEqual(['s1'])
  })

  it('keeps an inactive student who has a submission on at least one assignment — never drops history', () => {
    const submissionsByAssignment = { a1: {}, a2: { s2: submission('s2', 5) } }
    const roster = deriveGradeRoster([active('s1'), inactive('s2')], submissionsByAssignment)
    expect(roster.map((s) => s.id)).toEqual(['s1', 's2'])
  })
})
