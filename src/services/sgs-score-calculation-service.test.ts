import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  applyRounding,
  calculateClassPreview,
  calculateIndividualWeightedScore,
  calculateProportionalScore,
  calculateStudentSgsScore,
  calculateWeightedGroupScore,
  countExistingTargetScores,
  planSgsScoreCalculationApply,
  validateCalculationConfig,
} from './sgs-score-calculation-service'
import type { SgsScoreCalculationFormula, SgsScoreCalculationSource } from '@/types/sgs-score-calculation'

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf-8')
}

const SOURCES: SgsScoreCalculationSource[] = [
  { assignmentId: 'a1', label: 'ใบงานที่ 1', maxScore: 10 },
  { assignmentId: 'a2', label: 'ใบงานที่ 2', maxScore: 10 },
  { assignmentId: 'a3', label: 'Quiz', maxScore: 20 },
  { assignmentId: 'a4', label: 'สอบหน่วย', maxScore: 30 },
]

function proportionalFormula(overrides: Partial<Extract<SgsScoreCalculationFormula, { mode: 'proportional' }>> = {}): SgsScoreCalculationFormula {
  return {
    mode: 'proportional',
    targetColumnId: 'col-10',
    targetMaxScore: 10,
    missingScorePolicy: 'treat_as_zero',
    rounding: 'one_decimal',
    sourceAssignmentIds: ['a1', 'a2', 'a3', 'a4'],
    ...overrides,
  }
}

// ==================================================
// 1. PROPORTIONAL SCALING — the exact spec example (56/70 -> 8.0/10)
// ==================================================
describe('1. proportional scaling', () => {
  it('calculateProportionalScore matches the spec example exactly: 56/70 * 10 = 8.0', () => {
    expect(calculateProportionalScore(56, 70, 10)).toBe(8)
  })

  it('calculateStudentSgsScore (mode A) end to end: 4 sources totalling 56/70 -> calculatedScore 8', () => {
    // a1(max10)=10, a2(max10)=10, a3(max20)=16, a4(max30)=20 -> total 56, max 70.
    const result = calculateStudentSgsScore(
      proportionalFormula({ sourceAssignmentIds: ['a1', 'a2', 'a3', 'a4'] }),
      { a1: 10, a2: 10, a3: 16, a4: 20 },
      SOURCES,
    )
    expect(result).toEqual({ status: 'ok', usedTotal: 56, usedMax: 70, percent: 80, calculatedScore: 8 })
  })
})

// ==================================================
// 2. WEIGHTED GROUPS
// ==================================================
describe('2. weighted groups', () => {
  it('calculateWeightedGroupScore combines independently-normalized group fractions by weight', () => {
    // งาน/กิจกรรม 40% @ 0.7, แบบทดสอบ 20% @ 0.8, สอบ 40% @ 0.9 -> 0.8 * target
    const raw = calculateWeightedGroupScore(
      [
        { fraction: 0.7, weightPercent: 40 },
        { fraction: 0.8, weightPercent: 20 },
        { fraction: 0.9, weightPercent: 40 },
      ],
      10,
    )
    expect(raw).toBeCloseTo(8, 10)
  })

  it('calculateStudentSgsScore (mode B) end to end', () => {
    const formula: SgsScoreCalculationFormula = {
      mode: 'weighted_groups',
      targetColumnId: 'col-10',
      targetMaxScore: 10,
      missingScorePolicy: 'treat_as_zero',
      rounding: 'one_decimal',
      groups: [
        { id: 'g1', label: 'งาน/กิจกรรม', weightPercent: 40, sourceAssignmentIds: ['a1', 'a2'] },
        { id: 'g2', label: 'แบบทดสอบ', weightPercent: 20, sourceAssignmentIds: ['a3'] },
        { id: 'g3', label: 'สอบ', weightPercent: 40, sourceAssignmentIds: ['a4'] },
      ],
    }
    // g1: (8+6)/20 = 0.7, g2: 16/20 = 0.8, g3: 27/30 = 0.9
    const result = calculateStudentSgsScore(formula, { a1: 8, a2: 6, a3: 16, a4: 27 }, SOURCES)
    expect(result).toEqual({ status: 'ok', usedTotal: 8 + 6 + 16 + 27, usedMax: 70, percent: 80, calculatedScore: 8 })
  })

  it('a group with zero usable data (exclude policy, all its sources missing) blocks the WHOLE student — never silently drops that group', () => {
    const formula: SgsScoreCalculationFormula = {
      mode: 'weighted_groups',
      targetColumnId: 'col-10',
      targetMaxScore: 10,
      missingScorePolicy: 'exclude',
      rounding: 'one_decimal',
      groups: [
        { id: 'g1', label: 'งาน', weightPercent: 50, sourceAssignmentIds: ['a1'] },
        { id: 'g2', label: 'สอบ', weightPercent: 50, sourceAssignmentIds: ['a4'] },
      ],
    }
    const result = calculateStudentSgsScore(formula, { a1: null, a4: 27 }, SOURCES)
    expect(result.status).toBe('blocked')
    if (result.status === 'blocked') {
      expect(result.reason).toBe('missing_data')
      expect(result.message).toContain('งาน')
    }
  })
})

// ==================================================
// 3. INDIVIDUAL WEIGHTS
// ==================================================
describe('3. individual weights', () => {
  it('calculateIndividualWeightedScore: same math as weighted groups, one item per weight', () => {
    const raw = calculateIndividualWeightedScore(
      [
        { fraction: 0.8, weightPercent: 10 },
        { fraction: 0.9, weightPercent: 10 },
        { fraction: 0.75, weightPercent: 20 },
        { fraction: 0.8, weightPercent: 60 },
      ],
      10,
    )
    expect(raw).toBeCloseTo(8, 10)
  })

  it('calculateStudentSgsScore (mode C) end to end', () => {
    const formula: SgsScoreCalculationFormula = {
      mode: 'individual_weights',
      targetColumnId: 'col-10',
      targetMaxScore: 10,
      missingScorePolicy: 'treat_as_zero',
      rounding: 'one_decimal',
      weights: [
        { assignmentId: 'a1', weightPercent: 10 },
        { assignmentId: 'a2', weightPercent: 10 },
        { assignmentId: 'a3', weightPercent: 20 },
        { assignmentId: 'a4', weightPercent: 60 },
      ],
    }
    // a1 8/10=.8, a2 9/10=.9, a3(Quiz) 15/20=.75, a4(สอบ) 24/30=.8
    const result = calculateStudentSgsScore(formula, { a1: 8, a2: 9, a3: 15, a4: 24 }, SOURCES)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') expect(result.calculatedScore).toBe(8)
  })
})

// ==================================================
// 4. WEIGHTS MUST TOTAL 100%
// ==================================================
describe('4. weights must total 100%', () => {
  it('weighted_groups: 90% total is rejected', () => {
    const formula: SgsScoreCalculationFormula = {
      mode: 'weighted_groups',
      targetColumnId: 'col-10',
      targetMaxScore: 10,
      missingScorePolicy: 'treat_as_zero',
      rounding: 'one_decimal',
      groups: [
        { id: 'g1', label: 'A', weightPercent: 50, sourceAssignmentIds: ['a1'] },
        { id: 'g2', label: 'B', weightPercent: 40, sourceAssignmentIds: ['a2'] },
      ],
    }
    const validation = validateCalculationConfig(formula, ['a1', 'a2', 'a3', 'a4'])
    expect(validation.ok).toBe(false)
    expect(validation.reason).toContain('100%')
  })

  it('individual_weights: 110% total is rejected', () => {
    const formula: SgsScoreCalculationFormula = {
      mode: 'individual_weights',
      targetColumnId: 'col-10',
      targetMaxScore: 10,
      missingScorePolicy: 'treat_as_zero',
      rounding: 'one_decimal',
      weights: [
        { assignmentId: 'a1', weightPercent: 60 },
        { assignmentId: 'a2', weightPercent: 50 },
      ],
    }
    const validation = validateCalculationConfig(formula, ['a1', 'a2', 'a3', 'a4'])
    expect(validation.ok).toBe(false)
    expect(validation.reason).toContain('100%')
  })

  it('exactly 100% (weighted_groups) passes', () => {
    const formula: SgsScoreCalculationFormula = {
      mode: 'weighted_groups',
      targetColumnId: 'col-10',
      targetMaxScore: 10,
      missingScorePolicy: 'treat_as_zero',
      rounding: 'one_decimal',
      groups: [
        { id: 'g1', label: 'A', weightPercent: 60, sourceAssignmentIds: ['a1'] },
        { id: 'g2', label: 'B', weightPercent: 40, sourceAssignmentIds: ['a2'] },
      ],
    }
    expect(validateCalculationConfig(formula, ['a1', 'a2']).ok).toBe(true)
  })
})

// ==================================================
// 5. SCORE 0 REMAINS A REAL SCORE
// ==================================================
describe('5. score 0 remains a real score', () => {
  it('a student scoring 0 on a selected source is CALCULATED, never treated as missing', () => {
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1', 'a2'] })
    const result = calculateStudentSgsScore(formula, { a1: 0, a2: 5 }, SOURCES)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') {
      expect(result.usedTotal).toBe(5) // 0 + 5, not skipped
      expect(result.usedMax).toBe(20)
      expect(result.calculatedScore).toBe(2.5)
    }
  })

  it('0 is distinguished from null: null is missing (policy-dependent), 0 never is, even under the exclude policy', () => {
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1', 'a2'], missingScorePolicy: 'exclude' })
    const zeroResult = calculateStudentSgsScore(formula, { a1: 0, a2: 5 }, SOURCES)
    const nullResult = calculateStudentSgsScore(formula, { a1: null, a2: 5 }, SOURCES)
    expect(zeroResult.status).toBe('ok')
    if (zeroResult.status === 'ok') expect(zeroResult.usedMax).toBe(20) // a1's max IS counted — 0 is real
    expect(nullResult.status).toBe('ok')
    if (nullResult.status === 'ok') expect(nullResult.usedMax).toBe(10) // a1 excluded entirely — null is not
  })
})

// ==================================================
// 6 & 7. MISSING SCORE POLICY
// ==================================================
describe('6. missing = treat_as_zero policy', () => {
  it('a missing source counts as 0 but its max is still added to the denominator', () => {
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1', 'a2'], missingScorePolicy: 'treat_as_zero' })
    const result = calculateStudentSgsScore(formula, { a1: null, a2: 8 }, SOURCES)
    expect(result).toEqual({ status: 'ok', usedTotal: 8, usedMax: 20, percent: 40, calculatedScore: 4 })
  })
})

describe('7. missing = exclude policy', () => {
  it('a missing source is dropped from both numerator and denominator — a DIFFERENT result from treat_as_zero for the identical data', () => {
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1', 'a2'], missingScorePolicy: 'exclude' })
    const result = calculateStudentSgsScore(formula, { a1: null, a2: 8 }, SOURCES)
    expect(result).toEqual({ status: 'ok', usedTotal: 8, usedMax: 10, percent: 80, calculatedScore: 8 })
  })

  it('every selected source missing under exclude -> missing_data, never a divide-by-zero crash or a guessed 0', () => {
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1', 'a2'], missingScorePolicy: 'exclude' })
    const result = calculateStudentSgsScore(formula, { a1: null, a2: null }, SOURCES)
    expect(result).toEqual({ status: 'blocked', reason: 'missing_data', message: expect.any(String) })
  })
})

// ==================================================
// 8, 9, 10. ROUNDING
// ==================================================
describe('8. one-decimal rounding', () => {
  it('rounds to exactly 1 decimal place', () => {
    expect(applyRounding(8.06, 'one_decimal')).toBe(8.1)
    expect(applyRounding(8.04, 'one_decimal')).toBe(8)
  })
})

describe('9. two-decimal rounding', () => {
  it('rounds to exactly 2 decimal places', () => {
    expect(applyRounding(3.14159, 'two_decimal')).toBe(3.14)
    expect(applyRounding(3.14559, 'two_decimal')).toBe(3.15)
  })
})

describe('10. integer rounding', () => {
  it('rounds to the nearest whole number', () => {
    expect(applyRounding(7.6, 'integer')).toBe(8)
    expect(applyRounding(7.4, 'integer')).toBe(7)
  })

  it('"none" performs no rounding at all', () => {
    expect(applyRounding(7.123456, 'none')).toBe(7.123456)
  })
})

// ==================================================
// 11. RESULT CANNOT EXCEED TARGET MAX
// ==================================================
describe('11. result cannot exceed target max', () => {
  it('a corrupted source score above ITS OWN max produces an out-of-range raw result, which is BLOCKED — never clamped or silently accepted', () => {
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1'] })
    // a1's own max is 10, but its recorded score is 15 (data corruption /
    // a max-score change after the fact) -> ratio > 1 -> raw > target.
    const result = calculateStudentSgsScore(formula, { a1: 15 }, SOURCES)
    expect(result.status).toBe('blocked')
    if (result.status === 'blocked') {
      expect(result.reason).toBe('out_of_range')
      expect(result.message).toContain('10')
    }
  })

  it('a result exactly AT the target max is fine (not treated as an overage)', () => {
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1'] })
    const result = calculateStudentSgsScore(formula, { a1: 10 }, SOURCES)
    expect(result).toEqual({ status: 'ok', usedTotal: 10, usedMax: 10, percent: 100, calculatedScore: 10 })
  })
})

// ==================================================
// 12. CLASS PREVIEW STATISTICS
// ==================================================
describe('12. class preview statistics', () => {
  it('computes totals/average/highest/lowest correctly over a mixed roster, and never counts a blocked row toward the average', () => {
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1', 'a2'], missingScorePolicy: 'exclude' })
    const roster = [
      { studentId: 's1', studentNumber: 1, fullName: 'หนึ่ง' },
      { studentId: 's2', studentNumber: 2, fullName: 'สอง' },
      { studentId: 's3', studentNumber: 3, fullName: 'สาม' }, // no data at all -> missing_data
    ]
    const scores: Record<string, Record<string, number | null>> = {
      s1: { a1: 10, a2: 10 }, // 20/20 -> 10.0
      s2: { a1: 5, a2: 5 }, // 10/20 -> 5.0
      s3: { a1: null, a2: null },
    }
    const preview = calculateClassPreview(formula, roster, scores, SOURCES)
    expect(preview.summary).toEqual({
      totalStudents: 3,
      calculable: 2,
      missingData: 1,
      average: 7.5,
      highest: 10,
      lowest: 5,
    })
    expect(preview.rows.map((r) => r.result.status)).toEqual(['ok', 'ok', 'blocked'])
  })
})

// ==================================================
// 13 & 14. EXISTING TARGET VALUES / OVERWRITE
// ==================================================
describe('13. existing target values are skipped by default', () => {
  it('a student who already has a value in the target column is planned as skip_existing when overwrite is off', () => {
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1'] })
    const roster = [{ studentId: 's1', studentNumber: 1, fullName: 'หนึ่ง' }]
    const preview = calculateClassPreview(formula, roster, { s1: { a1: 8 } }, SOURCES)
    const plan = planSgsScoreCalculationApply(preview, { s1: 5 }, false)
    expect(plan).toEqual([{ studentId: 's1', action: 'skip_existing', calculatedScore: 8 }])
  })

  it('countExistingTargetScores counts only non-null existing values, shown before applying', () => {
    expect(countExistingTargetScores({ s1: 5, s2: null, s3: 0 })).toBe(2) // 0 is a real existing score too
  })
})

describe('14. explicit overwrite', () => {
  it('with overwrite enabled, a student who already has a value is planned to WRITE instead', () => {
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1'] })
    const roster = [{ studentId: 's1', studentNumber: 1, fullName: 'หนึ่ง' }]
    const preview = calculateClassPreview(formula, roster, { s1: { a1: 8 } }, SOURCES)
    const plan = planSgsScoreCalculationApply(preview, { s1: 5 }, true)
    expect(plan).toEqual([{ studentId: 's1', action: 'write', calculatedScore: 8 }])
  })

  it('a student with NO existing value writes regardless of the overwrite flag', () => {
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1'] })
    const roster = [{ studentId: 's1', studentNumber: 1, fullName: 'หนึ่ง' }]
    const preview = calculateClassPreview(formula, roster, { s1: { a1: 8 } }, SOURCES)
    expect(planSgsScoreCalculationApply(preview, { s1: null }, false)[0].action).toBe('write')
  })

  it('a student whose calculation was blocked is NEVER written, even with overwrite enabled', () => {
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1'], missingScorePolicy: 'exclude' })
    const roster = [{ studentId: 's1', studentNumber: 1, fullName: 'หนึ่ง' }]
    const preview = calculateClassPreview(formula, roster, { s1: { a1: null } }, SOURCES)
    expect(planSgsScoreCalculationApply(preview, {}, true)[0].action).toBe('skip_not_calculable')
  })
})

// ==================================================
// 15. ONLY THE SELECTED SGS COLUMN CHANGES
// ==================================================
describe('15. applying a calculation only ever changes the ONE selected SGS column', () => {
  it('the apply-plan row shape carries no per-row column id at all — there is no way for a write to target a different column than the one the caller passed', () => {
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1'] })
    const roster = [{ studentId: 's1', studentNumber: 1, fullName: 'หนึ่ง' }]
    const preview = calculateClassPreview(formula, roster, { s1: { a1: 8 } }, SOURCES)
    const [row] = planSgsScoreCalculationApply(preview, {}, false)
    expect(Object.keys(row).sort()).toEqual(['action', 'calculatedScore', 'studentId'])
  })

  it('applySgsScoreCalculation writes every row through the SAME single columnId parameter — never a per-row id', () => {
    const source = readSource('./sgs-score-calculation-service.ts')
    const fn = source.slice(source.indexOf('export async function applySgsScoreCalculation'), source.indexOf('// ==================================================\n// Source retrieval'))
    expect(fn).toContain('setSgsScore(columnId, row.studentId, row.calculatedScore)')
    expect(fn).not.toMatch(/row\.columnId|row\.column/)
  })
})

// ==================================================
// 16. RAW SOURCE SCORES NEVER MUTATE
// ==================================================
describe('16. raw assignment scores are never mutated by this feature', () => {
  it('this whole file only ever IMPORTS READ functions from assignment-service.ts — never a write function', () => {
    const source = readSource('./sgs-score-calculation-service.ts')
    expect(source).toContain("import { getAssignments, getSubmissions } from '@/services/assignment-service'")
    for (const writeFn of ['setSubmissionScore', 'updateAssignment', 'archiveAssignment', 'deleteAssignmentPermanently', 'setSubmissionStatus', 'setSubmissionNote']) {
      expect(source).not.toContain(writeFn)
    }
  })

  it('the only write primitive imported anywhere in this file is setSgsScore, from the EXISTING SGS workspace service — no new write path', () => {
    const source = readSource('./sgs-score-calculation-service.ts')
    expect(source).toContain("import { setSgsScore } from '@/services/sgs-score-workspace-service'")
  })
})

// ==================================================
// 17 & 18. CURRENT CLASSROOM / SUBJECT ISOLATION
// ==================================================
describe('17. current classroom isolation', () => {
  it('getSgsScoreCalculationSources passes the caller\'s classroomId straight through to getAssignments, unmodified and un-merged with any other classroom', () => {
    const source = readSource('./sgs-score-calculation-service.ts')
    const fn = source.slice(source.indexOf('export async function getSgsScoreCalculationSources'))
    expect(fn).toContain('getAssignments(subjectId, classroomId)')
  })
})

describe('18. current subject isolation', () => {
  it('the SAME call also passes subjectId straight through — getAssignments itself is the already-scoped, already-verified source of truth this file delegates to instead of re-implementing', () => {
    const source = readSource('./sgs-score-calculation-service.ts')
    const fn = source.slice(source.indexOf('export async function getSgsScoreCalculationSources'))
    expect(fn).toContain('getAssignments(subjectId, classroomId)')
    // Only ONE getAssignments call — never a second query that could pull
    // in another subject's assignments.
    expect(fn.match(/getAssignments\(/g)).toHaveLength(1)
  })
})

// ==================================================
// 19. SAVED FORMULA CAN REPRODUCE THE SAME CALCULATION
// ==================================================
describe('19. a saved formula reproduces the exact same calculation later', () => {
  it('a formula round-tripped through JSON (simulating calculation_formula jsonb storage) produces an identical class preview', () => {
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1', 'a2', 'a3', 'a4'] })
    const roster = [
      { studentId: 's1', studentNumber: 1, fullName: 'หนึ่ง' },
      { studentId: 's2', studentNumber: 2, fullName: 'สอง' },
    ]
    const scores = { s1: { a1: 10, a2: 10, a3: 16, a4: 20 }, s2: { a1: 4, a2: 4, a3: 8, a4: 12 } }

    const before = calculateClassPreview(formula, roster, scores, SOURCES)
    const reloaded = JSON.parse(JSON.stringify(formula)) as SgsScoreCalculationFormula
    const after = calculateClassPreview(reloaded, roster, scores, SOURCES)

    expect(after).toEqual(before)
  })
})

// ==================================================
// 20. MODAL OPEN/CLOSE NEVER NAVIGATES AWAY
// ==================================================
describe('20. the calculator is a same-page overlay — it never navigates away from คะแนน SGS', () => {
  it('score-calculation-modal.tsx renders through the existing Dialog overlay component, and never imports a router navigation API or touches window.location', () => {
    const source = readSource('../features/subjects-real/score-calculation-modal.tsx')
    expect(source).toContain("from '@/components/ui/dialog'")
    expect(source).not.toMatch(/useNavigate|react-router/)
    expect(source).not.toMatch(/window\.location|location\.href|location\.assign|location\.reload/)
  })
})
