import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  applySgsScoreCalculationWithOrigin,
  buildRecalculationValuesFromPlan,
  calculateClassPreview,
  calculateStudentSgsScore,
  computeLiveCalculatedScores,
  describeFormulaSources,
  explainStudentCalculation,
  listFormulaSourceIds,
  planSgsScoreCalculationApply,
} from './sgs-score-calculation-service'
import {
  applySgsScoreCellAction,
  applySgsScoreColumnReset,
  applySgsScoreRecalculation,
  computeEffectiveSgsScore,
  computeSgsScoreColumnResetImpact,
  effectiveScoresFromCells,
  getSgsScoreCellMenuActions,
  hasSgsCalculationDrift,
  interpretSgsScoreCellInput,
  resolveSgsScoreCell,
  SGS_SCORE_CELL_MENU_LABEL,
  SGS_SCORE_ORIGIN_TOOLTIP,
} from './sgs-score-origin'
import {
  buildSgsRecalculationPayload,
  buildSgsScoreWorkspaceMultiPayload,
  buildSgsScoreWorkspacePayload,
  buildSgsScoreWorkspaceRows,
  computeSgsScoreWorkspaceSendPlan,
  mapSgsScoreCellRow,
} from './sgs-score-workspace-service'
import type { SgsScoreCalculationFormula, SgsScoreCalculationSource } from '@/types/sgs-score-calculation'
import type { SgsScoreCellRecord } from '@/types/sgs-score-workspace'

const here = dirname(fileURLToPath(import.meta.url))
function readSource(relativePath: string): string {
  return readFileSync(resolve(here, relativePath), 'utf8')
}

const NOW = '2026-09-23T10:00:00.000Z'

// ใบงานที่ 4 (เต็ม 10), แบบฝึกหัดที่ 5 (เต็ม 10) -> ช่อง 10 เต็ม 10, proportional
const SOURCES: SgsScoreCalculationSource[] = [
  { assignmentId: 'a4', label: 'ใบงานที่ 4', maxScore: 10 },
  { assignmentId: 'a5', label: 'แบบฝึกหัดที่ 5', maxScore: 10 },
]
const FORMULA: SgsScoreCalculationFormula = {
  mode: 'proportional',
  targetColumnId: 'col-10',
  targetMaxScore: 10,
  missingScorePolicy: 'treat_as_zero',
  rounding: 'one_decimal',
  sourceAssignmentIds: ['a4', 'a5'],
}

function calc(scores: Record<string, number | null>): number | null {
  const result = calculateStudentSgsScore(FORMULA, scores, SOURCES)
  return result.status === 'ok' ? result.calculatedScore : null
}

/** Runs one student through recalculation exactly as
 * recalculate_sgs_score_column does. */
function recalc(record: SgsScoreCellRecord | undefined, scores: Record<string, number | null>, clearOverride = false) {
  return applySgsScoreRecalculation(record, { calculatedScore: calc(scores), clearOverride }, NOW)
}

// ==================================================
// 1-6. Core AUTO / OVERRIDE / RESTORE / CLEAR semantics
// ==================================================

describe('1. AUTO calculation', () => {
  it('source A=8, B=7 -> calculated 7.5, effective 7.5, origin AUTO', () => {
    const record = recalc(undefined, { a4: 8, a5: 7 })!
    expect(record).toMatchObject({ calculatedScore: 7.5, overrideScore: null, score: 7.5, calculatedAt: NOW })
    expect(resolveSgsScoreCell(record)).toMatchObject({ origin: 'auto', effectiveScore: 7.5 })
  })
})

describe('2. manual override', () => {
  it('AUTO 8.5 + teacher enters 9 -> calculated stays 8.5, override 9, effective 9, origin OVERRIDE', () => {
    const auto = recalc(undefined, { a4: 9, a5: 8 })!
    expect(auto.calculatedScore).toBe(8.5)
    const overridden = applySgsScoreCellAction(auto, 'override', 9)!
    expect(overridden).toMatchObject({ calculatedScore: 8.5, overrideScore: 9, score: 9 })
    expect(resolveSgsScoreCell(overridden)).toMatchObject({ origin: 'override', effectiveScore: 9, calculatedScore: 8.5 })
  })
})

describe('3. source score changes while AUTO', () => {
  it('the effective score follows the new calculation', () => {
    const before = recalc(undefined, { a4: 8, a5: 7 })!
    const after = recalc(before, { a4: 10, a5: 7 })!
    expect(resolveSgsScoreCell(after)).toMatchObject({ origin: 'auto', effectiveScore: 8.5, calculatedScore: 8.5 })
  })
})

describe('4. source score changes while OVERRIDE', () => {
  it('spec example: 7.5 -> override 9 -> source A changes -> calculated 8.5, override 9, effective 9', () => {
    const auto = recalc(undefined, { a4: 8, a5: 7 })!
    const overridden = applySgsScoreCellAction(auto, 'override', 9)!
    const afterSourceChange = recalc(overridden, { a4: 10, a5: 7 })!
    expect(afterSourceChange).toMatchObject({ calculatedScore: 8.5, overrideScore: 9, score: 9 })
    expect(resolveSgsScoreCell(afterSourceChange)).toMatchObject({ origin: 'override', effectiveScore: 9 })
  })

  it('the UI can show "คะแนนจากงานต้นทาง" and "คะแนนที่ครูกำหนด" side by side (both kept on the resolved cell)', () => {
    const cell = resolveSgsScoreCell({ score: 9, calculatedScore: 7.5, overrideScore: 9, autoSuppressed: false, calculatedAt: NOW })
    expect(cell.calculatedScore).toBe(7.5)
    expect(cell.overrideScore).toBe(9)
    const dialog = readSource('../features/subjects-real/sgs-score-cell-dialog.tsx')
    expect(dialog).toContain('คะแนนคำนวณปัจจุบัน')
    expect(dialog).toContain('คะแนนที่ครูกำหนด')
    expect(dialog).toContain('คะแนนที่ใช้ส่ง SGS')
  })
})

describe('5. restore AUTO after override', () => {
  it('clear_override -> override NULL, effective = the CURRENT calculated value (not the one at override time)', () => {
    const auto = recalc(undefined, { a4: 8, a5: 7 })!
    const overridden = applySgsScoreCellAction(auto, 'override', 9)!
    const recalculated = recalc(overridden, { a4: 9, a5: 8 })!
    const restored = applySgsScoreCellAction(recalculated, 'clear_override')!
    expect(restored).toMatchObject({ overrideScore: null, score: 8.5 })
    expect(resolveSgsScoreCell(restored).origin).toBe('auto')
  })
})

describe('6. clear manual score', () => {
  it('no calculation behind it -> EMPTY (null, never 0)', () => {
    const manual = applySgsScoreCellAction(undefined, 'override', 12)!
    const cleared = applySgsScoreCellAction(manual, 'clear_override')!
    expect(cleared.score).toBeNull()
    expect(resolveSgsScoreCell(cleared)).toMatchObject({ origin: 'empty', effectiveScore: null })
  })

  it('with an AUTO mapping -> falls back to the calculated value; the mapping is never broken', () => {
    const cleared = applySgsScoreCellAction(applySgsScoreCellAction(recalc(undefined, { a4: 6, a5: 6 }), 'override', 1), 'clear_override')!
    expect(resolveSgsScoreCell(cleared)).toMatchObject({ origin: 'auto', effectiveScore: 6 })
  })

  it('a truly EMPTY cell while the mapping exists needs the explicit suppress_auto action; calculated value is kept', () => {
    const suppressed = applySgsScoreCellAction(recalc(undefined, { a4: 6, a5: 6 }), 'suppress_auto')!
    expect(suppressed).toMatchObject({ score: null, calculatedScore: 6, autoSuppressed: true })
    expect(resolveSgsScoreCell(suppressed)).toMatchObject({ origin: 'empty', autoSuppressed: true })
    // Recalculation keeps it empty...
    expect(recalc(suppressed, { a4: 10, a5: 10 })!.score).toBeNull()
    // ...until the teacher restores it.
    expect(applySgsScoreCellAction(recalc(suppressed, { a4: 10, a5: 10 }), 'clear_override')!.score).toBe(10)
  })

  it('typing blank over an AUTO value never silently breaks the mapping (explicit action required)', () => {
    const cell = resolveSgsScoreCell(recalc(undefined, { a4: 6, a5: 6 }))
    expect(interpretSgsScoreCellInput(cell, null)).toEqual({ kind: 'blank_on_auto' })
    const tab = readSource('../features/subjects-real/tabs/sgs-scores-tab.tsx')
    const blank = tab.slice(tab.indexOf("if (intent.kind === 'blank_on_auto')"), tab.indexOf('try {', tab.indexOf("if (intent.kind === 'blank_on_auto')")))
    expect(blank).toContain('return')
    expect(blank).not.toContain('performCellAction')
  })

  it('typing blank over an OVERRIDE clears the override', () => {
    const cell = resolveSgsScoreCell(applySgsScoreCellAction(undefined, 'override', 4))
    expect(interpretSgsScoreCellInput(cell, null)).toEqual({ kind: 'clear_override' })
  })

  it('clearing a cell that never had a row creates nothing', () => {
    expect(applySgsScoreCellAction(undefined, 'clear_override')).toBeUndefined()
  })
})

// ==================================================
// 7-8. 0 vs NULL
// ==================================================

describe('7. zero score remains zero', () => {
  it('an override of 0 is a real effective 0', () => {
    const record = applySgsScoreCellAction(undefined, 'override', 0)!
    expect(record.score).toBe(0)
    expect(resolveSgsScoreCell(record)).toMatchObject({ origin: 'override', effectiveScore: 0 })
  })

  it('a calculated 0 is a real effective 0 (AUTO, not EMPTY)', () => {
    const record = recalc(undefined, { a4: 0, a5: 0 })!
    expect(record.score).toBe(0)
    expect(resolveSgsScoreCell(record)).toMatchObject({ origin: 'auto', effectiveScore: 0 })
  })

  it('override 0 on top of a calculated 7.5 wins (0 is never treated as "no override")', () => {
    expect(computeEffectiveSgsScore(0, false, 7.5)).toBe(0)
  })

  it('typing "0" into an empty cell is an override of 0, never a no-op', () => {
    expect(interpretSgsScoreCellInput(resolveSgsScoreCell(undefined), 0)).toEqual({ kind: 'override', value: 0 })
  })

  it('SGS send plan sends a 0 (only null is skipped)', () => {
    const rows = buildSgsScoreWorkspaceRows([{ id: 's1', number: 1, studentCode: 'S1', firstName: 'A', lastName: 'B' }], [{ id: 'c' }], { c: { s1: 0 } })
    expect(computeSgsScoreWorkspaceSendPlan(rows, 'c', 10)[0].action).toBe('send')
  })
})

describe('8. NULL remains missing', () => {
  it('a student with no row resolves to EMPTY with effective null', () => {
    expect(resolveSgsScoreCell(undefined)).toMatchObject({ origin: 'empty', effectiveScore: null, overrideScore: null, calculatedScore: null })
  })

  it('not calculable -> calculated null; an AUTO cell becomes EMPTY (never keeps a stale value, never 0)', () => {
    const auto = recalc(undefined, { a4: 8, a5: 7 })!
    const exclude: SgsScoreCalculationFormula = { ...FORMULA, missingScorePolicy: 'exclude' }
    const notCalculable = calculateStudentSgsScore(exclude, {}, SOURCES)
    expect(notCalculable.status).toBe('blocked')
    const after = applySgsScoreRecalculation(auto, { calculatedScore: null }, NOW)!
    expect(after).toMatchObject({ score: null, calculatedScore: null })
  })

  it('a not-calculable student with no row gets no row at all', () => {
    expect(applySgsScoreRecalculation(undefined, { calculatedScore: null }, NOW)).toBeUndefined()
  })

  it('blank input on an EMPTY cell is a no-op (never writes 0)', () => {
    expect(interpretSgsScoreCellInput(resolveSgsScoreCell(undefined), null)).toEqual({ kind: 'noop' })
  })
})

// ==================================================
// 9-11. Source mapping changes / different max scores
// ==================================================

describe('9. source assignment removed', () => {
  it('the mapping reports the source as deleted/archived instead of silently dropping it', () => {
    const described = describeFormulaSources(FORMULA, [{ assignmentId: 'a4', label: 'ใบงานที่ 4', maxScore: 10, isArchived: true }])
    expect(described.map((d) => d.status)).toEqual(['archived', 'missing'])
    expect(described[1].label).toBe('งานที่ถูกลบไปแล้ว')
  })

  it('the saved formula can no longer run as-is -> no live value (never a guessed recalculation)', () => {
    expect(computeLiveCalculatedScores(FORMULA, 10, ['s1'], { s1: { a4: 5 } }, [SOURCES[0]])).toBeNull()
  })

  it('a removed source is left out of the per-student breakdown', () => {
    const rows = explainStudentCalculation(FORMULA, { a4: 5 }, [SOURCES[0]])
    expect(rows.map((r) => r.assignmentId)).toEqual(['a4'])
  })
})

describe('10. source assignment added', () => {
  it('the linked-source count follows the formula, and the new calculation is flagged as drift until recalculated', () => {
    const quiz: SgsScoreCalculationSource = { assignmentId: 'q2', label: 'Quiz 2', maxScore: 10 }
    const withQuiz: SgsScoreCalculationFormula = { ...FORMULA, sourceAssignmentIds: ['a4', 'a5', 'q2'] }
    expect(listFormulaSourceIds(withQuiz)).toHaveLength(3)

    const persisted = resolveSgsScoreCell(recalc(undefined, { a4: 8, a5: 7 }))
    const live = computeLiveCalculatedScores(withQuiz, 10, ['s1'], { s1: { a4: 8, a5: 7, q2: 10 } }, [...SOURCES, quiz])!
    expect(live.s1).toBe(8.3)
    expect(hasSgsCalculationDrift(persisted, live.s1)).toBe(true)
    expect(hasSgsCalculationDrift(persisted, 7.5)).toBe(false)
  })

  it('drift is never claimed for a cell that has never been calculated, or when no live value is available', () => {
    expect(hasSgsCalculationDrift(resolveSgsScoreCell(applySgsScoreCellAction(undefined, 'override', 3)), 7)).toBe(false)
    expect(hasSgsCalculationDrift(resolveSgsScoreCell(recalc(undefined, { a4: 8, a5: 7 })), undefined)).toBe(false)
  })
})

describe('11. different assignment maximum scores', () => {
  it('10-point and 20-point sources are summed by points, and contributions add up to the calculated score', () => {
    const sources: SgsScoreCalculationSource[] = [
      { assignmentId: 'x', label: 'x', maxScore: 10 },
      { assignmentId: 'y', label: 'y', maxScore: 20 },
    ]
    const formula: SgsScoreCalculationFormula = { ...FORMULA, rounding: 'none', sourceAssignmentIds: ['x', 'y'] }
    const result = calculateStudentSgsScore(formula, { x: 10, y: 5 }, sources)
    expect(result).toMatchObject({ status: 'ok', calculatedScore: 5 }) // 15/30 * 10
    const contributions = explainStudentCalculation(formula, { x: 10, y: 5 }, sources)
    expect(contributions.reduce((sum, c) => sum + (c.contribution ?? 0), 0)).toBeCloseTo(5)
    expect(contributions.find((c) => c.assignmentId === 'x')!.contribution).toBeCloseTo(10 / 3)
  })

  it('weighted groups: per-source contributions follow each group weight', () => {
    const formula: SgsScoreCalculationFormula = {
      ...FORMULA,
      rounding: 'none',
      mode: 'weighted_groups',
      groups: [
        { id: 'g1', label: 'งาน', weightPercent: 40, sourceAssignmentIds: ['a4'] },
        { id: 'g2', label: 'สอบ', weightPercent: 60, sourceAssignmentIds: ['a5'] },
      ],
    }
    const contributions = explainStudentCalculation(formula, { a4: 10, a5: 5 }, SOURCES)
    expect(contributions.map((c) => c.contribution)).toEqual([4, 3])
    expect(describeFormulaSources(formula, SOURCES.map((s) => ({ ...s, isArchived: false })))[1]).toMatchObject({ groupLabel: 'สอบ', weightPercent: 60 })
  })

  it('a missing source under "exclude" contributes nothing and shows no raw score (never 0)', () => {
    const formula: SgsScoreCalculationFormula = { ...FORMULA, missingScorePolicy: 'exclude' }
    const rows = explainStudentCalculation(formula, { a4: 8 }, SOURCES)
    expect(rows.find((r) => r.assignmentId === 'a5')).toMatchObject({ rawScore: null, contribution: null })
  })
})

// ==================================================
// 12-13. Bulk: recalculate column / clear column overrides
// ==================================================

describe('12. recalculation of a full column', () => {
  const roster = [
    { studentId: 'auto', studentNumber: 1, fullName: 'A' },
    { studentId: 'over', studentNumber: 2, fullName: 'B' },
    { studentId: 'none', studentNumber: 3, fullName: 'C' },
  ]
  const scores = { auto: { a4: 10, a5: 9 }, over: { a4: 4, a5: 4 }, none: {} }
  const exclude: SgsScoreCalculationFormula = { ...FORMULA, missingScorePolicy: 'exclude' }

  it('AUTO cells update, OVERRIDE cells keep their value (calculated still refreshed), not-calculable AUTO cells empty', () => {
    const records: Record<string, SgsScoreCellRecord> = {
      auto: recalc(undefined, { a4: 1, a5: 1 })!,
      over: applySgsScoreCellAction(recalc(undefined, { a4: 1, a5: 1 }), 'override', 9)!,
      none: recalc(undefined, { a4: 5, a5: 5 })!,
    }
    const preview = calculateClassPreview(exclude, roster, scores, SOURCES)
    const plan = planSgsScoreCalculationApply(preview, { over: 9 }, false)
    const values = buildRecalculationValuesFromPlan(plan)
    const after = Object.fromEntries(values.map((v) => [v.studentId, applySgsScoreRecalculation(records[v.studentId], v, NOW)!]))

    expect(after.auto).toMatchObject({ score: 9.5, calculatedScore: 9.5, overrideScore: null })
    expect(after.over).toMatchObject({ score: 9, calculatedScore: 4, overrideScore: 9 })
    expect(after.none).toMatchObject({ score: null, calculatedScore: null })
  })

  it('confirmed "เขียนทับคะแนนเดิม" clears the override and suppression of the rows it writes', () => {
    const preview = calculateClassPreview(FORMULA, roster.slice(0, 2), scores, SOURCES)
    const values = buildRecalculationValuesFromPlan(planSgsScoreCalculationApply(preview, { over: 9 }, true))
    expect(values.find((v) => v.studentId === 'over')).toEqual({ studentId: 'over', calculatedScore: 4, clearOverride: true })
  })

  it('a suppressed student is protected exactly like an existing value unless overwrite is confirmed', () => {
    const preview = calculateClassPreview(FORMULA, roster.slice(0, 1), scores, SOURCES)
    expect(planSgsScoreCalculationApply(preview, {}, false, new Set(['auto']))[0].action).toBe('skip_existing')
    expect(planSgsScoreCalculationApply(preview, {}, true, new Set(['auto']))[0].action).toBe('write')
  })

  it('the whole column goes in ONE all-or-nothing call; a failure is reported for every planned write (never partial success)', async () => {
    const preview = calculateClassPreview(FORMULA, roster.slice(0, 2), scores, SOURCES)
    const plan = planSgsScoreCalculationApply(preview, {}, false)
    const calls: unknown[] = []
    const ok = await applySgsScoreCalculationWithOrigin('col-10', plan, async (columnId, values) => {
      calls.push({ columnId, values })
      return values.length
    })
    expect(calls).toHaveLength(1)
    expect(ok).toEqual({ written: 2, failed: [] })

    const failed = await applySgsScoreCalculationWithOrigin('col-10', plan, async () => {
      throw new Error('boom')
    })
    expect(failed.written).toBe(0)
    expect(failed.failed.map((f) => f.studentId)).toEqual(['auto', 'over'])
  })

  it('a failed transaction with only calculated-value refreshes (no writes) is still a failure, not a silent success', async () => {
    const preview = calculateClassPreview(FORMULA, roster.slice(0, 1), scores, SOURCES)
    const plan = planSgsScoreCalculationApply(preview, { auto: 3 }, false)
    expect(plan[0].action).toBe('skip_existing')
    const result = await applySgsScoreCalculationWithOrigin('col-10', plan, async () => {
      throw new Error('boom')
    })
    expect(result.failed.length).toBeGreaterThan(0)
  })

  it('RPC payload keeps 0 as 0 and null as JSON null', () => {
    expect(buildSgsRecalculationPayload([{ studentId: 'a', calculatedScore: 0 }, { studentId: 'b', calculatedScore: null, clearOverride: true }])).toEqual([
      { student_id: 'a', calculated_score: 0, clear_override: false },
      { student_id: 'b', calculated_score: null, clear_override: true },
    ])
  })
})

describe('13. clearing manual overrides for an entire column', () => {
  it('overrides and suppressions revert to the calculated value; the count matches the confirmation impact', () => {
    const records: Record<string, SgsScoreCellRecord> = {
      o: applySgsScoreCellAction(recalc(undefined, { a4: 6, a5: 6 }), 'override', 9)!,
      s: applySgsScoreCellAction(recalc(undefined, { a4: 8, a5: 8 }), 'suppress_auto')!,
      a: recalc(undefined, { a4: 5, a5: 5 })!,
      m: applySgsScoreCellAction(undefined, 'override', 2)!,
    }
    const cells = Object.fromEntries(Object.entries(records).map(([k, r]) => [k, resolveSgsScoreCell(r)]))
    const impact = computeSgsScoreColumnResetImpact(cells)
    expect(impact).toEqual({ overrides: 2, suppressed: 1, becomeEmpty: 1 })

    const { records: after, changed } = applySgsScoreColumnReset(records)
    expect(changed).toBe(impact.overrides + impact.suppressed)
    expect(after.o.score).toBe(6)
    expect(after.s.score).toBe(8)
    expect(after.a).toBe(records.a)
    expect(after.m.score).toBeNull() // no calculated value -> becomes EMPTY, exactly as the confirmation said
  })

  it('UI: the bulk reset is only reachable through a ConfirmDialog that states the affected count', () => {
    const modal = readSource('../features/subjects-real/score-calculation-modal.tsx')
    expect(modal).toContain('onClick={() => setConfirmResetOpen(true)}')
    const confirm = modal.slice(modal.indexOf('open={confirmResetOpen}'), modal.indexOf('onConfirm={doResetToAuto}'))
    expect(confirm).toContain('resetImpact.overrides')
    expect(confirm).toContain('resetImpact.suppressed')
    expect(confirm).toContain('confirmLabel={`ยืนยัน (${resetCount} คน)`}')
    expect(confirm).toContain('destructive')
    // doResetToAuto is never called directly from a button.
    expect(modal.match(/doResetToAuto/g)).toHaveLength(2) // definition + onConfirm
  })
})

// ==================================================
// 14-16. Consumers: SGS export and Student Analytics
// ==================================================

describe('14. SGS consumes effectiveScore', () => {
  const roster = [
    { id: 'auto', number: 1, studentCode: 'S1', firstName: 'Auto', lastName: 'A' },
    { id: 'over', number: 2, studentCode: 'S2', firstName: 'Over', lastName: 'O' },
    { id: 'empty', number: 3, studentCode: 'S3', firstName: 'Empty', lastName: 'E' },
  ]
  const cells = {
    auto: resolveSgsScoreCell({ score: 8.5, calculatedScore: 8.5, overrideScore: null, autoSuppressed: false, calculatedAt: NOW }),
    over: resolveSgsScoreCell({ score: 9, calculatedScore: 8.5, overrideScore: 9, autoSuppressed: false, calculatedAt: NOW }),
    empty: resolveSgsScoreCell(undefined),
  }
  const rows = buildSgsScoreWorkspaceRows(roster, [{ id: 'col' }], { col: effectiveScoresFromCells(cells) })

  it('AUTO sends 8.5, OVERRIDE sends 9 (not the calculated 8.5), EMPTY is skipped', () => {
    const plan = computeSgsScoreWorkspaceSendPlan(rows, 'col', 10)
    expect(plan.map((r) => [r.studentId, r.score, r.action])).toEqual([
      ['auto', 8.5, 'send'],
      ['over', 9, 'send'],
      ['empty', null, 'skip_no_score'],
    ])
    const payload = buildSgsScoreWorkspacePayload(
      { subjectId: 's', subjectName: 'n', classroomId: 'c', classroomName: 'r', targetColumn: { key: 'col', label: 'ช่อง 10', maxScore: 10 } },
      plan,
    )
    expect(payload.students.map((s) => s.score)).toEqual([8.5, 9])
  })

  it('the multi-column payload carries the effective score and an explicit null for EMPTY', () => {
    const payload = buildSgsScoreWorkspaceMultiPayload(
      { subjectId: 's', subjectName: 'n', classroomId: 'c', classroomName: 'r', columns: [{ key: 'col', label: 'ช่อง 10', maxScore: 10 }] },
      rows,
    )
    expect(payload.students.map((s) => s.scoresByColumnKey.col)).toEqual([8.5, 9, null])
  })

  it('the tab builds every export row from the effective scores (never from calculated/override directly)', () => {
    const tab = readSource('../features/subjects-real/tabs/sgs-scores-tab.tsx')
    expect(tab).toContain('effectiveScoresFromCells(cells)')
    expect(tab).toContain('buildSgsScoreWorkspaceRows(students, columns, scoresByColumnId)')
  })

  it('the SGS Bridge extension and payload builders are untouched by this change (no origin concepts leak into them)', () => {
    const workspace = readSource('./sgs-score-workspace-service.ts')
    const builders = workspace.slice(workspace.indexOf('export function buildSgsScoreWorkspaceRows'))
    expect(builders).not.toContain('overrideScore')
    expect(builders).not.toContain('calculatedScore')
  })
})

describe('15. Student Analytics consumes the effective score', () => {
  it('Analytics never reads SGS columns at all — its scores are assignment_submissions.score, which has no override layer, so there is no stale calculated value it could pick up', () => {
    const analytics = readSource('./student-analytics-service.ts')
    expect(analytics).not.toMatch(/from '@\/services\/sgs-/)
    expect(analytics).not.toContain("from('sgs_scores')")
    expect(analytics).toContain('getSubmissionsForAssignments')
  })
})

describe('16. a missing score is not converted to zero', () => {
  it('a DB row with NULL columns maps to null, never 0 — including string-encoded numerics', () => {
    expect(mapSgsScoreCellRow({ column_id: 'c', student_id: 's', score: null, calculated_score: null, override_score: null })).toMatchObject({
      score: null,
      calculatedScore: null,
      overrideScore: null,
    })
    expect(mapSgsScoreCellRow({ column_id: 'c', student_id: 's', score: '0' as unknown as number, override_score: '0' as unknown as number }).score).toBe(0)
  })

  it('no source files anywhere in the origin model use truthiness for score existence', () => {
    for (const file of ['./sgs-score-origin.ts', '../features/subjects-real/sgs-score-cell.tsx', '../features/subjects-real/sgs-score-cell-dialog.tsx']) {
      const source = readSource(file)
      expect(source).not.toMatch(/if \(!(score|value|overrideScore|calculatedScore|effectiveScore)\)/)
      expect(source).not.toMatch(/\|\| 0\b/)
    }
  })
})

// ==================================================
// 17-18. Legacy compatibility and persistence round trip
// ==================================================

describe('17. existing legacy scores remain compatible', () => {
  it('a pre-0027 value (score only) resolves to OVERRIDE — the teacher owns it, recalculation never overwrites it', () => {
    const legacy = mapSgsScoreCellRow({ column_id: 'c', student_id: 's', score: 7 })
    expect(resolveSgsScoreCell(legacy)).toMatchObject({ origin: 'override', effectiveScore: 7 })
    expect(recalc(legacy, { a4: 10, a5: 10 })).toMatchObject({ score: 7, overrideScore: 7, calculatedScore: 10 })
  })

  it('a legacy 0 stays 0 and a legacy NULL stays EMPTY', () => {
    expect(resolveSgsScoreCell(mapSgsScoreCellRow({ column_id: 'c', student_id: 's', score: 0 }))).toMatchObject({ origin: 'override', effectiveScore: 0 })
    expect(resolveSgsScoreCell(mapSgsScoreCellRow({ column_id: 'c', student_id: 's', score: null }))).toMatchObject({ origin: 'empty', effectiveScore: null })
  })

  it('a direct write of `score` by an older client after 0027 is adopted (value -> override, clear -> suppressed), mirroring sgs_score_reconcile_legacy', () => {
    const auto = recalc(undefined, { a4: 8, a5: 7 })!
    expect(resolveSgsScoreCell({ ...auto, score: 3 })).toMatchObject({ origin: 'override', effectiveScore: 3, calculatedScore: 7.5 })
    expect(resolveSgsScoreCell({ ...auto, score: null })).toMatchObject({ origin: 'empty', autoSuppressed: true })
  })

  it('before 0027 is applied the workspace falls back to the plain select and every action uses the original setSgsScore', () => {
    const workspace = readSource('./sgs-score-workspace-service.ts')
    const loader = workspace.slice(workspace.indexOf('export async function getSgsScoreCellsForColumns'), workspace.indexOf('async function probeSgsScoreOriginSupport'))
    expect(loader).toContain('SGS_SCORE_CELL_SELECT_WITH_ORIGIN')
    expect(loader.indexOf('SGS_SCORE_CELL_SELECT_LEGACY')).toBeGreaterThan(loader.indexOf('if (!withOrigin.error)'))
    expect(loader).toContain('supportsScoreOrigin: false')

    const tab = readSource('../features/subjects-real/tabs/sgs-scores-tab.tsx')
    const perform = tab.slice(tab.indexOf('async function performCellAction'), tab.indexOf('const [detailCell'))
    expect(perform.indexOf('if (!supportsScoreOrigin)')).toBeLessThan(perform.indexOf('setSgsScoreCell('))
    expect(perform).toContain('await setSgsScore(column.id, studentId, score)')

    const modal = readSource('../features/subjects-real/score-calculation-modal.tsx')
    expect(modal).toContain(': await applySgsScoreCalculation(targetColumn.id, plan)')
  })

  it('without 0027 a cell still offers an explicit "ล้างคะแนน" (the old "cannot clear" gap)', () => {
    const cell = resolveSgsScoreCell(mapSgsScoreCellRow({ column_id: 'c', student_id: 's', score: 5 }))
    expect(getSgsScoreCellMenuActions(cell, true, false)).toEqual(['edit', 'clear'])
  })
})

describe('18. persistence / reload preserves state', () => {
  function roundTrip(record: SgsScoreCellRecord): SgsScoreCellRecord {
    // What the database stores and returns for this row.
    return mapSgsScoreCellRow({
      column_id: 'c',
      student_id: 's',
      score: record.score,
      calculated_score: record.calculatedScore,
      override_score: record.overrideScore,
      auto_suppressed: record.autoSuppressed,
      calculated_at: record.calculatedAt,
    })
  }

  it('every state survives a write -> reload cycle unchanged', () => {
    const states: SgsScoreCellRecord[] = [
      recalc(undefined, { a4: 8, a5: 7 })!,
      applySgsScoreCellAction(recalc(undefined, { a4: 8, a5: 7 }), 'override', 9)!,
      applySgsScoreCellAction(recalc(undefined, { a4: 8, a5: 7 }), 'suppress_auto')!,
      applySgsScoreCellAction(undefined, 'override', 0)!,
      recalc(undefined, { a4: 0, a5: 0 })!,
    ]
    for (const state of states) {
      expect(resolveSgsScoreCell(roundTrip(state))).toEqual(resolveSgsScoreCell(state))
    }
  })

  it('the persisted `score` column always equals the resolved effective score', () => {
    const record = applySgsScoreCellAction(recalc(undefined, { a4: 9, a5: 8 }), 'override', 2)!
    expect(record.score).toBe(resolveSgsScoreCell(record).effectiveScore)
  })
})

// ==================================================
// UI: indicators, tooltips, actions, table loading
// ==================================================

describe('UI — cell origin indicators and actions', () => {
  it('tooltips use the exact required wording', () => {
    expect(SGS_SCORE_ORIGIN_TOOLTIP).toEqual({ auto: 'คำนวณจากงานที่เชื่อม', override: 'ครูกำหนดคะแนนเอง' })
  })

  it('AUTO/OVERRIDE icons carry an accessible label AND a native tooltip, and only render for a mapped column', () => {
    const cell = readSource('../features/subjects-real/sgs-score-cell.tsx')
    expect(cell).toContain("hasFormula && cell.origin === 'auto'")
    expect(cell).toContain('aria-label={SGS_SCORE_ORIGIN_TOOLTIP.auto}')
    expect(cell).toContain('<title>{SGS_SCORE_ORIGIN_TOOLTIP.auto}</title>')
    expect(cell).toContain("hasFormula && cell.origin === 'override'")
    expect(cell).toContain('aria-label={SGS_SCORE_ORIGIN_TOOLTIP.override}')
    expect(cell).toContain('<title>{SGS_SCORE_ORIGIN_TOOLTIP.override}</title>')
  })

  it('the column header shows the linked-source count; the calculator also lists the sources', () => {
    const tab = readSource('../features/subjects-real/tabs/sgs-scores-tab.tsx')
    expect(tab).toContain("listFormulaSourceIds(formulasByColumnId[column.id]!).length} งาน · ${supportsScoreOrigin ? 'Auto' : 'มีสูตร'}")
    const modal = readSource('../features/subjects-real/score-calculation-modal.tsx')
    expect(modal).toContain('งานที่เชื่อมกับช่องนี้')
    expect(modal).toContain('describeFormulaSources(existingFormula, assignmentsMeta)')
  })

  it('menu actions offered per state (with a mapping, 0027 applied)', () => {
    const auto = resolveSgsScoreCell(recalc(undefined, { a4: 8, a5: 7 }))
    const over = resolveSgsScoreCell(applySgsScoreCellAction(recalc(undefined, { a4: 8, a5: 7 }), 'override', 9))
    const overNoCalc = resolveSgsScoreCell(applySgsScoreCellAction(undefined, 'override', 9))
    const suppressed = resolveSgsScoreCell(applySgsScoreCellAction(recalc(undefined, { a4: 8, a5: 7 }), 'suppress_auto'))
    expect(getSgsScoreCellMenuActions(auto, true, true)).toEqual(['recalculate', 'override', 'suppress_auto'])
    expect(getSgsScoreCellMenuActions(over, true, true)).toEqual(['recalculate', 'edit', 'restore_auto', 'suppress_auto'])
    expect(getSgsScoreCellMenuActions(overNoCalc, true, true)).toEqual(['recalculate', 'edit', 'clear', 'suppress_auto'])
    expect(getSgsScoreCellMenuActions(suppressed, true, true)).toEqual(['recalculate', 'override', 'restore_auto'])
    expect(getSgsScoreCellMenuActions(over, false, true)).toEqual(['edit', 'clear'])
  })

  it('action labels are the required Thai wording', () => {
    expect(SGS_SCORE_CELL_MENU_LABEL).toEqual({
      edit: 'แก้คะแนน',
      recalculate: 'คำนวณใหม่จากงานต้นทาง',
      override: 'กรอกคะแนนทับ',
      restore_auto: 'กลับไปใช้คะแนนคำนวณ',
      clear: 'ล้างคะแนน',
      suppress_auto: 'ยกเลิกการคำนวณสำหรับนักเรียนคนนี้',
    })
  })

  it('re-entering the current value (blur without change) never turns an AUTO cell into an override', () => {
    const auto = resolveSgsScoreCell(recalc(undefined, { a4: 8, a5: 7 }))
    expect(interpretSgsScoreCellInput(auto, 7.5)).toEqual({ kind: 'noop' })
    expect(interpretSgsScoreCellInput(auto, 8)).toEqual({ kind: 'override', value: 8 })
  })

  it('the table loads every column\'s cells in ONE request (no per-column/per-cell queries)', () => {
    const tab = readSource('../features/subjects-real/tabs/sgs-scores-tab.tsx')
    const refresh = tab.slice(tab.indexOf('const refresh = useCallback'), tab.indexOf('const refreshFormulas = useCallback'))
    expect(refresh).toContain('getSgsScoreCellsForColumns(columnRows.map((c) => c.id))')
    expect(refresh).not.toContain('getSgsScores(')
    const workspace = readSource('./sgs-score-workspace-service.ts')
    expect(workspace).toContain(".in('column_id', columnIds)")
  })

  it('writes to one cell are serialized, so rapid edits land in order', () => {
    const tab = readSource('../features/subjects-real/tabs/sgs-scores-tab.tsx')
    expect(tab).toContain('function enqueueCellWrite')
    const perform = tab.slice(tab.indexOf('async function performCellAction'), tab.indexOf('const [detailCell'))
    expect(perform).toContain('await enqueueCellWrite(cellKey, async () => {')
  })

  it('per-cell "คำนวณใหม่จากงานต้นทาง" uses FRESH source scores, never the ones loaded when the tab opened', () => {
    const tab = readSource('../features/subjects-real/tabs/sgs-scores-tab.tsx')
    const recalcBranch = tab.slice(tab.indexOf("if (action === 'recalculate') {"), tab.indexOf('const record = await setSgsScoreCell('))
    expect(recalcBranch.indexOf('await getSgsScoreCalculationSources(subjectId, classroomId)')).toBeLessThan(recalcBranch.indexOf('recalculateSgsScoreColumn('))
  })
})

describe('migration 0027 — SQL mirrors the TypeScript rules', () => {
  const sql = readSource('../../supabase/migrations/0027_sgs_score_origin.sql')

  it('is additive: only ADD COLUMN on sgs_scores, never a drop/alter of an existing column', () => {
    expect(sql).toContain('add column if not exists calculated_score numeric')
    expect(sql).toContain('add column if not exists override_score numeric')
    expect(sql).toContain('add column if not exists auto_suppressed boolean not null default false')
    // Ignore comments — the documented rollback steps legitimately mention
    // DROP COLUMN; the executable SQL must not.
    const executable = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
    expect(executable).not.toMatch(/drop column|alter column|drop table/i)
  })

  it('the backfill copies existing non-null scores into override_score and never touches `score` or NULL rows', () => {
    const backfill = sql.slice(sql.indexOf('update public.sgs_scores\nset override_score = score'), sql.indexOf('-- Pure helpers'))
    expect(backfill).toContain('where score is not null')
    expect(backfill).toContain('and calculated_score is null')
    expect(backfill).not.toMatch(/set score\b/)
  })

  it('the effective score is computed in the database from override/suppression/calculated — never sent by the client', () => {
    expect(sql).toContain('when p_override is not null then p_override')
    expect(sql).toContain('score = public.sgs_score_effective(v_override, v_suppressed, v_calc)')
    expect(sql).toContain('score = public.sgs_score_effective(v_override, v_suppressed, v_row.calculated_score)')
  })

  it('every RPC is SECURITY INVOKER (RLS applies) and executable only by authenticated users', () => {
    expect(sql.match(/security invoker/g)).toHaveLength(3)
    expect(sql).not.toMatch(/security definer/i)
    for (const fn of ['set_sgs_score_cell(uuid, uuid, text, numeric)', 'recalculate_sgs_score_column(uuid, jsonb)', 'reset_sgs_score_column_to_auto(uuid)']) {
      expect(sql).toContain(`revoke all on function public.${fn} from public;`)
      // Supabase's default privileges grant new functions to anon directly
      // — `from public` alone does not remove that (see 0010/0022).
      expect(sql).toContain(`revoke all on function public.${fn} from anon;`)
      expect(sql).toContain(`grant execute on function public.${fn} to authenticated;`)
      expect(sql).not.toContain(`grant execute on function public.${fn} to anon`)
    }
  })

  it('recalculation locks the column row first (no interleaved double recalculation)', () => {
    const fn = sql.slice(sql.indexOf('create or replace function public.recalculate_sgs_score_column'), sql.indexOf('revoke all on function public.recalculate_sgs_score_column'))
    expect(fn).toContain('from public.sgs_score_columns c where c.id = p_column_id for update')
  })
})
