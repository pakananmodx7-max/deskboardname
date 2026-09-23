import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  applyRounding,
  applySgsScoreCalculation,
  calculateClassPreview,
  calculateIndividualWeightedScore,
  calculateProportionalScore,
  calculateStudentSgsScore,
  calculateWeightedGroupScore,
  countExistingTargetScores,
  planSgsScoreCalculationApply,
  validateCalculationConfig,
  verifySgsScoreCalculationApply,
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

  it('applySgsScoreCalculation writes every row through the SAME single columnId parameter — never a per-row id, and defaults to the EXISTING setSgsScore, never a new write primitive', () => {
    const source = readSource('./sgs-score-calculation-service.ts')
    const fn = source.slice(source.indexOf('export async function applySgsScoreCalculation'), source.indexOf('// ==================================================\n// Source retrieval'))
    expect(fn).toContain('write: (columnId: string, studentId: string, score: number | null) => Promise<void> = setSgsScore')
    expect(fn).toContain('write(columnId, row.studentId, row.calculatedScore)')
    expect(fn).not.toMatch(/row\.columnId|row\.column/)
  })
})

// ==================================================
// 16. RAW SOURCE SCORES NEVER MUTATE
// ==================================================
describe('16. raw assignment scores are never mutated by this feature', () => {
  it('this whole file only ever IMPORTS READ functions from assignment-service.ts — never a write function', () => {
    const source = readSource('./sgs-score-calculation-service.ts')
    // Batched read (getSubmissionsForAssignments) replaced the per-assignment
    // getSubmissions loop — still READ functions only.
    expect(source).toContain("import { getAssignments, getSubmissionsForAssignments } from '@/services/assignment-service'")
    for (const writeFn of ['setSubmissionScore', 'updateAssignment', 'archiveAssignment', 'deleteAssignmentPermanently', 'setSubmissionStatus', 'setSubmissionNote']) {
      expect(source).not.toContain(writeFn)
    }
  })

  it('the only write primitives imported anywhere in this file come from the SGS workspace service and write ONLY sgs_scores — setSgsScore (pre-0027) and recalculateSgsScoreColumn (0027)', () => {
    const source = readSource('./sgs-score-calculation-service.ts')
    expect(source).toContain("import { recalculateSgsScoreColumn, setSgsScore } from '@/services/sgs-score-workspace-service'")
    const workspace = readSource('./sgs-score-workspace-service.ts')
    const recalcFn = workspace.slice(workspace.indexOf('export async function recalculateSgsScoreColumn'), workspace.indexOf('export async function resetSgsScoreColumnToAuto'))
    expect(recalcFn).toContain("rpc('recalculate_sgs_score_column'")
    expect(recalcFn).not.toContain('assignment_submissions')
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

// ==================================================
// LIVE PRODUCTION REGRESSION — "บันทึกคะแนนไม่สำเร็จ" even though the
// preview showed 32/32 students calculated correctly.
//
// ROOT CAUSE: score-calculation-modal.tsx's doApply() wrote the scores
// via applySgsScoreCalculation (which SUCCEEDED — the same canonical
// setSgsScore every manual SGS edit already uses), then immediately
// called updateSgsScoreColumnFormula in the SAME try block to save the
// formula. That call writes calculation_formula — a column that exists
// only once migration 0025 has been applied, and (per every migration
// in this repo) is NOT auto-applied. Its failure was caught by the SAME
// catch as a genuine score-write failure, so a successful 32/32 score
// save was reported to the teacher as "บันทึกคะแนนไม่สำเร็จ", the modal
// never closed, and onApplied() (which would have refreshed the table
// to show the real saved values) was never called.
// ==================================================

function buildRoster(count: number) {
  return Array.from({ length: count }, (_, i) => ({ studentId: `s${i + 1}`, studentNumber: i + 1, fullName: `นักเรียน ${i + 1}` }))
}

/** A fake persistence layer standing in for setSgsScore — records every
 * call and optionally rejects specific students, so the REAL
 * applySgsScoreCalculation attempt/collect-failures loop (the actual
 * bug's own logic) runs end to end without a live Supabase connection. */
function fakeWriter(options: { rejectStudentIds?: Set<string> } = {}) {
  const calls: { columnId: string; studentId: string; score: number | null }[] = []
  const write = async (columnId: string, studentId: string, score: number | null) => {
    calls.push({ columnId, studentId, score })
    if (options.rejectStudentIds?.has(studentId)) {
      throw new Error(`simulated write failure for ${studentId}`)
    }
  }
  return { write, calls }
}

describe('APPLY/SAVE REGRESSION: applySgsScoreCalculation is the real, sole authority on whether scores were saved', () => {
  it('THE EXACT LIVE CASE: 32/32 calculated students all persist successfully through the canonical write path', async () => {
    const roster = buildRoster(32)
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1', 'a2'] })
    const scores: Record<string, Record<string, number | null>> = {}
    roster.forEach((s) => {
      scores[s.studentId] = { a1: 8, a2: 8 }
    })
    const preview = calculateClassPreview(formula, roster, scores, SOURCES)
    expect(preview.summary.calculable).toBe(32)

    const plan = planSgsScoreCalculationApply(preview, {}, false)
    expect(plan.filter((r) => r.action === 'write')).toHaveLength(32)

    const { write, calls } = fakeWriter()
    const result = await applySgsScoreCalculation('col-10', plan, write)

    expect(result).toEqual({ written: 32, failed: [] })
    expect(calls).toHaveLength(32)
    // Only the ONE target column — every call carries the identical id.
    expect(calls.every((c) => c.columnId === 'col-10')).toBe(true)
    // Real student ids, never a display label/row index.
    expect(calls.map((c) => c.studentId).sort()).toEqual(roster.map((s) => s.studentId).sort())
  })

  it('a failure partway through NEVER silently abandons the rest of the class — every planned row is still attempted, and every failure is reported individually rather than one thrown error hiding what succeeded', async () => {
    const roster = buildRoster(32)
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1'] })
    const scores: Record<string, Record<string, number | null>> = {}
    roster.forEach((s) => {
      scores[s.studentId] = { a1: 7 }
    })
    const preview = calculateClassPreview(formula, roster, scores, SOURCES)
    const plan = planSgsScoreCalculationApply(preview, {}, false)

    // The 5th planned write fails (simulating a real per-row DB error) —
    // this must NOT stop rows 6-32 from being attempted.
    const failingStudentId = plan.filter((r) => r.action === 'write')[4].studentId
    const { write, calls } = fakeWriter({ rejectStudentIds: new Set([failingStudentId]) })
    const result = await applySgsScoreCalculation('col-10', plan, write)

    expect(calls).toHaveLength(32) // every row was ATTEMPTED
    expect(result.written).toBe(31)
    expect(result.failed).toEqual([{ studentId: failingStudentId, message: expect.stringContaining('simulated write failure') }])
  })

  it('a total failure (e.g. the write function rejecting for every row) reports written: 0 with every student individually listed — never a single opaque thrown error', async () => {
    const roster = buildRoster(3)
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1'] })
    const scores = Object.fromEntries(roster.map((s) => [s.studentId, { a1: 5 }]))
    const preview = calculateClassPreview(formula, roster, scores, SOURCES)
    const plan = planSgsScoreCalculationApply(preview, {}, false)

    const { write } = fakeWriter({ rejectStudentIds: new Set(roster.map((s) => s.studentId)) })
    const result = await applySgsScoreCalculation('col-10', plan, write)

    expect(result.written).toBe(0)
    expect(result.failed).toHaveLength(3)
  })

  it('SCORE 0 PERSISTS AS 0: a calculated score of exactly 0 is written as the numeric value 0, never skipped and never coerced to null', async () => {
    const roster = [{ studentId: 's1', studentNumber: 1, fullName: 'หนึ่ง' }]
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1'], missingScorePolicy: 'treat_as_zero' })
    // score 0 on the one selected source -> calculated result is exactly 0.
    const preview = calculateClassPreview(formula, roster, { s1: { a1: 0 } }, SOURCES)
    expect(preview.rows[0].result).toMatchObject({ status: 'ok', calculatedScore: 0 })

    const plan = planSgsScoreCalculationApply(preview, {}, false)
    expect(plan).toEqual([{ studentId: 's1', action: 'write', calculatedScore: 0 }])

    const { write, calls } = fakeWriter()
    const result = await applySgsScoreCalculation('col-10', plan, write)
    expect(result).toEqual({ written: 1, failed: [] })
    expect(calls).toEqual([{ columnId: 'col-10', studentId: 's1', score: 0 }])
  })

  it('a student the preview could not calculate (missing_data) is NEVER attempted at all — skip_not_calculable never reaches the write function', async () => {
    const roster = [
      { studentId: 's1', studentNumber: 1, fullName: 'หนึ่ง' },
      { studentId: 's2', studentNumber: 2, fullName: 'สอง' },
    ]
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1'], missingScorePolicy: 'exclude' })
    const preview = calculateClassPreview(formula, roster, { s1: { a1: 8 }, s2: { a1: null } }, SOURCES)
    const plan = planSgsScoreCalculationApply(preview, {}, false)
    expect(plan.find((r) => r.studentId === 's2')?.action).toBe('skip_not_calculable')

    const { write, calls } = fakeWriter()
    const result = await applySgsScoreCalculation('col-10', plan, write)
    expect(result.written).toBe(1)
    expect(calls.map((c) => c.studentId)).toEqual(['s1'])
  })

  it('EXISTING VALUE SKIP POLICY: a student who already holds a value in the target column is never attempted when overwrite is off', async () => {
    const roster = [{ studentId: 's1', studentNumber: 1, fullName: 'หนึ่ง' }]
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1'] })
    const preview = calculateClassPreview(formula, roster, { s1: { a1: 8 } }, SOURCES)
    const plan = planSgsScoreCalculationApply(preview, { s1: 5 }, false)
    expect(plan[0].action).toBe('skip_existing')

    const { write, calls } = fakeWriter()
    const result = await applySgsScoreCalculation('col-10', plan, write)
    expect(result.written).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it('EXPLICIT OVERWRITE POLICY: the same student IS attempted, and written, once overwrite is enabled', async () => {
    const roster = [{ studentId: 's1', studentNumber: 1, fullName: 'หนึ่ง' }]
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1'] })
    const preview = calculateClassPreview(formula, roster, { s1: { a1: 8 } }, SOURCES)
    const plan = planSgsScoreCalculationApply(preview, { s1: 5 }, true)
    expect(plan[0].action).toBe('write')

    const { write, calls } = fakeWriter()
    const result = await applySgsScoreCalculation('col-10', plan, write)
    expect(result.written).toBe(1)
    expect(calls).toHaveLength(1)
  })

  it('SUBJECT/CLASSROOM ISOLATION: applySgsScoreCalculation never touches any column other than the one explicit columnId it was called with — a different subject/classroom\'s columns are structurally unreachable', async () => {
    const roster = buildRoster(5)
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1'] })
    const scores = Object.fromEntries(roster.map((s) => [s.studentId, { a1: 6 }]))
    const preview = calculateClassPreview(formula, roster, scores, SOURCES)
    const plan = planSgsScoreCalculationApply(preview, {}, false)

    const { write, calls } = fakeWriter()
    await applySgsScoreCalculation('this-subjects-classrooms-column-10', plan, write)
    expect(new Set(calls.map((c) => c.columnId))).toEqual(new Set(['this-subjects-classrooms-column-10']))
  })
})

describe('APPLY/SAVE REGRESSION: the modal never conflates a successful score write with the separate, optional formula save', () => {
  it('doApply saves scores and saves the formula in TWO SEPARATE try/catch blocks — a formula-save failure can never be reported as a score-save failure', () => {
    const source = readSource('../features/subjects-real/score-calculation-modal.tsx')
    const fn = source.slice(source.indexOf('async function doApply'), source.indexOf('function handleApplyClick'))

    const scoreWriteIndex = fn.indexOf('applySgsScoreCalculation(targetColumn.id, plan)')
    const formulaTryIndex = fn.indexOf('try {\n        await updateSgsScoreColumnFormula')
    // The literal success string (the ternary's plain "nothing skipped"
    // branch) is unique — unlike the templated "เขียนใหม่ X, ข้าม Y" branch,
    // which also contains this text but wrapped in extra characters.
    const successStringIndex = fn.indexOf("'บันทึกคะแนนคำนวณแล้ว'")
    expect(scoreWriteIndex).toBeGreaterThan(-1)
    expect(formulaTryIndex).toBeGreaterThan(scoreWriteIndex)
    expect(successStringIndex).toBeGreaterThan(formulaTryIndex)

    // The formula save's own catch must never touch the success path —
    // it only records a diagnostic, never a toast/failure report.
    const formulaCatch = fn.slice(formulaTryIndex, successStringIndex)
    expect(formulaCatch).toContain('catch (formulaErr)')
    expect(formulaCatch).not.toContain("toast(toFriendlyErrorMessage")
  })

  it('EXACT REQUIRED SUCCESS MESSAGE: "บันทึกคะแนนคำนวณแล้ว" is shown only after applySgsScoreCalculation reports zero failures AND the read-back verifies', () => {
    const source = readSource('../features/subjects-real/score-calculation-modal.tsx')
    const fn = source.slice(source.indexOf('async function doApply'), source.indexOf('function handleApplyClick'))
    expect(fn).toContain("'บันทึกคะแนนคำนวณแล้ว'")

    const failedCheckIndex = fn.indexOf('if (failed.length > 0)')
    const verifyCheckIndex = fn.indexOf('if (!verification.ok)')
    const successStringIndex = fn.indexOf("'บันทึกคะแนนคำนวณแล้ว'")
    expect(failedCheckIndex).toBeGreaterThan(-1)
    expect(verifyCheckIndex).toBeGreaterThan(failedCheckIndex)
    expect(successStringIndex).toBeGreaterThan(verifyCheckIndex)
  })

  it('SAVE FAILURE NEVER FALSELY REPORTS SUCCESS, AND KEEPS THE MODAL OPEN: the partial/total-failure branch returns before onOpenChange(false) is ever reached', () => {
    const source = readSource('../features/subjects-real/score-calculation-modal.tsx')
    const fn = source.slice(source.indexOf('async function doApply'), source.indexOf('function handleApplyClick'))
    const failedBranch = fn.slice(fn.indexOf('if (failed.length > 0) {'), fn.indexOf('// SUCCESS MUST REQUIRE READ-BACK'))
    expect(failedBranch).toContain('return')
    expect(failedBranch).not.toContain('onOpenChange(false)')
    // The read-back-mismatch branch (a "success" that turned out not to
    // be one) must not close the modal either.
    const verifyBranch = fn.slice(fn.indexOf('if (!verification.ok) {'), fn.indexOf('// Verified: the scores are genuinely saved'))
    expect(verifyBranch).toContain('return')
    expect(verifyBranch).not.toContain('onOpenChange(false)')
    // The class-level thrown-error catch (a structural failure before
    // any row was attempted) must not close the modal either.
    const outerCatch = fn.slice(fn.lastIndexOf('} catch (err) {'))
    expect(outerCatch).not.toContain('onOpenChange(false)')
  })

  it('the real diagnostic error is captured (setApplyDiagnostic) on every failure path, gated behind import.meta.env.DEV so a teacher only ever sees the friendly toast', () => {
    const source = readSource('../features/subjects-real/score-calculation-modal.tsx')
    expect(source).toContain('setApplyDiagnostic(')
    expect(source).toContain('import.meta.env.DEV')
  })

  it('a save failure preserves the preview and calculation settings — setPreview(null) is never called on the failure paths of doApply', () => {
    const source = readSource('../features/subjects-real/score-calculation-modal.tsx')
    const fn = source.slice(source.indexOf('async function doApply'), source.indexOf('function handleApplyClick'))
    expect(fn).not.toContain('setPreview(null)')
    expect(fn).not.toContain('setSelectedSourceIds([])')
    expect(fn).not.toContain('setMode(')
  })
})

// ==================================================
// LIVE PRODUCTION REGRESSION — apply reported success, but the คะแนน
// SGS table still showed the OLD values in the target column.
//
// TRACED ONE STUDENT END TO END (per the report's own required trace):
//   old workspace value:      e.g. 3 (a real, pre-existing manual entry)
//   calculated preview value: e.g. 8.5
//   apply payload:            { columnId: 'col-10', studentId, calculatedScore: 8.5 }
//   plan action:              'skip_existing' — the column already held
//                              3 for this student and overwriteExisting
//                              was OFF (the correct, intended default:
//                              "เขียนเฉพาะช่องว่าง")
//   database update:          NEVER ISSUED for this student — skipped
//                              rows never reach applySgsScoreCalculation
//                              at all (see the "only write" filter)
//   database value read back: still 3 — because it was NEVER asked to
//                              change, per the teacher's own overwrite
//                              setting
//   UI toast shown:           "บันทึกคะแนนคำนวณแล้ว" — TRUE (nothing
//                              failed) but, before this fix, gave no
//                              indication that most/all students were
//                              skipped rather than written, reading like
//                              "all calculated values were applied."
//
// ROOT CAUSE (A): the overwrite policy was behaving CORRECTLY — the
// database was never wrong. The UI was misleading: (1) the preview never
// showed how many rows would be written vs. skipped BEFORE confirming,
// and (2) the success toast did not distinguish "0 written, 32 skipped"
// from "32 written." Neither the database nor the cache/refresh was
// stale — this is entirely a "what the teacher was told" problem.
//
// This also adds the explicitly required, separate safety net for cause
// (B)/(C) — verifySgsScoreCalculationApply, wired into doApply so
// success can never be declared merely because the write request did
// not throw; it must match a fresh read-back.
// ==================================================

describe('LIVE REGRESSION — read-back verification: success requires the persisted value to match, never just "the request did not throw"', () => {
  it('4. persistence "succeeds" (write request does not throw) but a fresh read-back shows a DIFFERENT value -> reported as a MISMATCH, never as success', () => {
    const roster = [
      { studentId: 's1', studentNumber: 1, fullName: 'หนึ่ง' },
      { studentId: 's2', studentNumber: 2, fullName: 'สอง' },
    ]
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1'] })
    const preview = calculateClassPreview(formula, roster, { s1: { a1: 8 }, s2: { a1: 9 } }, SOURCES)
    const plan = planSgsScoreCalculationApply(preview, {}, false)
    expect(plan.map((r) => r.action)).toEqual(['write', 'write'])

    // The write "succeeded" (no throw), but the read-back disagrees with
    // s2 — simulating a live case where the DB ended up with a stale or
    // unexpected value despite the client-side call not erroring.
    const readBack = { s1: plan[0].calculatedScore, s2: 3 }
    const verification = verifySgsScoreCalculationApply(plan, readBack)

    expect(verification.ok).toBe(false)
    expect(verification.mismatches).toEqual([{ studentId: 's2', expected: plan[1].calculatedScore, actual: 3 }])
  })

  it('5. persistence succeeds AND read-back matches exactly -> verified success, with nothing left to report as a mismatch', () => {
    const roster = [
      { studentId: 's1', studentNumber: 1, fullName: 'หนึ่ง' },
      { studentId: 's2', studentNumber: 2, fullName: 'สอง' },
    ]
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1'] })
    const preview = calculateClassPreview(formula, roster, { s1: { a1: 8 }, s2: { a1: 9 } }, SOURCES)
    const plan = planSgsScoreCalculationApply(preview, {}, false)

    const readBack = { s1: plan[0].calculatedScore, s2: plan[1].calculatedScore }
    const verification = verifySgsScoreCalculationApply(plan, readBack)

    expect(verification).toEqual({ ok: true, mismatches: [] })
  })

  it('6. SCORE 0 REMAINS A REAL EXISTING SCORE: a student whose target column already holds 0 is correctly treated as "has an existing value" (skip_existing by default) — 0 is never mistaken for empty', () => {
    const roster = [{ studentId: 's1', studentNumber: 1, fullName: 'หนึ่ง' }]
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1'] })
    const preview = calculateClassPreview(formula, roster, { s1: { a1: 8 } }, SOURCES)

    const plan = planSgsScoreCalculationApply(preview, { s1: 0 }, false)
    expect(plan).toEqual([{ studentId: 's1', action: 'skip_existing', calculatedScore: preview.rows[0].result.status === 'ok' ? preview.rows[0].result.calculatedScore : null }])

    // Read-back verification only ever checks WRITE rows — a correctly
    // skipped row (existing 0 preserved) is never flagged as a mismatch.
    const verification = verifySgsScoreCalculationApply(plan, {})
    expect(verification).toEqual({ ok: true, mismatches: [] })
  })

  it('1. APPLY TO EMPTY TARGET CELLS: no existing value -> plan writes -> read-back matching the plan verifies clean', () => {
    const roster = buildRoster(5)
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1'] })
    const scores = Object.fromEntries(roster.map((s) => [s.studentId, { a1: 6 }]))
    const preview = calculateClassPreview(formula, roster, scores, SOURCES)

    // Every target cell empty (existingTargetScores = {}).
    const plan = planSgsScoreCalculationApply(preview, {}, false)
    expect(plan.every((r) => r.action === 'write')).toBe(true)

    const readBack = Object.fromEntries(plan.map((r) => [r.studentId, r.calculatedScore]))
    expect(verifySgsScoreCalculationApply(plan, readBack)).toEqual({ ok: true, mismatches: [] })
  })

  it('2. EXISTING SCORES + OVERWRITE OFF: every already-scored student is correctly counted as skipped, and a read-back matching their UNCHANGED old value still verifies clean (the plan never expected them to change)', () => {
    const roster = buildRoster(3)
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1'] })
    const scores = Object.fromEntries(roster.map((s) => [s.studentId, { a1: 7 }]))
    const preview = calculateClassPreview(formula, roster, scores, SOURCES)

    const oldValues = { s1: 1, s2: 2, s3: 3 } // real, distinct pre-existing values
    const plan = planSgsScoreCalculationApply(preview, oldValues, false)
    expect(plan.every((r) => r.action === 'skip_existing')).toBe(true)

    // The table must still show the OLD values — a read-back of exactly
    // those old values is CORRECT, not a failure, because none of these
    // rows were ever supposed to change.
    expect(verifySgsScoreCalculationApply(plan, oldValues)).toEqual({ ok: true, mismatches: [] })
  })

  it('3. EXISTING SCORES + OVERWRITE ON: the same students are now planned to WRITE, and only a read-back of the NEW calculated values (not the old ones) verifies clean', () => {
    const roster = buildRoster(3)
    const formula = proportionalFormula({ sourceAssignmentIds: ['a1'] })
    const scores = Object.fromEntries(roster.map((s) => [s.studentId, { a1: 7 }]))
    const preview = calculateClassPreview(formula, roster, scores, SOURCES)

    const oldValues = { s1: 1, s2: 2, s3: 3 }
    const plan = planSgsScoreCalculationApply(preview, oldValues, true)
    expect(plan.every((r) => r.action === 'write')).toBe(true)

    // A read-back that still shows the OLD values must NOT verify —
    // overwrite was explicitly requested.
    expect(verifySgsScoreCalculationApply(plan, oldValues).ok).toBe(false)
    // Only the NEW calculated values verify.
    const newReadBack = Object.fromEntries(plan.map((r) => [r.studentId, r.calculatedScore]))
    expect(verifySgsScoreCalculationApply(plan, newReadBack)).toEqual({ ok: true, mismatches: [] })
  })
})

describe('LIVE REGRESSION — the modal never claims a misleading success and always verifies before reporting one', () => {
  it('doApply reads the target column back (getSgsScores) and checks it with verifySgsScoreCalculationApply BEFORE the success toast/modal close — never trusting "the write request did not throw" alone', () => {
    const source = readSource('../features/subjects-real/score-calculation-modal.tsx')
    const fn = source.slice(source.indexOf('async function doApply'), source.indexOf('function handleApplyClick'))

    const scoreWriteIndex = fn.indexOf('applySgsScoreCalculation(targetColumn.id, plan)')
    const readBackIndex = fn.indexOf('await getSgsScores(targetColumn.id)')
    const verifyIndex = fn.indexOf('verifySgsScoreCalculationApply(plan, readBack)')
    const successToastIndex = fn.indexOf("skippedExisting > 0")
    expect(readBackIndex).toBeGreaterThan(scoreWriteIndex)
    expect(verifyIndex).toBeGreaterThan(readBackIndex)
    expect(successToastIndex).toBeGreaterThan(verifyIndex)

    // A verification mismatch must return before onOpenChange(false).
    const mismatchBranch = fn.slice(fn.indexOf('if (!verification.ok) {'), fn.indexOf('// Verified: the scores are genuinely saved'))
    expect(mismatchBranch).toContain('return')
    expect(mismatchBranch).not.toContain('onOpenChange(false)')
  })

  it('the success toast always states how many were written vs. skipped-for-existing-value — never a bare claim that reads as "all calculated values were applied"', () => {
    const source = readSource('../features/subjects-real/score-calculation-modal.tsx')
    const fn = source.slice(source.indexOf('async function doApply'), source.indexOf('function handleApplyClick'))
    expect(fn).toContain('skippedExisting > 0')
    expect(fn).toContain('เขียนใหม่ ${written} คน, ข้ามเพราะมีคะแนนเดิม ${skippedExisting} คน')
  })

  it('the preview shown BEFORE confirming always displays "จะเขียนใหม่" and "จะข้ามเพราะมีคะแนนเดิม", computed from the SAME planSgsScoreCalculationApply doApply itself uses — never a static/unrelated existing-count', () => {
    const source = readSource('../features/subjects-real/score-calculation-modal.tsx')
    expect(source).toContain('จะเขียนใหม่')
    expect(source).toContain('จะข้ามเพราะมีคะแนนเดิม')
    const applyPlanMemoIndex = source.indexOf('const applyPlan = useMemo(')
    expect(applyPlanMemoIndex).toBeGreaterThan(-1)
    const memoBody = source.slice(applyPlanMemoIndex, source.indexOf('const toWriteCount ='))
    expect(memoBody).toContain('planSgsScoreCalculationApply(preview, existingTargetScores, overwriteExisting, protectedStudentIds)')
    // ...and doApply uses the exact same call.
    const fn = source.slice(source.indexOf('async function doApply'), source.indexOf('function handleApplyClick'))
    expect(fn).toContain('planSgsScoreCalculationApply(preview, existingTargetScores, overwriteExisting, protectedStudentIds)')
  })
})
