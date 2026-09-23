import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  afterSourceScoresSaved,
  convertSgsScoreColumnToAuto,
  countSgsOverrideCells,
  createSgsAutoRecalculationScheduler,
  describeSgsAutoRecalculationResult,
  describeSgsConvertToAutoConfirmation,
  planSgsAutoRecalculationValues,
  planSgsColumnConvertToAuto,
  recalculateSgsCellFromSources,
  recalculateSgsColumnsForAssignments,
  selectSgsColumnsAffectedByAssignments,
  type SgsAutoDeps,
  type SgsAutoRecalculationResult,
} from './sgs-score-auto-service'
import { buildStudentSourceScoreRows, describeFormulaRule, describeFormulaSources, type SgsScoreCalculationAssignmentMeta } from './sgs-score-calculation-service'
import { applySgsScoreCellAction, applySgsScoreRecalculation, getSgsScoreCellMenuActions, resolveSgsScoreCell } from './sgs-score-origin'
import type { SgsScoreCalculationFormula } from '@/types/sgs-score-calculation'
import type { SgsScoreCellRecord, SgsScoreColumn, SgsScoreRecalculationValue } from '@/types/sgs-score-workspace'

const here = dirname(fileURLToPath(import.meta.url))
function readSource(relativePath: string): string {
  return readFileSync(resolve(here, relativePath), 'utf8')
}

const NOW = '2026-09-23T10:00:00.000Z'

// ==================================================
// An in-memory database: assignments + submissions + sgs columns/cells.
// deps.recalculate applies applySgsScoreRecalculation — the TypeScript
// mirror of recalculate_sgs_score_column (0027) — so every test sees
// exactly what the RPC would persist.
// ==================================================

function column(id: string, label: string, maxScore: number): SgsScoreColumn {
  return { id, subjectId: 'sub', classroomId: 'room', label, maxScore, position: 0, calculationFormula: null, createdAt: NOW, updatedAt: NOW }
}

function proportional(columnId: string, targetMaxScore: number, ids: string[]): SgsScoreCalculationFormula {
  return {
    mode: 'proportional',
    targetColumnId: columnId,
    targetMaxScore,
    missingScorePolicy: 'treat_as_zero',
    rounding: 'one_decimal',
    sourceAssignmentIds: ids,
  }
}

interface FakeDb {
  assignments: SgsScoreCalculationAssignmentMeta[]
  /** assignmentId -> studentId -> score */
  submissions: Record<string, Record<string, number | null>>
  columns: SgsScoreColumn[]
  formulas: Record<string, SgsScoreCalculationFormula | null>
  cells: Record<string, Record<string, SgsScoreCellRecord>>
  students: string[]
  supportsScoreOrigin: boolean
  formulasFail: boolean
  recalcFailFor: Set<string>
  calls: { getColumns: number; getFormulas: number; getSources: number; getStudents: number; getCells: string[][]; recalculate: { columnId: string; values: SgsScoreRecalculationValue[] }[] }
}

function makeDb(): FakeDb {
  return {
    // "งานที่ 1 วันคืออะไร" (เต็ม 5) feeds "ช่อง 1" (เต็ม 10) — the live case.
    assignments: [
      { assignmentId: 'a1', label: 'งานที่ 1 วันคืออะไร', maxScore: 5, isArchived: false },
      { assignmentId: 'a2', label: 'งานที่ 2 เดือนและปี', maxScore: 10, isArchived: false },
      { assignmentId: 'a3', label: 'สอบย่อย', maxScore: 20, isArchived: false },
    ],
    submissions: { a1: { s1: 5, s2: 5, s3: 4 }, a2: { s1: 10, s2: 8, s3: 6 }, a3: { s1: 20, s2: 10, s3: 15 } },
    columns: [column('c1', 'ช่อง 1', 10), column('c2', 'ช่อง 2', 10), column('c3', 'ช่อง 3', 20)],
    formulas: {
      c1: proportional('c1', 10, ['a1']),
      c2: proportional('c2', 10, ['a2']),
      c3: null, // manual column — never touched automatically
    },
    cells: { c1: {}, c2: {}, c3: {} },
    students: ['s1', 's2', 's3'],
    supportsScoreOrigin: true,
    formulasFail: false,
    recalcFailFor: new Set(),
    calls: { getColumns: 0, getFormulas: 0, getSources: 0, getStudents: 0, getCells: [], recalculate: [] },
  }
}

function depsFor(db: FakeDb): SgsAutoDeps {
  return {
    async getColumns() {
      db.calls.getColumns += 1
      return db.columns
    },
    async getFormulas() {
      db.calls.getFormulas += 1
      if (db.formulasFail) throw new Error('column sgs_score_columns.calculation_formula does not exist')
      return db.formulas
    },
    async getSources() {
      db.calls.getSources += 1
      const active = db.assignments.filter((a) => !a.isArchived)
      const scoresByStudentIdAndAssignmentId: Record<string, Record<string, number | null>> = {}
      for (const a of active) {
        for (const [studentId, score] of Object.entries(db.submissions[a.assignmentId] ?? {})) {
          ;(scoresByStudentIdAndAssignmentId[studentId] ??= {})[a.assignmentId] = score
        }
      }
      return {
        sources: active.map((a) => ({ assignmentId: a.assignmentId, label: a.label, maxScore: a.maxScore })),
        assignments: db.assignments,
        scoresByStudentIdAndAssignmentId,
      }
    },
    async getStudents() {
      db.calls.getStudents += 1
      return db.students.map((id) => ({ id }))
    },
    async getCells(columnIds) {
      db.calls.getCells.push(columnIds)
      const cellsByColumnId: Record<string, Record<string, SgsScoreCellRecord>> = {}
      for (const id of columnIds) cellsByColumnId[id] = { ...(db.cells[id] ?? {}) }
      return { supportsScoreOrigin: db.supportsScoreOrigin, cellsByColumnId }
    },
    async recalculate(columnId, values) {
      db.calls.recalculate.push({ columnId, values })
      if (db.recalcFailFor.has(columnId)) throw new Error('permission denied')
      let count = 0
      for (const v of values) {
        const next = applySgsScoreRecalculation(db.cells[columnId][v.studentId], v, NOW)
        if (next) {
          db.cells[columnId][v.studentId] = next
          count += 1
        }
      }
      return count
    },
  }
}

/** Teacher edits a source score (the assignment_submissions write). */
function editSource(db: FakeDb, assignmentId: string, studentId: string, score: number | null) {
  db.submissions[assignmentId][studentId] = score
}

/** A cell exactly as the 0027 backfill left a legacy calculated value:
 * the old number becomes an OVERRIDE, calculated_score NULL. */
function legacyBackfilled(score: number): SgsScoreCellRecord {
  return { score, calculatedScore: null, overrideScore: score, autoSuppressed: false, calculatedAt: null }
}

function effective(db: FakeDb, columnId: string, studentId: string) {
  return resolveSgsScoreCell(db.cells[columnId][studentId])
}

// ==================================================
// 1. Column source visibility
// ==================================================

describe('1. column source visibility', () => {
  it('lists every linked assignment by name with its max score, weight and status', () => {
    const db = makeDb()
    const weighted: SgsScoreCalculationFormula = {
      mode: 'individual_weights',
      targetColumnId: 'c1',
      targetMaxScore: 10,
      missingScorePolicy: 'exclude',
      rounding: 'integer',
      weights: [
        { assignmentId: 'a1', weightPercent: 40 },
        { assignmentId: 'a3', weightPercent: 60 },
      ],
    }
    const rows = describeFormulaSources(weighted, db.assignments)
    expect(rows.map((r) => [r.label, r.maxScore, r.weightPercent, r.status])).toEqual([
      ['งานที่ 1 วันคืออะไร', 5, 40, 'active'],
      ['สอบย่อย', 20, 60, 'active'],
    ])
  })

  it('states the rule with the SGS column max (not just "คำนวณ")', () => {
    const db = makeDb()
    const formula = proportional('c1', 10, ['a1', 'a2'])
    expect(describeFormulaRule(formula, describeFormulaSources(formula, db.assignments), 10)).toBe('(คะแนนรวมที่ได้ ÷ 15) × 10')
  })

  it('UI: a mapped column header opens the sources dialog, which shows names, max scores, weights, method and the SGS column max', () => {
    const tab = readSource('../features/subjects-real/tabs/sgs-scores-tab.tsx')
    expect(tab).toContain('(formulasByColumnId[column.id] ? openSourcesDialog(column) : setCalcColumn(column))')
    expect(tab).toContain("listFormulaSourceIds(formulasByColumnId[column.id]!).length} งาน · ${supportsScoreOrigin ? 'Auto' : 'มีสูตร'}")
    expect(tab).toContain('describeFormulaSources(formulasByColumnId[sourcesColumn.id]!, sourceData.assignments)')
    const dialog = readSource('../features/subjects-real/sgs-column-sources-dialog.tsx')
    expect(dialog).toContain('{source.label}')
    expect(dialog).toContain('คะแนนเต็มงาน')
    expect(dialog).toContain('source.weightPercent')
    expect(dialog).toContain('SGS_SCORE_CALCULATION_MODE_LABEL[formula.mode]')
    expect(dialog).toContain('คะแนนเต็มช่อง SGS')
    expect(dialog).toContain('{column.maxScore}')
  })
})

// ==================================================
// 2. Cell source details
// ==================================================

describe('2. cell source details', () => {
  it('shows each source with THIS student\'s real score, e.g. "งานที่ 1 วันคืออะไร 0 / 5"', async () => {
    const db = makeDb()
    editSource(db, 'a1', 's1', 0)
    const { sources, assignments, scoresByStudentIdAndAssignmentId } = await depsFor(db).getSources('sub', 'room')
    const rows = buildStudentSourceScoreRows(db.formulas.c1!, assignments, scoresByStudentIdAndAssignmentId.s1, sources)
    expect(rows).toHaveLength(1)
    expect(`${rows[0].label} ${rows[0].rawScore} / ${rows[0].maxScore}`).toBe('งานที่ 1 วันคืออะไร 0 / 5')
    expect(rows[0].contribution).toBe(0)
  })

  it('a missing score is "no score" (null), never 0; an archived source is listed but not counted', async () => {
    const db = makeDb()
    delete db.submissions.a1.s1
    db.assignments[1] = { ...db.assignments[1], isArchived: true }
    const formula = proportional('c1', 10, ['a1', 'a2'])
    const { sources, assignments, scoresByStudentIdAndAssignmentId } = await depsFor(db).getSources('sub', 'room')
    const rows = buildStudentSourceScoreRows(formula, assignments, scoresByStudentIdAndAssignmentId.s1 ?? {}, sources)
    expect(rows.map((r) => [r.label, r.rawScore, r.status])).toEqual([
      ['งานที่ 1 วันคืออะไร', null, 'active'],
      ['งานที่ 2 เดือนและปี', null, 'archived'],
    ])
  })

  it('UI: the dialog shows งานที่ใช้คำนวณ, คะแนนคำนวณปัจจุบัน, คะแนนที่ครูกำหนด (override only) and คะแนนที่ใช้ส่ง SGS, each "/ max"', () => {
    const dialog = readSource('../features/subjects-real/sgs-score-cell-dialog.tsx')
    expect(dialog).toContain('<h3 className="text-sm font-semibold">งานที่ใช้คำนวณ</h3>')
    expect(dialog).toContain('{row.status === \'active\' ? formatScore(row.rawScore) : \'—\'} / {row.maxScore ?? \'—\'}')
    expect(dialog).toContain('คะแนนคำนวณปัจจุบัน')
    expect(dialog).toContain('{formatScore(currentCalculated)} / {maxScore}')
    const overrideStart = dialog.indexOf('{supportsOrigin && cell.overrideScore !== null && (')
    const overrideRow = dialog.slice(overrideStart, dialog.indexOf('คะแนนที่ใช้ส่ง SGS', overrideStart))
    expect(overrideRow).toContain('คะแนนที่ครูกำหนด')
    expect(dialog).toContain('{formatScore(cell.effectiveScore)} / {maxScore}')
    // Built from the real mapping + current source scores.
    const tab = readSource('../features/subjects-real/tabs/sgs-scores-tab.tsx')
    expect(tab).toContain('buildStudentSourceScoreRows(')
    expect(tab).toContain('sourceData.scoresByStudentIdAndAssignmentId[student.id] ?? {}')
  })
})

// ==================================================
// 3. Legacy override -> AUTO
// ==================================================

describe('3. legacy override → AUTO ("เปลี่ยนคอลัมน์นี้เป็นคำนวณอัตโนมัติ")', () => {
  it('confirmation text states the affected count', () => {
    expect(describeSgsConvertToAutoConfirmation(3)).toBe(
      'คะแนนที่ครูกำหนดเองของนักเรียน 3 คนจะถูกล้าง และระบบจะคำนวณคะแนนใหม่จากงานที่เชื่อมไว้',
    )
    const cells = { s1: resolveSgsScoreCell(legacyBackfilled(10)), s2: resolveSgsScoreCell(undefined) }
    expect(countSgsOverrideCells(cells)).toBe(1)
  })

  it('recalculates from CURRENT sources, clears the overrides, populates calculated_score; effective = calculated; 0 stays 0', async () => {
    const db = makeDb()
    db.cells.c1 = { s1: legacyBackfilled(10), s2: legacyBackfilled(10), s3: legacyBackfilled(8) }
    editSource(db, 'a1', 's1', 0) // live case: 5/5 -> 0/5

    const outcome = await convertSgsScoreColumnToAuto('sub', 'room', db.columns[0], db.formulas.c1!, {}, depsFor(db))

    expect(outcome.overridesCleared).toBe(3)
    expect(db.calls.recalculate).toHaveLength(1)
    expect(db.calls.recalculate[0].columnId).toBe('c1')
    expect(effective(db, 'c1', 's1')).toMatchObject({ origin: 'auto', effectiveScore: 0, calculatedScore: 0, overrideScore: null })
    expect(effective(db, 'c1', 's2')).toMatchObject({ origin: 'auto', effectiveScore: 10, calculatedScore: 10 })
    expect(effective(db, 'c1', 's3')).toMatchObject({ origin: 'auto', effectiveScore: 8 })
    expect(db.cells.c1.s1.calculatedAt).toBe(NOW)
  })

  it('missing data follows the formula: treat_as_zero -> 0, exclude with nothing usable -> EMPTY', async () => {
    const db = makeDb()
    db.cells.c1 = { s1: legacyBackfilled(10), s2: legacyBackfilled(10) }
    editSource(db, 'a1', 's1', null)
    await convertSgsScoreColumnToAuto('sub', 'room', db.columns[0], db.formulas.c1!, {}, depsFor(db))
    expect(effective(db, 'c1', 's1')).toMatchObject({ origin: 'auto', effectiveScore: 0 })

    const db2 = makeDb()
    db2.formulas.c1 = { ...proportional('c1', 10, ['a1']), missingScorePolicy: 'exclude' }
    db2.cells.c1 = { s1: legacyBackfilled(10) }
    editSource(db2, 'a1', 's1', null)
    const outcome = await convertSgsScoreColumnToAuto('sub', 'room', db2.columns[0], db2.formulas.c1!, {}, depsFor(db2))
    expect(outcome.becomeEmpty).toBe(1)
    expect(effective(db2, 'c1', 's1')).toMatchObject({ origin: 'empty', effectiveScore: null })
  })

  it('keeps a per-student "ยกเลิกการคำนวณ" and never touches another column', async () => {
    const db = makeDb()
    const suppressed = applySgsScoreCellAction(undefined, 'suppress_auto')!
    db.cells.c1 = { s1: legacyBackfilled(10), s2: suppressed }
    db.cells.c2 = { s1: legacyBackfilled(7) }
    const before = JSON.stringify(db.cells.c2)
    await convertSgsScoreColumnToAuto('sub', 'room', db.columns[0], db.formulas.c1!, {}, depsFor(db))
    expect(effective(db, 'c1', 's2')).toMatchObject({ origin: 'empty', autoSuppressed: true })
    expect(JSON.stringify(db.cells.c2)).toBe(before)
    expect(db.calls.getCells).toEqual([['c1']])
    expect(db.calls.recalculate.every((c) => c.columnId === 'c1')).toBe(true)
  })

  it('planner: override cells get clearOverride; AUTO cells only a refreshed calculated value; no row + nothing calculable is skipped', () => {
    const plan = planSgsColumnConvertToAuto(
      ['s1', 's2', 's3'],
      { s1: legacyBackfilled(10), s2: { score: 4, calculatedScore: 4, overrideScore: null, autoSuppressed: false, calculatedAt: NOW } },
      { s1: 0, s2: 6, s3: null },
    )
    expect(plan.values).toEqual([
      { studentId: 's1', calculatedScore: 0, clearOverride: true },
      { studentId: 's2', calculatedScore: 6, clearOverride: false },
    ])
    expect(plan.overridesCleared).toBe(1)
  })

  it('refuses (writes nothing) when the mapping cannot run as saved, or before 0027', async () => {
    const db = makeDb()
    db.cells.c1 = { s1: legacyBackfilled(10) }
    const mismatched = column('c1', 'ช่อง 1', 15) // column max changed since the formula was saved
    await expect(convertSgsScoreColumnToAuto('sub', 'room', mismatched, db.formulas.c1!, {}, depsFor(db))).rejects.toThrow('ตั้งค่าการคำนวณใหม่')
    db.supportsScoreOrigin = false
    await expect(convertSgsScoreColumnToAuto('sub', 'room', db.columns[0], db.formulas.c1!, {}, depsFor(db))).rejects.toThrow('0027')
    expect(db.calls.recalculate).toHaveLength(0)
  })

  it('UI: only reachable through a ConfirmDialog carrying the count', () => {
    const dialog = readSource('../features/subjects-real/sgs-column-sources-dialog.tsx')
    expect(dialog).toContain('เปลี่ยนคอลัมน์นี้เป็นคำนวณอัตโนมัติ')
    expect(dialog).toContain('onClick={() => setConfirmOpen(true)}')
    const confirm = dialog.slice(dialog.indexOf('<ConfirmDialog'))
    expect(confirm).toContain('describeSgsConvertToAutoConfirmation(counts.override)')
    expect(confirm).toContain('await onConvertToAuto()')
    expect(dialog.match(/onConvertToAuto\(\)/g)).toHaveLength(1)
  })
})

// ==================================================
// 4 + 5. Automatic recalculation after a source-score save
// ==================================================

describe('4/5. auto recalculation after a source score changes', () => {
  it('AUTO: 5/5 (10/10) -> 0/5 recalculates the SGS cell to 0 (zero stays zero)', async () => {
    const db = makeDb()
    db.cells.c1 = { s1: applySgsScoreRecalculation(undefined, { calculatedScore: 10 }, NOW)! }
    expect(effective(db, 'c1', 's1')).toMatchObject({ origin: 'auto', effectiveScore: 10 })

    editSource(db, 'a1', 's1', 0)
    const result = await recalculateSgsColumnsForAssignments('sub', 'room', ['a1'], depsFor(db))

    expect(result.status).toBe('done')
    expect(effective(db, 'c1', 's1')).toMatchObject({ origin: 'auto', effectiveScore: 0, calculatedScore: 0 })
    expect(db.cells.c1.s1.score).toBe(0)
  })

  it('OVERRIDE: the effective score stays the teacher value; calculated_score still updates underneath', async () => {
    const db = makeDb()
    db.cells.c1 = { s1: legacyBackfilled(10) }
    editSource(db, 'a1', 's1', 0)
    await recalculateSgsColumnsForAssignments('sub', 'room', ['a1'], depsFor(db))

    const cell = effective(db, 'c1', 's1')
    expect(cell).toMatchObject({ origin: 'override', effectiveScore: 10, overrideScore: 10, calculatedScore: 0 })
    const values = db.calls.recalculate[0].values
    expect(values).toContainEqual({ studentId: 's1', calculatedScore: 0 })
    expect(values.some((v) => v.clearOverride)).toBe(false) // never clears an override
    // Students with no row yet get an AUTO value (the column is calculated).
    expect(effective(db, 'c1', 's2')).toMatchObject({ origin: 'auto', effectiveScore: 10 })
    // The dialog now offers "กลับไปใช้คะแนนคำนวณ" (a calculated value exists).
    expect(getSgsScoreCellMenuActions(cell, true, true)).toContain('restore_auto')
  })

  it('restore AUTO uses the NEWEST calculated value — from fresh sources, even if the stored one is stale', async () => {
    const db = makeDb()
    // Stored calculated value is from before the source changed (10).
    db.cells.c1 = { s1: applySgsScoreCellAction(applySgsScoreRecalculation(undefined, { calculatedScore: 10 }, NOW), 'override', 9)! }
    editSource(db, 'a1', 's1', 0) // no auto run happened (e.g. score changed elsewhere)

    const restored = await recalculateSgsCellFromSources('sub', 'room', db.columns[0], db.formulas.c1!, 's1', true, depsFor(db))
    expect(restored?.calculatedScore).toBe(0)
    expect(effective(db, 'c1', 's1')).toMatchObject({ origin: 'auto', effectiveScore: 0, overrideScore: null })
  })

  it('a legacy override with no stored calculated value still offers "กลับไปใช้คะแนนคำนวณ" when the sources produce one', () => {
    const legacy = resolveSgsScoreCell(legacyBackfilled(10))
    expect(getSgsScoreCellMenuActions(legacy, true, true)).toContain('clear')
    expect(getSgsScoreCellMenuActions(legacy, true, true, 0)).toContain('restore_auto')
  })

  it('suppressed cells stay suppressed (calculated value kept current)', async () => {
    const db = makeDb()
    db.cells.c1 = { s1: applySgsScoreCellAction(applySgsScoreRecalculation(undefined, { calculatedScore: 10 }, NOW), 'suppress_auto')! }
    editSource(db, 'a1', 's1', 2)
    await recalculateSgsColumnsForAssignments('sub', 'room', ['a1'], depsFor(db))
    expect(effective(db, 'c1', 's1')).toMatchObject({ origin: 'empty', autoSuppressed: true, calculatedScore: 4 })
  })

  it('only the columns mapped to the changed assignment are recalculated — unrelated SGS columns are never written', async () => {
    const db = makeDb()
    db.cells.c2 = { s1: legacyBackfilled(3) }
    db.cells.c3 = { s1: legacyBackfilled(12) }
    const c2Before = JSON.stringify(db.cells.c2)
    const c3Before = JSON.stringify(db.cells.c3)
    editSource(db, 'a1', 's1', 0)
    await recalculateSgsColumnsForAssignments('sub', 'room', ['a1'], depsFor(db))

    expect(db.calls.recalculate.map((c) => c.columnId)).toEqual(['c1'])
    expect(db.calls.getCells).toEqual([['c1']])
    expect(JSON.stringify(db.cells.c2)).toBe(c2Before)
    expect(JSON.stringify(db.cells.c3)).toBe(c3Before)
    expect(selectSgsColumnsAffectedByAssignments(db.columns, db.formulas, ['a3'])).toEqual([])
  })

  it('no N+1: fixed request count regardless of class size, one RPC per affected column', async () => {
    const db = makeDb()
    db.students = Array.from({ length: 40 }, (_, i) => `s${i + 1}`)
    for (const id of db.students) {
      db.submissions.a1[id] = 3
      db.submissions.a2[id] = 7
    }
    db.formulas.c3 = proportional('c3', 20, ['a1', 'a2'])
    await recalculateSgsColumnsForAssignments('sub', 'room', ['a1'], depsFor(db))
    expect(db.calls).toMatchObject({ getColumns: 1, getFormulas: 1, getSources: 1, getStudents: 1 })
    expect(db.calls.getCells).toEqual([['c1', 'c3']])
    expect(db.calls.recalculate.map((c) => c.columnId).sort()).toEqual(['c1', 'c3'])
    expect(db.calls.recalculate[0].values.length).toBe(40)
  })

  it('an unrelated save costs only the columns + formulas reads (no source/roster/cell loads)', async () => {
    const db = makeDb()
    const result = await recalculateSgsColumnsForAssignments('sub', 'room', ['a3'], depsFor(db))
    expect(result).toEqual({ status: 'no_affected_columns' })
    expect(db.calls).toMatchObject({ getColumns: 1, getFormulas: 1, getSources: 0, getStudents: 0, getCells: [] })
  })

  it('unchanged calculated values are not rewritten', () => {
    const cells = { s1: applySgsScoreRecalculation(undefined, { calculatedScore: 10 }, NOW)!, s2: legacyBackfilled(4) }
    expect(planSgsAutoRecalculationValues(['s1', 's2', 's3'], cells, { s1: 10, s2: 0, s3: null })).toEqual([{ studentId: 's2', calculatedScore: 0 }])
  })

  it('writes nothing before 0025 (no saved mappings) or 0027 (no score origin) — the legacy behavior is unchanged', async () => {
    const db = makeDb()
    db.formulasFail = true
    expect(await recalculateSgsColumnsForAssignments('sub', 'room', ['a1'], depsFor(db))).toEqual({ status: 'unavailable', reason: 'no_mapping_storage' })
    const db2 = makeDb()
    db2.supportsScoreOrigin = false
    expect(await recalculateSgsColumnsForAssignments('sub', 'room', ['a1'], depsFor(db2))).toEqual({ status: 'unavailable', reason: 'no_score_origin' })
    expect(db.calls.recalculate).toHaveLength(0)
    expect(db2.calls.recalculate).toHaveLength(0)
  })

  it('a mapping that cannot run as saved is reported, not guessed; one failing column never blocks another', async () => {
    const db = makeDb()
    db.formulas.c2 = proportional('c2', 10, ['a1'])
    db.columns[1] = column('c2', 'ช่อง 2', 15) // max changed -> needs reconfigure
    db.formulas.c3 = proportional('c3', 20, ['a1'])
    db.recalcFailFor.add('c3')
    const result = await recalculateSgsColumnsForAssignments('sub', 'room', ['a1'], depsFor(db))
    expect(result.status).toBe('done')
    const done = result as Extract<SgsAutoRecalculationResult, { status: 'done' }>
    expect(done.needsReconfigure.map((c) => c.columnId)).toEqual(['c2'])
    expect(done.failed.map((c) => c.columnId)).toEqual(['c3'])
    expect(done.updated.map((c) => c.columnId)).toEqual(['c1'])
    expect(describeSgsAutoRecalculationResult(result)).toContain('ช่อง 3')
  })
})

// ==================================================
// Save-path wiring + scheduler
// ==================================================

describe('source-score save paths trigger the recalculation', () => {
  it('every setSubmissionScore / bulk score caller schedules it AFTER the save, never awaited', () => {
    const detail = readSource('../pages/teacher/subjects/subject-classroom-assignment-detail-page-real.tsx')
    const grades = readSource('../features/subjects-real/tabs/grades-tab.tsx')
    const check = readSource('../features/subjects-real/tabs/submission-check-tab.tsx')
    for (const [source, saves] of [
      [detail, 3],
      [grades, 1],
      [check, 2],
    ] as const) {
      expect(source.match(/afterSourceScoresSaved\(/g)?.length).toBe(saves)
      expect(source).not.toContain('await afterSourceScoresSaved')
    }
    const single = detail.slice(detail.indexOf('async function handleScoreBlur'), detail.indexOf('function handleScoreKeyDown'))
    expect(single.indexOf('await setSubmissionScore(')).toBeLessThan(single.indexOf('afterSourceScoresSaved('))
    const bulk = check.slice(check.indexOf('async function runBulkScoreUpdate'))
    expect(bulk.indexOf('await bulkSetAssignmentScores(updates)')).toBeLessThan(bulk.indexOf('afterSourceScoresSaved('))
  })

  it('the SGS tab waits for a pending recalculation before loading', () => {
    const tab = readSource('../features/subjects-real/tabs/sgs-scores-tab.tsx')
    const refresh = tab.slice(tab.indexOf('const refresh = useCallback'), tab.indexOf('const refreshFormulas = useCallback'))
    expect(refresh.indexOf('sgsAutoRecalculation')).toBeLessThan(refresh.indexOf('getSgsScoreColumns(subjectId, classroomId)'))
  })

  it('per-cell "กลับไปใช้คะแนนคำนวณ" on a mapped column recalculates from fresh sources with clearOverride', () => {
    const tab = readSource('../features/subjects-real/tabs/sgs-scores-tab.tsx')
    const perform = tab.slice(tab.indexOf('async function performCellAction'), tab.indexOf('const [detailCell'))
    expect(perform).toContain("if (action === 'clear_override' && mappedFormula) {")
    expect(perform).toContain('recalculateSgsCellFromSources(subjectId, classroomId, column, mappedFormula, studentId, true)')
  })
})

describe('scheduler', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((r) => (resolve = r))
    return { promise, resolve }
  }
  const DONE: SgsAutoRecalculationResult = { status: 'done', updated: [], needsReconfigure: [], failed: [] }

  it('coalesces a burst of saves into ONE run with every assignment id', async () => {
    const runs: string[][] = []
    const scheduler = createSgsAutoRecalculationScheduler(async (_s, _c, ids) => {
      runs.push(ids)
      return DONE
    }, 0)
    const all = Promise.all([scheduler.schedule('sub', 'room', ['a1']), scheduler.schedule('sub', 'room', ['a2']), scheduler.schedule('sub', 'room', ['a1'])])
    await all
    expect(runs).toEqual([['a1', 'a2']])
  })

  it('never runs two at once; a save during a run triggers a follow-up run after it', async () => {
    const gate = deferred<void>()
    const log: string[] = []
    const scheduler = createSgsAutoRecalculationScheduler(async (_s, _c, ids) => {
      log.push(`start ${ids.join()}`)
      if (ids.includes('a1')) await gate.promise
      log.push(`end ${ids.join()}`)
      return DONE
    }, 0)
    const first = scheduler.schedule('sub', 'room', ['a1'])
    await new Promise((r) => setTimeout(r, 5))
    const second = scheduler.schedule('sub', 'room', ['a2'])
    await new Promise((r) => setTimeout(r, 5))
    expect(log).toEqual(['start a1'])
    gate.resolve()
    await Promise.all([first, second])
    expect(log).toEqual(['start a1', 'end a1', 'start a2', 'end a2'])
  })

  it('flush runs pending work immediately and waits for it', async () => {
    let ran = false
    const scheduler = createSgsAutoRecalculationScheduler(async () => {
      ran = true
      return DONE
    }, 60_000)
    void scheduler.schedule('sub', 'room', ['a1'])
    await scheduler.flush('sub', 'room')
    expect(ran).toBe(true)
    await scheduler.flush('other', 'room') // nothing pending: resolves
  })

  it('afterSourceScoresSaved never throws or rejects, even when the run itself throws', async () => {
    const messages: string[] = []
    const scheduler = createSgsAutoRecalculationScheduler(async () => {
      throw new Error('network down')
    }, 0)
    expect(() => afterSourceScoresSaved('sub', 'room', ['a1'], (m) => messages.push(m), scheduler)).not.toThrow()
    await scheduler.flush('sub', 'room')
    await new Promise((r) => setTimeout(r, 0))
    expect(messages).toEqual(['อัปเดตคะแนน SGS อัตโนมัติไม่สำเร็จ — คะแนนงานบันทึกแล้ว เปิดแท็บคะแนน SGS เพื่อคำนวณใหม่'])
  })

  it('stays quiet when nothing changed', () => {
    expect(describeSgsAutoRecalculationResult({ status: 'no_affected_columns' })).toBeNull()
    expect(describeSgsAutoRecalculationResult({ status: 'unavailable', reason: 'no_mapping_storage' })).toBeNull()
    expect(describeSgsAutoRecalculationResult(DONE)).toBeNull()
    expect(describeSgsAutoRecalculationResult({ ...DONE, updated: [{ columnId: 'c1', label: 'ช่อง 1', updated: 1 }] } as SgsAutoRecalculationResult)).toBe(
      'อัปเดตคะแนน SGS อัตโนมัติแล้ว: ช่อง 1',
    )
  })
})
