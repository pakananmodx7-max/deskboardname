import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  ASSIGNMENT_DETAIL_FILTERS,
  buildDefaultSubmissions,
  bulkFillWouldOverwrite,
  computeClassGradeStats,
  computeGradedTally,
  computeGradeRows,
  computeModeCellDisplay,
  computeModeItemCount,
  computeSubmissionCellState,
  deriveAssignmentRoster,
  deriveGradeRoster,
  filterRosterByStatus,
  filterStudentsByCheckMode,
  getSubmissionSummary,
  isMissingStatus,
  isSubmissionCellGradable,
  isSubmittedStatus,
  mergeSubmissionsWithDefaults,
  nextScoreFocusIndex,
  nextStatusAfterScore,
  parseBulkScoreInput,
  parsePastedScores,
  parseScoreInput,
  planScorePaste,
  searchAssignmentsByTitle,
  searchRoster,
  SUBMISSION_CELL_STATE_LABEL,
  SUBMISSION_CHECK_MODE_COUNT_LABEL,
  SUBMISSION_CHECK_MODES,
  validateMaxScoreChange,
} from '@/services/assignment-service'
import type { Assignment, AssignmentSubmission } from '@/types/assignment'

function rosterStudent(overrides: Partial<{ id: string; firstName: string; lastName: string; studentCode: string | null; number: number | null; status: 'active' | 'inactive' }> = {}) {
  return {
    id: 's1',
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    studentCode: 'S001',
    number: 1,
    status: 'active' as const,
    ...overrides,
  }
}

function emptySubmission(overrides: Partial<AssignmentSubmission> = {}): AssignmentSubmission {
  return { studentId: 's1', status: 'not_submitted', score: null, note: null, ...overrides }
}

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

describe('parseBulkScoreInput — same bound as parseScoreInput, but blank is REQUIRED (bulk grading always assigns a specific score)', () => {
  it('rejects a blank/whitespace-only entry — unlike the single-cell parseScoreInput, blank is not valid here', () => {
    expect(parseBulkScoreInput('', 10)).toEqual({ value: null, error: 'กรุณากรอกคะแนน' })
    expect(parseBulkScoreInput('   ', 10)).toEqual({ value: null, error: 'กรุณากรอกคะแนน' })
  })

  it('accepts 0 as a fully valid score, never confused with blank', () => {
    expect(parseBulkScoreInput('0', 10)).toEqual({ value: 0, error: null })
  })

  it('accepts any in-range score, delegating to parseScoreInput\'s own numeric/range check', () => {
    expect(parseBulkScoreInput('8', 10)).toEqual({ value: 8, error: null })
    expect(parseBulkScoreInput('10', 10)).toEqual({ value: 10, error: null })
  })

  it('rejects a negative score and a score above maxScore, same messages as parseScoreInput', () => {
    expect(parseBulkScoreInput('-1', 10)).toEqual(parseScoreInput('-1', 10))
    expect(parseBulkScoreInput('11', 10)).toEqual(parseScoreInput('11', 10))
  })

  it('rejects non-numeric input, same message as parseScoreInput', () => {
    expect(parseBulkScoreInput('abc', 10)).toEqual(parseScoreInput('abc', 10))
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

describe('validateMaxScoreChange — editable max score on the assignment detail page', () => {
  it('accepts a valid new max score when no existing submission exceeds it', () => {
    const submissions: Record<string, AssignmentSubmission> = {
      s1: submission('s1', 8),
      s2: submission('s2', 10),
    }
    expect(validateMaxScoreChange(20, submissions)).toEqual({ ok: true, error: null, violations: [] })
  })

  it('rejects a max score that is not > 0', () => {
    expect(validateMaxScoreChange(0, {}).ok).toBe(false)
    expect(validateMaxScoreChange(-5, {}).ok).toBe(false)
  })

  it('blocks lowering the max score below an existing score, naming the violating student(s)', () => {
    const submissions: Record<string, AssignmentSubmission> = {
      s1: submission('s1', 18),
      s2: submission('s2', 12),
    }
    // Lowering to 15 would leave s1's score of 18 out of range.
    const result = validateMaxScoreChange(15, submissions)
    expect(result.ok).toBe(false)
    expect(result.violations).toEqual([{ studentId: 's1', score: 18 }])
  })

  it('does not block on students with no score yet (null never violates)', () => {
    const submissions: Record<string, AssignmentSubmission> = {
      s1: { studentId: 's1', status: 'not_submitted', score: null, note: null },
    }
    expect(validateMaxScoreChange(5, submissions).ok).toBe(true)
  })

  it('a score exactly equal to the new max score is not a violation', () => {
    const submissions: Record<string, AssignmentSubmission> = { s1: submission('s1', 20) }
    expect(validateMaxScoreChange(20, submissions).ok).toBe(true)
  })
})

describe('parsePastedScores — clipboard parsing for multi-row score paste', () => {
  it('splits newline-separated values (LF)', () => {
    expect(parsePastedScores('18\n17\n20\n15\n19')).toEqual(['18', '17', '20', '15', '19'])
  })

  it('splits CRLF-separated values (Windows clipboard)', () => {
    expect(parsePastedScores('18\r\n17\r\n20')).toEqual(['18', '17', '20'])
  })

  it('splits bare-CR-separated values', () => {
    expect(parsePastedScores('18\r17\r20')).toEqual(['18', '17', '20'])
  })

  it('drops blank lines (e.g. a trailing newline from the copy)', () => {
    expect(parsePastedScores('18\n17\n\n')).toEqual(['18', '17'])
  })

  it('falls back to tab-separated when the clipboard is exactly one line with tabs (a single horizontal row)', () => {
    expect(parsePastedScores('18\t17\t20\t15\t19')).toEqual(['18', '17', '20', '15', '19'])
  })

  it('a multi-line paste where a line itself has tabs only takes each line’s first cell', () => {
    expect(parsePastedScores('18\tA\n17\tB')).toEqual(['18', '17'])
  })
})

describe('planScorePaste — multi-row paste starting at the focused row', () => {
  const rosterIds = ['s1', 's2', 's3', 's4', 's5']

  it('assigns pasted values to students in roster order starting at the focused row', () => {
    const plan = planScorePaste('18\n17\n20\n15\n19', 0, rosterIds, 20)
    expect(plan.map((p) => [p.studentId, p.value])).toEqual([
      ['s1', 18],
      ['s2', 17],
      ['s3', 20],
      ['s4', 15],
      ['s5', 19],
    ])
    expect(plan.every((p) => p.error === null)).toBe(true)
  })

  it('starting mid-roster offsets the target students accordingly', () => {
    const plan = planScorePaste('5\n6', 2, rosterIds, 20)
    expect(plan.map((p) => p.studentId)).toEqual(['s3', 's4'])
  })

  it('never pastes beyond the last student row — extra pasted rows are simply dropped', () => {
    // 5 pasted values starting at row index 3 (s4) — only s4 and s5 exist below it.
    const plan = planScorePaste('1\n2\n3\n4\n5', 3, rosterIds, 20)
    expect(plan.map((p) => p.studentId)).toEqual(['s4', 's5'])
    expect(plan).toHaveLength(2)
  })

  it('rejects a pasted score greater than max_score, on just that row', () => {
    const plan = planScorePaste('18\n25', 0, rosterIds, 20)
    expect(plan[0].error).toBeNull()
    expect(plan[1].error).toBeTruthy()
    expect(plan[1].value).toBeNull()
  })

  it('rejects a negative pasted score, on just that row', () => {
    const plan = planScorePaste('18\n-3', 0, rosterIds, 20)
    expect(plan[0].error).toBeNull()
    expect(plan[1].error).toBeTruthy()
  })

  it('a blank pasted row is valid (no error) and does not resolve to a score — callers can skip it', () => {
    const plan = planScorePaste('18\n\n20', 0, rosterIds, 20)
    expect(plan[1].error).toBeNull()
    expect(plan[1].value).toBeNull()
    expect(plan[1].raw).toBe('')
  })
})

describe('nextScoreFocusIndex — Enter-to-next-row and Arrow key navigation', () => {
  it('Enter moves focus to the next row', () => {
    expect(nextScoreFocusIndex('Enter', 0, 5)).toBe(1)
    expect(nextScoreFocusIndex('Enter', 3, 5)).toBe(4)
  })

  it('Enter on the last row stays put (save and keep focus there)', () => {
    expect(nextScoreFocusIndex('Enter', 4, 5)).toBe(4)
  })

  it('ArrowDown moves to the next row, clamped at the last row', () => {
    expect(nextScoreFocusIndex('ArrowDown', 1, 5)).toBe(2)
    expect(nextScoreFocusIndex('ArrowDown', 4, 5)).toBe(4)
  })

  it('ArrowUp moves to the previous row, clamped at the first row', () => {
    expect(nextScoreFocusIndex('ArrowUp', 2, 5)).toBe(1)
    expect(nextScoreFocusIndex('ArrowUp', 0, 5)).toBe(0)
  })

  it('an empty roster never moves focus anywhere', () => {
    expect(nextScoreFocusIndex('Enter', 0, 0)).toBe(0)
  })
})

describe('bulkFillWouldOverwrite — "ใส่คะแนนหลายคน" confirm-before-overwrite check', () => {
  it('is false when none of the selected students have a score yet', () => {
    const submissions: Record<string, AssignmentSubmission> = {
      s1: { studentId: 's1', status: 'not_submitted', score: null, note: null },
      s2: { studentId: 's2', status: 'not_submitted', score: null, note: null },
    }
    expect(bulkFillWouldOverwrite(['s1', 's2'], submissions)).toBe(false)
  })

  it('is true when at least one selected student already has a score', () => {
    const submissions: Record<string, AssignmentSubmission> = {
      s1: { studentId: 's1', status: 'not_submitted', score: null, note: null },
      s2: submission('s2', 9),
    }
    expect(bulkFillWouldOverwrite(['s1', 's2'], submissions)).toBe(true)
  })

  it('a score on a student who is NOT selected does not trigger the warning', () => {
    const submissions: Record<string, AssignmentSubmission> = { s3: submission('s3', 9) }
    expect(bulkFillWouldOverwrite(['s1', 's2'], submissions)).toBe(false)
  })

  it('applying "select 10 students, score = 10" example: bulk-fills exactly that value for every selected id', () => {
    const selected = Array.from({ length: 10 }, (_, i) => `s${i + 1}`)
    // No pre-existing scores for any of them — confirms the "no
    // confirmation needed" branch used in the worked example.
    expect(bulkFillWouldOverwrite(selected, {})).toBe(false)
  })
})

describe('mergeSubmissionsWithDefaults — score persistence after refresh', () => {
  it('a previously-saved score survives being merged back in over the not_submitted defaults', () => {
    const merged = mergeSubmissionsWithDefaults(['s1', 's2'], { s1: submission('s1', 18) })
    expect(merged.s1).toEqual(submission('s1', 18))
    // s2 has no saved row yet — falls back to the synthetic default.
    expect(merged.s2).toEqual({ studentId: 's2', status: 'not_submitted', score: null, note: null })
  })

  it('a fetched row always wins over the default, never the other way around', () => {
    const merged = mergeSubmissionsWithDefaults(['s1'], {
      s1: { studentId: 's1', status: 'late', score: 7, note: 'ส่งช้าหนึ่งวัน' },
    })
    expect(merged.s1).toEqual({ studentId: 's1', status: 'late', score: 7, note: 'ส่งช้าหนึ่งวัน' })
  })

  it('an empty fetch result (nothing saved yet) leaves every active student at the default', () => {
    const merged = mergeSubmissionsWithDefaults(['s1', 's2'], {})
    expect(merged).toEqual(buildDefaultSubmissions(['s1', 's2']))
  })
})

// ==================================================
// Assignment Detail Workspace — summary "ตรวจแล้ว/ยังไม่ตรวจ", filters,
// search (all pure, so the table's filter/search/summary behavior is
// unit-testable without a live Supabase round trip).
// ==================================================

describe('computeGradedTally — "ตรวจแล้ว / ยังไม่ตรวจ", always over the FULL roster', () => {
  it('counts a student with a non-null score as graded, regardless of status', () => {
    const submissions = { s1: emptySubmission({ studentId: 's1', score: 8, status: 'late' }) }
    expect(computeGradedTally(['s1'], submissions)).toEqual({ total: 1, graded: 1, notGraded: 0 })
  })

  it('counts a student with no score yet as not graded, even if marked submitted', () => {
    const submissions = { s1: emptySubmission({ studentId: 's1', score: null, status: 'submitted' }) }
    expect(computeGradedTally(['s1'], submissions)).toEqual({ total: 1, graded: 0, notGraded: 1 })
  })

  it('is unaffected by which students are passed elsewhere as "filtered" — it always reflects exactly the roster ids given', () => {
    const submissions = {
      s1: emptySubmission({ studentId: 's1', score: 10 }),
      s2: emptySubmission({ studentId: 's2', score: null }),
      s3: emptySubmission({ studentId: 's3', score: 5 }),
    }
    expect(computeGradedTally(['s1', 's2', 's3'], submissions)).toEqual({ total: 3, graded: 2, notGraded: 1 })
  })

  it('treats a roster id with no submission row at all as not graded (never throws)', () => {
    expect(computeGradedTally(['ghost'], {})).toEqual({ total: 1, graded: 0, notGraded: 1 })
  })
})

describe('filterRosterByStatus — assignment detail table filters', () => {
  const roster = [rosterStudent({ id: 's1' }), rosterStudent({ id: 's2' }), rosterStudent({ id: 's3' })]
  const submissions = {
    s1: emptySubmission({ studentId: 's1', status: 'submitted', score: 9 }),
    s2: emptySubmission({ studentId: 's2', status: 'not_submitted', score: null }),
    s3: emptySubmission({ studentId: 's3', status: 'late', score: null }),
  }

  it('"all" returns every roster member unchanged', () => {
    expect(filterRosterByStatus(roster, submissions, 'all').map((s) => s.id)).toEqual(['s1', 's2', 's3'])
  })

  it('filters to exactly one status', () => {
    expect(filterRosterByStatus(roster, submissions, 'submitted').map((s) => s.id)).toEqual(['s1'])
    expect(filterRosterByStatus(roster, submissions, 'not_submitted').map((s) => s.id)).toEqual(['s2'])
    expect(filterRosterByStatus(roster, submissions, 'late').map((s) => s.id)).toEqual(['s3'])
  })

  it('"ungraded" matches by score being null, independent of status', () => {
    expect(filterRosterByStatus(roster, submissions, 'ungraded').map((s) => s.id).sort()).toEqual(['s2', 's3'])
  })

  it('a roster member with no submission row defaults to not_submitted for filtering purposes', () => {
    const rosterWithGhost = [...roster, rosterStudent({ id: 's4' })]
    expect(filterRosterByStatus(rosterWithGhost, submissions, 'not_submitted').map((s) => s.id)).toEqual(['s2', 's4'])
  })

  it('every filter option in ASSIGNMENT_DETAIL_FILTERS is a real, handled key', () => {
    for (const { key } of ASSIGNMENT_DETAIL_FILTERS) {
      expect(() => filterRosterByStatus(roster, submissions, key)).not.toThrow()
    }
  })
})

describe('searchRoster — assignment detail student search', () => {
  const roster = [
    rosterStudent({ id: 's1', firstName: 'สมชาย', lastName: 'ใจดี', studentCode: 'S001', number: 1 }),
    rosterStudent({ id: 's2', firstName: 'สมหญิง', lastName: 'รักเรียน', studentCode: 'S002', number: 2 }),
  ]

  it('matches by first or last name (case-insensitive)', () => {
    expect(searchRoster(roster, 'สมหญิง').map((s) => s.id)).toEqual(['s2'])
    expect(searchRoster(roster, 'ใจดี').map((s) => s.id)).toEqual(['s1'])
  })

  it('matches by student code', () => {
    expect(searchRoster(roster, 'S002').map((s) => s.id)).toEqual(['s2'])
  })

  it('matches by roll number', () => {
    expect(searchRoster(roster, '1').map((s) => s.id)).toEqual(['s1'])
  })

  it('an empty/whitespace query returns the roster unchanged', () => {
    expect(searchRoster(roster, '   ')).toEqual(roster)
  })

  it('a query matching nobody returns an empty array', () => {
    expect(searchRoster(roster, 'ไม่มีตัวตน')).toEqual([])
  })
})

// ==================================================
// "คัดลอกไปห้องอื่น" — source-text guards, same pattern as the rest of
// this codebase's authorization/wiring assertions (e.g.
// google-drive-service.test.ts), since every function below is a thin
// network-calling wrapper with no meaningful pure logic to unit-test in
// isolation — its correctness is the exact shape of the Supabase calls it
// makes, which is what these assertions pin down.
// ==================================================

describe('getAssignmentCopyTargets — excludes only the exact current (subject, classroom) pair', () => {
  const source = readFileSync(new URL('./assignment-service.ts', import.meta.url), 'utf-8')
  const fnBody = source.slice(
    source.indexOf('export async function getAssignmentCopyTargets'),
    source.indexOf('\n}\n', source.indexOf('export async function getAssignmentCopyTargets')),
  )

  it('lists every (subject, classroom) pair via getSubjects + getSubjectClassrooms — not scoped to one subject', () => {
    expect(fnBody).toContain('getSubjects()')
    expect(fnBody).toContain('getSubjectClassrooms(subject.id)')
  })

  it('skips a link ONLY when BOTH subjectId and classroomId match the excluded pair — not either alone', () => {
    expect(fnBody).toContain('if (subject.id === excludeSubjectId && link.classroomId === excludeClassroomId) continue')
  })
})

describe('copyAssignmentToClassrooms — new independent assignment per target, never carries over submissions/scores/topic', () => {
  const source = readFileSync(new URL('./assignment-service.ts', import.meta.url), 'utf-8')
  const fnBody = source.slice(
    source.indexOf('export async function copyAssignmentToClassrooms'),
    source.indexOf('\n}\n', source.indexOf('export async function copyAssignmentToClassrooms')),
  )

  it('creates a brand-new assignment via createAssignment (a fresh DB-generated id) — never reuses source.id', () => {
    expect(fnBody).toContain('const created = await createAssignment({')
    expect(fnBody).not.toMatch(/id:\s*source\.id/)
  })

  it('copies only title/description/maxScore/dueDate — never topicId, never isArchived, never createdBy', () => {
    const createCall = fnBody.slice(fnBody.indexOf('createAssignment({'), fnBody.indexOf('})', fnBody.indexOf('createAssignment({')))
    expect(createCall).toContain('title: source.title')
    expect(createCall).toContain('description: source.description')
    expect(createCall).toContain('maxScore: source.maxScore')
    expect(createCall).toContain('dueDate: source.dueDate')
    expect(createCall).not.toContain('topicId')
    expect(createCall).not.toContain('isArchived')
  })

  it('never references assignment_submissions, score, status, submittedAt, or reviewedAt anywhere in this function', () => {
    expect(fnBody).not.toMatch(/assignment_submissions|\bscore\b|submittedAt|reviewedAt/)
  })

  it('copies each resource onto the NEW assignment via copyResourceToAssignment, scoped to the target subject/classroom', () => {
    expect(fnBody).toContain('copyResourceToAssignment(resource, created.id, target.subjectId, target.classroomId)')
  })

  it('one target failing is caught independently and never aborts/rolls back the others (Promise.all of per-target try/catch)', () => {
    expect(fnBody).toContain('Promise.all(')
    expect(fnBody).toContain('try {')
    expect(fnBody).toContain('} catch (err) {')
    expect(fnBody).toContain('return { target, ok: false')
  })
})

describe('hasAssignmentSubmissions — used only to pick confirmation copy, never to block deletion', () => {
  const source = readFileSync(new URL('./assignment-service.ts', import.meta.url), 'utf-8')
  const fnBody = source.slice(
    source.indexOf('export async function hasAssignmentSubmissions'),
    source.indexOf('\n}\n', source.indexOf('export async function hasAssignmentSubmissions')),
  )

  it('counts assignment_submissions rows for this assignment, never fetches full rows just to check existence', () => {
    expect(fnBody).toContain("from('assignment_submissions')")
    expect(fnBody).toContain("{ count: 'exact', head: true }")
    expect(fnBody).toContain("eq('assignment_id', assignmentId)")
  })
})

describe('deleteAssignmentPermanently — deletes regardless of submissions; Storage cleanup happens BEFORE the row delete, never after', () => {
  const source = readFileSync(new URL('./assignment-service.ts', import.meta.url), 'utf-8')
  const fnBody = source.slice(
    source.indexOf('export async function deleteAssignmentPermanently'),
    source.indexOf('\n}\n', source.indexOf('export async function deleteAssignmentPermanently')),
  )

  it('never checks hasAssignmentSubmissions or otherwise conditions the delete on whether submissions exist', () => {
    expect(fnBody).not.toContain('hasAssignmentSubmissions')
    expect(fnBody).not.toMatch(/if\s*\(.*[Ss]ubmission/)
  })

  it('reads back the deleted row via .select(\'id\') to tell "genuinely deleted" apart from "RLS silently denied it" (authorization only)', () => {
    expect(fnBody).toContain(".delete().eq('id', assignmentId).select('id')")
    expect(fnBody).toContain('data.length === 0')
  })

  it('the only failure path is an authorization error — never a "recommend archive instead" message', () => {
    expect(fnBody).not.toMatch(/เก็บถาวร/)
    expect(fnBody).toMatch(/throw new Error\(.*ไม่สามารถลบงานนี้ได้.*\)/)
  })

  it('fetches assignment_resources AND every submission-file Storage path BEFORE deleting the row (once cascaded away, neither can be listed anymore)', () => {
    const resourcesFetchIndex = fnBody.indexOf('getAssignmentResources(assignmentId)')
    const submissionPathsFetchIndex = fnBody.indexOf('getSubmissionResourceStoragePathsForAssignment(assignmentId)')
    const deleteIndex = fnBody.indexOf(".delete().eq('id', assignmentId)")
    expect(resourcesFetchIndex).toBeGreaterThan(-1)
    expect(submissionPathsFetchIndex).toBeGreaterThan(-1)
    expect(resourcesFetchIndex).toBeLessThan(deleteIndex)
    expect(submissionPathsFetchIndex).toBeLessThan(deleteIndex)
  })

  it('removes BOTH assignment-files and submission-files Storage objects BEFORE the row delete, never after (the delete-success check comes last)', () => {
    const assignmentFilesCleanupIndex = fnBody.indexOf('removeResourceStorageObjects(resources)')
    const submissionFilesCleanupIndex = fnBody.indexOf('removeSubmissionResourceStorageObjects(submissionStoragePaths)')
    const deleteCallIndex = fnBody.indexOf(".delete().eq('id', assignmentId)")
    const successCheckIndex = fnBody.indexOf('data.length === 0')
    expect(assignmentFilesCleanupIndex).toBeGreaterThan(-1)
    expect(submissionFilesCleanupIndex).toBeGreaterThan(-1)
    expect(assignmentFilesCleanupIndex).toBeLessThan(deleteCallIndex)
    expect(submissionFilesCleanupIndex).toBeLessThan(deleteCallIndex)
    expect(assignmentFilesCleanupIndex).toBeLessThan(successCheckIndex)
    expect(submissionFilesCleanupIndex).toBeLessThan(successCheckIndex)
  })

  it('every fetch/cleanup call is scoped by assignmentId only — never touches another assignment\'s data', () => {
    expect(fnBody).toContain('getAssignmentResources(assignmentId)')
    expect(fnBody).toContain('getSubmissionResourceStoragePathsForAssignment(assignmentId)')
    expect(fnBody).not.toMatch(/getAssignmentResources\((?!assignmentId\))/)
  })
})

// ==================================================
// ตรวจสอบงาน (Submission Check) tab — separating "was this turned in?"
// from "what score did it get?"
// ==================================================

describe('computeSubmissionCellState — the ตรวจงานและคะแนน matrix cell state: green ✓ = ส่งแล้ว (submitted), no "ตรวจแล้ว"/"awaiting review" in between', () => {
  it('not submitted, no score -> not_submitted (neutral "—", no recorded submission state)', () => {
    expect(computeSubmissionCellState('not_submitted', null)).toBe('not_submitted')
  })

  it('submitted, no score -> submitted (green ✓ = ส่งแล้ว) — NEVER treated as score 0, and NEVER a separate "awaiting review"/"ตรวจแล้ว" state', () => {
    expect(computeSubmissionCellState('submitted', null)).toBe('submitted')
  })

  it('late, no score -> the SAME "submitted" state as on-time — lateness is still recorded in the underlying status, but the matrix does not treat it as some lesser, still-pending state; both simply mean ส่งแล้ว', () => {
    expect(computeSubmissionCellState('late', null)).toBe('submitted')
    expect(computeSubmissionCellState('late', null)).toBe(computeSubmissionCellState('submitted', null))
  })

  it('missing, no score -> missing (ขาดส่ง)', () => {
    expect(computeSubmissionCellState('missing', null)).toBe('missing')
  })

  it('ANY status with an explicit score (including exactly 0) -> graded — a real score always wins, even 0', () => {
    expect(computeSubmissionCellState('submitted', 0)).toBe('graded')
    expect(computeSubmissionCellState('late', 0)).toBe('graded')
    expect(computeSubmissionCellState('missing', 0)).toBe('graded')
    expect(computeSubmissionCellState('not_submitted', 0)).toBe('graded')
  })

  it('a positive score also grades regardless of status', () => {
    expect(computeSubmissionCellState('submitted', 8)).toBe('graded')
    expect(computeSubmissionCellState('late', 10)).toBe('graded')
  })

  it('distinguishes score=0 (graded) from score=null (submitted, no score) — the whole point of this feature: no score is never treated as zero', () => {
    const gradedZero = computeSubmissionCellState('submitted', 0)
    const submittedNoScore = computeSubmissionCellState('submitted', null)
    expect(gradedZero).not.toBe(submittedNoScore)
    expect(gradedZero).toBe('graded')
    expect(submittedNoScore).toBe('submitted')
  })

  it('a score can be added later to an already-submitted (green ✓, no score) submission — the SAME status stays, only score moves from null to a real number', () => {
    const status: AssignmentSubmission['status'] = 'submitted'
    const beforeGrading = computeSubmissionCellState(status, null)
    const afterGrading = computeSubmissionCellState(status, 8)
    expect(beforeGrading).toBe('submitted')
    expect(afterGrading).toBe('graded')
    // nextStatusAfterScore never demotes/changes an already-'submitted'
    // status just because a score was entered — submission status and
    // score stay two independent, optional facts about the same row.
    expect(nextStatusAfterScore(status, 8)).toBe('submitted')
  })

  it('missing status renders correctly and is never confused with a submitted cell, with or without a score', () => {
    expect(computeSubmissionCellState('missing', null)).toBe('missing')
    // An explicit score entered on a missing submission still grades it
    // (score always wins) — this is unchanged existing behavior, not a
    // new state.
    expect(computeSubmissionCellState('missing', 0)).toBe('graded')
  })
})

describe('isSubmissionCellGradable — which cells open the score dialog on click', () => {
  it('submitted and graded are clickable ("a submitted ✓ cell")', () => {
    expect(isSubmissionCellGradable('submitted')).toBe(true)
    expect(isSubmissionCellGradable('graded')).toBe(true)
  })

  it('not_submitted and missing are NOT clickable — marking as submitted stays the งาน tab\'s / Hermes\' job', () => {
    expect(isSubmissionCellGradable('not_submitted')).toBe(false)
    expect(isSubmissionCellGradable('missing')).toBe(false)
  })
})

describe('No reviewed/checked/awaiting-review database state exists — the green ✓ IS the existing submission status, meaning ส่งแล้ว, nothing more', () => {
  it('SubmissionCellState is exactly 4 values — no "awaiting_review"/"ungraded"/"checked" state', () => {
    expect(Object.keys(SUBMISSION_CELL_STATE_LABEL).sort()).toEqual(['graded', 'missing', 'not_submitted', 'submitted'].sort())
  })

  it('a submitted (no score) cell is labeled "ส่งแล้ว" — never "ตรวจแล้ว" or "รอตรวจ"', () => {
    expect(SUBMISSION_CELL_STATE_LABEL.submitted).toBe('ส่งแล้ว')
    expect(Object.values(SUBMISSION_CELL_STATE_LABEL)).not.toContain('รอตรวจ')
    expect(Object.values(SUBMISSION_CELL_STATE_LABEL)).not.toContain('ตรวจแล้ว')
  })

  it('computeSubmissionCellState takes exactly 2 parameters (status, score) — no reviewedAt/checked 3rd argument exists to accidentally pass', () => {
    expect(computeSubmissionCellState.length).toBe(2)
  })

  it('a submitted cell with no score is "submitted" regardless of a 3rd argument nobody can pass — computeSubmissionCellState ignores anything beyond (status, score)', () => {
    // @ts-expect-error — intentionally calling with an extra argument to
    // prove the function's behavior can't be changed by one; a 3rd
    // argument like a reviewedAt/checked flag was removed and must stay
    // removed.
    expect(computeSubmissionCellState('submitted', null, 'anything')).toBe('submitted')
  })
})

describe('SUBMISSION_CHECK_MODES — exactly 3 modes, no "รอตรวจ"/awaiting-review/reviewed/checked mode', () => {
  it('has exactly submitted, missing, score — in that order', () => {
    expect(SUBMISSION_CHECK_MODES.map((m) => m.key)).toEqual(['submitted', 'missing', 'score'])
    expect(SUBMISSION_CHECK_MODES.map((m) => m.label)).toEqual(['ส่งแล้ว', 'ขาดส่ง', 'ให้คะแนน'])
  })

  it('never mentions รอตรวจ/reviewed/checked/awaiting-review anywhere in its labels', () => {
    for (const mode of SUBMISSION_CHECK_MODES) {
      expect(mode.label).not.toContain('รอตรวจ')
      expect(mode.label).not.toContain('ตรวจแล้ว')
    }
  })

  it('SUBMISSION_CHECK_MODE_COUNT_LABEL has one counter label per mode, worded past-tense for score ("ให้คะแนนแล้ว") distinct from the mode toggle label ("ให้คะแนน")', () => {
    expect(SUBMISSION_CHECK_MODE_COUNT_LABEL).toEqual({ submitted: 'ส่งแล้ว', missing: 'ขาดส่ง', score: 'ให้คะแนนแล้ว' })
  })
})

describe('isSubmittedStatus / isMissingStatus — the 2 independent predicates every mode is built from', () => {
  it('submitted and late both count as submitted; not_submitted and missing do not', () => {
    expect(isSubmittedStatus('submitted')).toBe(true)
    expect(isSubmittedStatus('late')).toBe(true)
    expect(isSubmittedStatus('not_submitted')).toBe(false)
    expect(isSubmittedStatus('missing')).toBe(false)
  })

  it('only the explicit missing status counts as missing — not_submitted (the silent default) never does', () => {
    expect(isMissingStatus('missing')).toBe(true)
    expect(isMissingStatus('not_submitted')).toBe(false)
    expect(isMissingStatus('submitted')).toBe(false)
    expect(isMissingStatus('late')).toBe(false)
  })
})

describe('computeModeCellDisplay — THE bug fix: a cell that does not match the active mode renders blank, never a status borrowed from another mode', () => {
  it('REGRESSION — Student A: Assignment 1 submitted, Assignment 2 missing (the exact bug reported in the old row-filter UI)', () => {
    // Old bug: filtering rows to "ส่งแล้ว" kept Student A as a row (because
    // assignment 1 matched) but then rendered assignment 2's cell with
    // its REAL state anyway, showing a red "ขาดส่ง" tag inside "ส่งแล้ว"
    // mode. The fix: cell display is now a pure function of (mode,
    // status, score) alone — a non-matching cell is ALWAYS blank.
    const a1 = submission('a1', null, 'submitted')
    const a2 = submission('a2', null, 'missing')

    // mode = ส่งแล้ว: assignment 1 shows submitted, assignment 2 is blank — NEVER ขาดส่ง
    expect(computeModeCellDisplay('submitted', a1.status, a1.score)).toEqual({ kind: 'submitted' })
    expect(computeModeCellDisplay('submitted', a2.status, a2.score)).toEqual({ kind: 'blank' })

    // mode = ขาดส่ง: assignment 1 is blank — NEVER ✓ — assignment 2 shows missing
    expect(computeModeCellDisplay('missing', a1.status, a1.score)).toEqual({ kind: 'blank' })
    expect(computeModeCellDisplay('missing', a2.status, a2.score)).toEqual({ kind: 'missing' })

    // mode = ให้คะแนน: neither cell renders ✓ or ขาดส่ง — only score info (both — here, no score entered)
    expect(computeModeCellDisplay('score', a1.status, a1.score)).toEqual({ kind: 'score', score: null })
    expect(computeModeCellDisplay('score', a2.status, a2.score)).toEqual({ kind: 'score', score: null })
  })

  it('score mode never looks at status — a missing or not_submitted assignment with a score still shows that score', () => {
    expect(computeModeCellDisplay('score', 'missing', 5)).toEqual({ kind: 'score', score: 5 })
    expect(computeModeCellDisplay('score', 'not_submitted', 0)).toEqual({ kind: 'score', score: 0 })
  })

  it('submitted/missing mode never look at score — a graded submission still shows as submitted under ส่งแล้ว mode, not as a score', () => {
    expect(computeModeCellDisplay('submitted', 'submitted', 10)).toEqual({ kind: 'submitted' })
    expect(computeModeCellDisplay('submitted', 'late', 0)).toEqual({ kind: 'submitted' })
  })

  it('not_submitted (no recorded state) renders blank in BOTH ส่งแล้ว and ขาดส่ง mode — it is neither', () => {
    expect(computeModeCellDisplay('submitted', 'not_submitted', null)).toEqual({ kind: 'blank' })
    expect(computeModeCellDisplay('missing', 'not_submitted', null)).toEqual({ kind: 'blank' })
  })

  it('explicit score 0 is never confused with blank in score mode', () => {
    expect(computeModeCellDisplay('score', 'submitted', 0)).toEqual({ kind: 'score', score: 0 })
    expect(computeModeCellDisplay('score', 'submitted', null)).toEqual({ kind: 'score', score: null })
  })
})

describe('filterStudentsByCheckMode — row visibility per mode', () => {
  const students = [rosterStudent({ id: 's1' }), rosterStudent({ id: 's2' }), rosterStudent({ id: 's3' })]
  const submissionsByAssignment = {
    a1: { s1: submission('s1', null, 'submitted') }, // s1 submitted a1
    a2: { s1: submission('s1', null, 'missing'), s2: submission('s2', null, 'missing') }, // s1 AND s2 missing a2
    // s3 has no row anywhere -> not_submitted everywhere
  }

  it('REGRESSION — the same Student A (submitted a1, missing a2) appears under BOTH ส่งแล้ว and ขาดส่ง mode — each mode looks only at its own concept, independently', () => {
    expect(filterStudentsByCheckMode(students, ['a1', 'a2'], submissionsByAssignment, 'submitted').map((s) => s.id)).toContain('s1')
    expect(filterStudentsByCheckMode(students, ['a1', 'a2'], submissionsByAssignment, 'missing').map((s) => s.id)).toContain('s1')
  })

  it('ส่งแล้ว mode keeps only students with at least one submitted cell in scope', () => {
    const result = filterStudentsByCheckMode(students, ['a1', 'a2'], submissionsByAssignment, 'submitted')
    expect(result.map((s) => s.id)).toEqual(['s1'])
  })

  it('ขาดส่ง mode keeps only students with at least one explicit missing cell in scope', () => {
    const result = filterStudentsByCheckMode(students, ['a1', 'a2'], submissionsByAssignment, 'missing')
    expect(result.map((s) => s.id).sort()).toEqual(['s1', 's2'])
  })

  it('a student with nothing but not_submitted cells never appears under ส่งแล้ว or ขาดส่ง mode', () => {
    expect(filterStudentsByCheckMode(students, ['a1', 'a2'], submissionsByAssignment, 'submitted').map((s) => s.id)).not.toContain('s3')
    expect(filterStudentsByCheckMode(students, ['a1', 'a2'], submissionsByAssignment, 'missing').map((s) => s.id)).not.toContain('s3')
  })

  it('ให้คะแนน mode never filters — the full roster is always shown, including students with no score yet', () => {
    const result = filterStudentsByCheckMode(students, ['a1', 'a2'], submissionsByAssignment, 'score')
    expect(result.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
  })

  it('the returned array is a fresh copy in score mode, never the same reference as the input', () => {
    const result = filterStudentsByCheckMode(students, ['a1'], submissionsByAssignment, 'score')
    expect(result).not.toBe(students)
    expect(result).toEqual(students)
  })
})

describe('computeModeItemCount — the top counter, always an ITEM count (assignment submissions / scored items), never a student headcount', () => {
  const submissionsByAssignment = {
    a1: {
      s1: submission('s1', null, 'submitted'),
      s2: submission('s2', 8, 'submitted'), // submitted AND scored
      s3: submission('s3', null, 'missing'),
    },
    a2: {
      s1: submission('s1', 15, 'late'), // submitted AND scored
      s2: submission('s2', null, 'missing'),
      // s3 has no row -> not_submitted
    },
  }

  it('ส่งแล้ว mode counts every submitted/late CELL, scored or not — matches the "ส่งแล้ว 198 รายการ" example shape (item-level, not student-level)', () => {
    expect(computeModeItemCount(['s1', 's2', 's3'], ['a1', 'a2'], submissionsByAssignment, 'submitted')).toBe(3) // a1/s1, a1/s2, a2/s1
  })

  it('ขาดส่ง mode counts every explicit missing CELL', () => {
    expect(computeModeItemCount(['s1', 's2', 's3'], ['a1', 'a2'], submissionsByAssignment, 'missing')).toBe(2) // a1/s3, a2/s2
  })

  it('ให้คะแนน mode counts every cell with a non-null score, regardless of status', () => {
    expect(computeModeItemCount(['s1', 's2', 's3'], ['a1', 'a2'], submissionsByAssignment, 'score')).toBe(2) // a1/s2, a2/s1
  })

  it('never double counts a student — 2 assignments both submitted by the same student count as 2 items, not 1', () => {
    const both = { a1: { s1: submission('s1', null, 'submitted') }, a2: { s1: submission('s1', null, 'submitted') } }
    expect(computeModeItemCount(['s1'], ['a1', 'a2'], both, 'submitted')).toBe(2)
  })

  it('empty roster/assignment scope counts to zero for every mode', () => {
    expect(computeModeItemCount([], [], {}, 'submitted')).toBe(0)
    expect(computeModeItemCount([], [], {}, 'missing')).toBe(0)
    expect(computeModeItemCount([], [], {}, 'score')).toBe(0)
  })

  it('a missing row (no submission at all) never counts toward any mode', () => {
    const noRow = { a1: {} }
    expect(computeModeItemCount(['s1'], ['a1'], noRow, 'submitted')).toBe(0)
    expect(computeModeItemCount(['s1'], ['a1'], noRow, 'missing')).toBe(0)
    expect(computeModeItemCount(['s1'], ['a1'], noRow, 'score')).toBe(0)
  })
})

describe('searchAssignmentsByTitle — the optional assignment search box', () => {
  const assignments = [assignment('a1', 10, 'ใบงาน 1'), assignment('a2', 20, 'Quiz กลางภาค'), assignment('a3', 30, 'Final Project')]

  it('an empty/whitespace query returns every assignment, in the same order', () => {
    expect(searchAssignmentsByTitle(assignments, '').map((a) => a.id)).toEqual(['a1', 'a2', 'a3'])
    expect(searchAssignmentsByTitle(assignments, '   ').map((a) => a.id)).toEqual(['a1', 'a2', 'a3'])
  })

  it('matches case-insensitively on a substring of the title', () => {
    expect(searchAssignmentsByTitle(assignments, 'quiz').map((a) => a.id)).toEqual(['a2'])
    expect(searchAssignmentsByTitle(assignments, 'final').map((a) => a.id)).toEqual(['a3'])
  })

  it('matches Thai titles too', () => {
    expect(searchAssignmentsByTitle(assignments, 'ใบงาน').map((a) => a.id)).toEqual(['a1'])
  })

  it('no match returns an empty array', () => {
    expect(searchAssignmentsByTitle(assignments, 'nope')).toEqual([])
  })
})

describe('Hermes-written submission states render correctly in ตรวจงานและคะแนน — mark_submission_status/mark_submission_status_bulk write the SAME status/score columns this reads, and the resulting green ✓ means ส่งแล้ว, not "ตรวจแล้ว"/"awaiting review"', () => {
  it('a submission Hermes marked "submitted" (no score) renders as "submitted" — a green ✓ meaning ส่งแล้ว, exactly like a teacher-marked one — no separate "checked by Hermes" state exists', () => {
    // mark_submission_status_bulk's own upsert never sets `score` — see
    // supabase/functions/teacher-agent-tools/tools/write-tools.ts's
    // markSubmissionStatus, which only ever writes { status }. A row
    // written that way is indistinguishable, on read, from one the
    // teacher marked by hand — there is no separate flag to fall out of
    // sync.
    const hermesWritten = submission('s1', null, 'submitted')
    expect(computeSubmissionCellState(hermesWritten.status, hermesWritten.score)).toBe('submitted')
    expect(SUBMISSION_CELL_STATE_LABEL[computeSubmissionCellState(hermesWritten.status, hermesWritten.score)]).toBe('ส่งแล้ว')
    expect(isSubmissionCellGradable(computeSubmissionCellState(hermesWritten.status, hermesWritten.score))).toBe(true)
  })

  it('11 Hermes-marked-submitted assignments all count as "ส่งแล้ว" (submitted) in the ส่งแล้ว mode counter, none as scored, none in a separate "awaiting review" bucket', () => {
    const submissionsByAssignment: Record<string, Record<string, AssignmentSubmission>> = {}
    const assignmentIds = Array.from({ length: 11 }, (_, i) => `a${i}`)
    for (const id of assignmentIds) {
      submissionsByAssignment[id] = { s1: submission('s1', null, 'submitted') }
    }
    expect(computeModeItemCount(['s1'], assignmentIds, submissionsByAssignment, 'submitted')).toBe(11)
    expect(computeModeItemCount(['s1'], assignmentIds, submissionsByAssignment, 'score')).toBe(0)
    expect(computeModeItemCount(['s1'], assignmentIds, submissionsByAssignment, 'missing')).toBe(0)
  })

  it('a score Hermes writes via mark_submission_status_bulk (still just status, never score) never appears as graded until a teacher enters one here — the "late" submission still renders the SAME green ✓/ส่งแล้ว as "submitted", never a separate awaiting state', () => {
    // Hermes' write tools never write `score` (see write-tools.ts's
    // markSubmissionStatus upsert shape) — grading stays exclusively a
    // teacher action through this tab's setSubmissionScore call.
    expect(computeSubmissionCellState('late', null)).toBe('submitted')
    expect(computeSubmissionCellState('late', null)).not.toBe('graded')
  })
})
