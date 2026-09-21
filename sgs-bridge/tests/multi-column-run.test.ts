import { describe, expect, it } from 'vitest'

import {
  ALL_STUDENTS_MUST_BE_VISIBLE_MESSAGE,
  applyManualColumnMapping,
  autoMatchColumns,
  buildMultiColumnPlan,
  buildSequentialWriteInstructions,
  COLUMN_MAPPING_STATUS,
  evaluateAllStudentsVisibleGate,
  evaluateColumnMappingReadiness,
  evaluateMultiColumnRunPreconditions,
  MULTI_COLUMN_STATUS,
  normalizeColumnLabel,
  orderColumnsForSequentialWrite,
  summarizeMultiColumnPreview,
  summarizeMultiColumnRun,
} from '../src/lib/multi-column-run'

// The real classroom this production workflow was specified against.
const STUDENT_COUNT = 32

/** SGS's own writable score columns, exactly as classifyScoreColumns
 * reports them (label + its own maxScore + its left-to-right index). */
const SGS_COLUMNS = [
  { key: 'col-10-3', label: '10', columnIndex: 3, maxScore: 10 },
  { key: 'col-11-4', label: '11', columnIndex: 4, maxScore: 10 },
  { key: 'col-12-5', label: '12', columnIndex: 5, maxScore: 10 },
  { key: 'col-final-6', label: 'ปลายภาค', columnIndex: 6, maxScore: 30 },
]

/** The KrunameClass multi-column payload's own columns. */
const KRUNAME_COLUMNS = [
  { key: 'k1', label: 'ช่อง 10', maxScore: 10 },
  { key: 'k2', label: 'ช่อง 11', maxScore: 10 },
  { key: 'k3', label: 'ช่อง 12', maxScore: 10 },
  { key: 'k4', label: 'ปลายภาค', maxScore: 30 },
]

function buildRoster(count = STUDENT_COUNT) {
  return Array.from({ length: count }, (_, i) => ({
    studentId: `s${i + 1}`,
    studentNumber: i + 1,
    studentCode: `100${i + 1}`,
    fullName: `นักเรียน ${i + 1}`,
  }))
}

/** Every student matched to their own SGS row, in roster order — the
 * shape matchStudentsToSgs produces. */
function buildMappingResults(roster: ReturnType<typeof buildRoster>) {
  return roster.map((student, index) => ({
    studentId: student.studentId,
    status: 'MATCHED' as const,
    matchedSgsRowKey: `row-${index}`,
    reason: 'จับคู่ด้วยรหัสนักเรียน',
  }))
}

/** Same score in every selected column unless overridden per student. */
function buildScores(roster: ReturnType<typeof buildRoster>, scoreByColumnKey: Record<string, number | null>) {
  const out: Record<string, Record<string, number | null>> = {}
  for (const student of roster) out[student.studentId] = { ...scoreByColumnKey }
  return out
}

function planFor({
  roster = buildRoster(),
  selected = SGS_COLUMNS,
  scores,
  existingScoresByColumnKey = {},
  overwriteMode = 'skip_existing' as 'skip_existing' | 'overwrite_selected_column',
  matches = autoMatchColumns(KRUNAME_COLUMNS, SGS_COLUMNS),
}: {
  roster?: ReturnType<typeof buildRoster>
  selected?: typeof SGS_COLUMNS
  scores?: Record<string, Record<string, number | null>>
  existingScoresByColumnKey?: Record<string, Record<string, number | null>>
  overwriteMode?: 'skip_existing' | 'overwrite_selected_column'
  matches?: ReturnType<typeof autoMatchColumns>
}) {
  return buildMultiColumnPlan({
    roster,
    scoresByStudentIdAndColumnKey: scores ?? buildScores(roster, { k1: 8, k2: 9, k3: 7, k4: 25 }),
    mappingResults: buildMappingResults(roster),
    matches,
    selectedSgsColumns: selected,
    existingScoresByColumnKey,
    overwriteMode,
  })
}

describe('all-students-visible gate — production mode never navigates pages itself', () => {
  it('32 visible / 32 total is READY', () => {
    const gate = evaluateAllStudentsVisibleGate({ visibleStudentRows: 32, totalStudentRows: 32 })
    expect(gate.ok).toBe(true)
    expect(gate.visible).toBe(32)
    expect(gate.total).toBe(32)
    expect(gate.reason).toBeNull()
  })

  it('10 visible / 32 total STOPS with the exact required message', () => {
    const gate = evaluateAllStudentsVisibleGate({ visibleStudentRows: 10, totalStudentRows: 32 })
    expect(gate.ok).toBe(false)
    expect(gate.reason).toBe(ALL_STUDENTS_MUST_BE_VISIBLE_MESSAGE)
    expect(gate.reason).toBe('กรุณาตั้งจำนวนรายการต่อหน้าใน SGS ให้แสดงนักเรียนทั้งห้องก่อน')
  })

  it('an unknown visible/total count fails rather than assuming it is fine', () => {
    expect(evaluateAllStudentsVisibleGate({ visibleStudentRows: null, totalStudentRows: 32 }).ok).toBe(false)
    expect(evaluateAllStudentsVisibleGate({ visibleStudentRows: 32, totalStudentRows: null }).ok).toBe(false)
    expect(evaluateAllStudentsVisibleGate({}).ok).toBe(false)
  })

  it('more visible than total is still refused — the two must agree exactly', () => {
    expect(evaluateAllStudentsVisibleGate({ visibleStudentRows: 33, totalStudentRows: 32 }).ok).toBe(false)
  })
})

describe('column mapping — never guesses an ambiguous pairing', () => {
  it('normalizes the Thai "ช่อง" prefix so "ช่อง 10" pairs with SGS\'s own "10"', () => {
    expect(normalizeColumnLabel('ช่อง 10')).toBe('10')
    expect(normalizeColumnLabel('10')).toBe('10')
    expect(normalizeColumnLabel('ปลายภาค')).toBe('ปลายภาค')
  })

  it('auto-maps all four columns when each label matches exactly one SGS column', () => {
    const matches = autoMatchColumns(KRUNAME_COLUMNS, SGS_COLUMNS)
    expect(matches.map((m) => m.status)).toEqual([
      COLUMN_MAPPING_STATUS.AUTO,
      COLUMN_MAPPING_STATUS.AUTO,
      COLUMN_MAPPING_STATUS.AUTO,
      COLUMN_MAPPING_STATUS.AUTO,
    ])
    expect(matches.map((m) => m.sgsColumnKey)).toEqual(['col-10-3', 'col-11-4', 'col-12-5', 'col-final-6'])
  })

  it('AMBIGUOUS MAPPING BLOCKED: two SGS columns sharing a label are never auto-resolved, not even by maxScore', () => {
    const duplicated = [
      { key: 'dup-a', label: '10', columnIndex: 3, maxScore: 10 },
      { key: 'dup-b', label: '10', columnIndex: 7, maxScore: 20 },
    ]
    const matches = autoMatchColumns([{ key: 'k1', label: 'ช่อง 10', maxScore: 10 }], duplicated)
    expect(matches[0].status).toBe(COLUMN_MAPPING_STATUS.AMBIGUOUS)
    expect(matches[0].sgsColumnKey).toBeNull()
    expect(matches[0].candidates).toEqual(['dup-a', 'dup-b'])

    // ...and selecting either candidate is blocked until the teacher chooses.
    const readiness = evaluateColumnMappingReadiness(matches, ['dup-a'])
    expect(readiness.ok).toBe(false)
    expect(readiness.reason).toContain('เลือกคอลัมน์ SGS ที่ต้องการด้วยตนเอง')
  })

  it('an explicit manual choice resolves an ambiguous pairing and unblocks the run', () => {
    const duplicated = [
      { key: 'dup-a', label: '10', columnIndex: 3, maxScore: 10 },
      { key: 'dup-b', label: '10', columnIndex: 7, maxScore: 20 },
    ]
    const auto = autoMatchColumns([{ key: 'k1', label: 'ช่อง 10', maxScore: 10 }], duplicated)
    const resolved = applyManualColumnMapping(auto, { k1: 'dup-b' })
    expect(resolved[0].status).toBe(COLUMN_MAPPING_STATUS.MANUAL)
    expect(resolved[0].sgsColumnKey).toBe('dup-b')
    expect(evaluateColumnMappingReadiness(resolved, ['dup-b']).ok).toBe(true)
  })

  it('a KrunameClass column with no SGS counterpart is UNMAPPED, and selecting that SGS column is blocked', () => {
    const matches = autoMatchColumns([{ key: 'k9', label: 'ช่องที่ไม่มีใน SGS', maxScore: 10 }], SGS_COLUMNS)
    expect(matches[0].status).toBe(COLUMN_MAPPING_STATUS.UNMAPPED)
    expect(evaluateColumnMappingReadiness(matches, ['col-10-3']).ok).toBe(false)
  })

  it('selecting no column at all is blocked', () => {
    expect(evaluateColumnMappingReadiness(autoMatchColumns(KRUNAME_COLUMNS, SGS_COLUMNS), []).ok).toBe(false)
  })

  it('two KrunameClass columns manually pointed at the SAME SGS column is blocked', () => {
    const matches = applyManualColumnMapping(autoMatchColumns(KRUNAME_COLUMNS, SGS_COLUMNS), { k2: 'col-10-3' })
    expect(evaluateColumnMappingReadiness(matches, ['col-10-3']).ok).toBe(false)
  })
})

describe('SINGLE selected column', () => {
  it('plans exactly one column, for all 32 students', () => {
    const plans = planFor({ selected: [SGS_COLUMNS[0]] })
    expect(plans).toHaveLength(1)
    expect(plans[0].sgsColumnKey).toBe('col-10-3')
    expect(plans[0].krunameColumnLabel).toBe('ช่อง 10')
    expect(plans[0].plan).toHaveLength(STUDENT_COUNT)
    expect(plans[0].plan.every((row) => row.status === MULTI_COLUMN_STATUS.READY)).toBe(true)

    const preview = summarizeMultiColumnPreview(plans)
    expect(preview.columns).toBe(1)
    expect(preview.toWrite).toBe(STUDENT_COUNT)
  })
})

describe('MULTIPLE selected columns / SELECT ALL', () => {
  it('SELECT ALL: 32 students x 4 columns = 128 writes, each carrying its own column index', () => {
    const plans = planFor({})
    expect(plans).toHaveLength(4)

    const preview = summarizeMultiColumnPreview(plans)
    expect(preview.columns).toBe(4)
    expect(preview.toWrite).toBe(STUDENT_COUNT * 4)
    expect(preview.perColumn.map((c) => c.toWrite)).toEqual([32, 32, 32, 32])
    expect(preview.perColumn.map((c) => c.sgsColumnLabel)).toEqual(['10', '11', '12', 'ปลายภาค'])
  })

  it('a SUBSET selection plans only the chosen columns — never the unchosen ones', () => {
    const plans = planFor({ selected: [SGS_COLUMNS[0], SGS_COLUMNS[2]] })
    expect(plans.map((p) => p.sgsColumnKey)).toEqual(['col-10-3', 'col-12-5'])
    expect(plans.some((p) => p.sgsColumnKey === 'col-11-4')).toBe(false)
  })

  it('DIFFERENT MAX SCORES PER COLUMN: each column validates against its OWN max, never another column\'s', () => {
    const roster = buildRoster(2)
    // 25 is valid for ปลายภาค (max 30) but far over the max-10 columns.
    const plans = planFor({
      roster,
      selected: [SGS_COLUMNS[0], SGS_COLUMNS[3]],
      scores: buildScores(roster, { k1: 25, k4: 25 }),
    })

    const tenColumn = plans.find((p) => p.sgsColumnKey === 'col-10-3')!
    const finalColumn = plans.find((p) => p.sgsColumnKey === 'col-final-6')!
    expect(tenColumn.maxScore).toBe(10)
    expect(finalColumn.maxScore).toBe(30)
    expect(tenColumn.plan.every((row) => row.status === MULTI_COLUMN_STATUS.INVALID_SCORE)).toBe(true)
    expect(finalColumn.plan.every((row) => row.status === MULTI_COLUMN_STATUS.READY)).toBe(true)
  })

  it('writes columns in a stable left-to-right order regardless of checkbox click order', () => {
    const clickedOutOfOrder = [SGS_COLUMNS[3], SGS_COLUMNS[1], SGS_COLUMNS[0]]
    expect(orderColumnsForSequentialWrite(clickedOutOfOrder).map((c) => c.key)).toEqual(['col-10-3', 'col-11-4', 'col-final-6'])
  })
})

describe('existing SGS scores — skip by default, overwrite only on explicit opt-in', () => {
  it('EXISTING-SCORE SKIP: a student with an existing SGS value is skipped when overwrite is off', () => {
    const roster = buildRoster(3)
    const plans = planFor({
      roster,
      selected: [SGS_COLUMNS[0]],
      scores: buildScores(roster, { k1: 8 }),
      existingScoresByColumnKey: { 'col-10-3': { 'row-1': 5 } },
    })
    const statuses = plans[0].plan.map((row) => row.status)
    expect(statuses).toEqual([MULTI_COLUMN_STATUS.READY, MULTI_COLUMN_STATUS.SKIP_EXISTING, MULTI_COLUMN_STATUS.READY])
  })

  it('SCORE 0 IS A REAL EXISTING SCORE: an existing 0 is skipped exactly like any other existing value', () => {
    const roster = buildRoster(2)
    const plans = planFor({
      roster,
      selected: [SGS_COLUMNS[0]],
      scores: buildScores(roster, { k1: 8 }),
      existingScoresByColumnKey: { 'col-10-3': { 'row-0': 0 } },
    })
    expect(plans[0].plan[0].status).toBe(MULTI_COLUMN_STATUS.SKIP_EXISTING)
    expect(plans[0].plan[0].sgsExistingScore).toBe(0)
    expect(plans[0].plan[1].status).toBe(MULTI_COLUMN_STATUS.READY)
  })

  it('SCORE 0 IS A REAL SCORE TO SEND: a KrunameClass score of 0 is written, never treated as "no score"', () => {
    const roster = buildRoster(2)
    const plans = planFor({ roster, selected: [SGS_COLUMNS[0]], scores: buildScores(roster, { k1: 0 }) })
    expect(plans[0].plan.every((row) => row.status === MULTI_COLUMN_STATUS.READY)).toBe(true)
    expect(plans[0].plan[0].krunameScore).toBe(0)

    const instructions = buildSequentialWriteInstructions(plans).filter((i) => i.kind === 'WRITE_CELL')
    expect(instructions).toHaveLength(2)
    expect(instructions[0].score).toBe(0)
  })

  it('a missing (null) KrunameClass score is SKIP_NO_SCORE — distinct from a 0', () => {
    const roster = buildRoster(2)
    const scores = buildScores(roster, { k1: 0 })
    scores[roster[1].studentId].k1 = null
    const plans = planFor({ roster, selected: [SGS_COLUMNS[0]], scores })
    expect(plans[0].plan[0].status).toBe(MULTI_COLUMN_STATUS.READY)
    expect(plans[0].plan[1].status).toBe(MULTI_COLUMN_STATUS.SKIP_NO_SCORE)
  })

  it('OVERWRITE OPT-IN: the same existing values become writable once overwrite is enabled', () => {
    const roster = buildRoster(3)
    const existing = { 'col-10-3': { 'row-0': 0, 'row-1': 5 } }
    const skipPlans = planFor({
      roster,
      selected: [SGS_COLUMNS[0]],
      scores: buildScores(roster, { k1: 8 }),
      existingScoresByColumnKey: existing,
    })
    const overwritePlans = planFor({
      roster,
      selected: [SGS_COLUMNS[0]],
      scores: buildScores(roster, { k1: 8 }),
      existingScoresByColumnKey: existing,
      overwriteMode: 'overwrite_selected_column',
    })

    expect(summarizeMultiColumnPreview(skipPlans).skippedExisting).toBe(2)
    expect(summarizeMultiColumnPreview(skipPlans).toWrite).toBe(1)
    expect(summarizeMultiColumnPreview(overwritePlans).skippedExisting).toBe(0)
    expect(summarizeMultiColumnPreview(overwritePlans).toWrite).toBe(3)

    // "existing SGS scores that WOULD be overwritten if overwrite is
    // enabled" reads the same in both modes.
    expect(summarizeMultiColumnPreview(skipPlans).wouldOverwrite).toBe(2)
    expect(summarizeMultiColumnPreview(overwritePlans).wouldOverwrite).toBe(2)
  })
})

describe('preview + confirmation gate', () => {
  it('blocks confirmation while ANY column holds an out-of-range score, naming the column and its max', () => {
    const roster = buildRoster(2)
    const plans = planFor({ roster, selected: [SGS_COLUMNS[0]], scores: buildScores(roster, { k1: 99 }) })
    const decision = evaluateMultiColumnRunPreconditions({
      visibilityGate: { ok: true },
      mappingReadiness: { ok: true },
      columnPlans: plans,
    })
    expect(decision.ok).toBe(false)
    expect(decision.reason).toContain('"10"')
    expect(decision.reason).toContain('0 ถึง 10')
  })

  it('blocks confirmation when the all-students-visible gate has not passed', () => {
    const decision = evaluateMultiColumnRunPreconditions({
      visibilityGate: evaluateAllStudentsVisibleGate({ visibleStudentRows: 10, totalStudentRows: 32 }),
      mappingReadiness: { ok: true },
      columnPlans: planFor({}),
    })
    expect(decision.ok).toBe(false)
    expect(decision.reason).toBe(ALL_STUDENTS_MUST_BE_VISIBLE_MESSAGE)
  })

  it('blocks confirmation when nothing is actually writable', () => {
    const roster = buildRoster(2)
    const decision = evaluateMultiColumnRunPreconditions({
      visibilityGate: { ok: true },
      mappingReadiness: { ok: true },
      columnPlans: planFor({ roster, selected: [SGS_COLUMNS[0]], scores: buildScores(roster, { k1: null }) }),
    })
    expect(decision.ok).toBe(false)
    expect(decision.reason).toContain('ไม่มีคะแนนที่พร้อมส่ง')
  })

  it('allows confirmation for a clean 32/32, four-column run', () => {
    const decision = evaluateMultiColumnRunPreconditions({
      visibilityGate: evaluateAllStudentsVisibleGate({ visibleStudentRows: 32, totalStudentRows: 32 }),
      mappingReadiness: evaluateColumnMappingReadiness(
        autoMatchColumns(KRUNAME_COLUMNS, SGS_COLUMNS),
        SGS_COLUMNS.map((c) => c.key),
      ),
      columnPlans: planFor({}),
    })
    expect(decision.ok).toBe(true)
  })
})

describe('sequential write instructions — column A completes before column B starts', () => {
  it('32 STUDENTS x MULTIPLE COLUMNS: every column finishes fully, in order, with a COLUMN_COMPLETE between', () => {
    const instructions = buildSequentialWriteInstructions(planFor({}))

    // 4 columns x 32 writes + 4 COLUMN_COMPLETE markers.
    expect(instructions).toHaveLength(STUDENT_COUNT * 4 + 4)

    const columnOrder = instructions.filter((i) => i.kind === 'COLUMN_COMPLETE').map((i) => i.sgsColumnKey)
    expect(columnOrder).toEqual(['col-10-3', 'col-11-4', 'col-12-5', 'col-final-6'])

    // Nothing from a later column ever appears before the earlier
    // column's COLUMN_COMPLETE.
    const firstComplete = instructions.findIndex((i) => i.kind === 'COLUMN_COMPLETE')
    expect(instructions.slice(0, firstComplete).every((i) => i.sgsColumnKey === 'col-10-3')).toBe(true)
  })

  it('never batches two columns into one instruction — each carries exactly one columnIndex and one row offset', () => {
    const writes = buildSequentialWriteInstructions(planFor({})).filter((i) => i.kind === 'WRITE_CELL')
    for (const write of writes) {
      expect(typeof write.columnIndex).toBe('number')
      expect(typeof write.sgsRowOffset).toBe('number')
      expect(Object.keys(write)).not.toContain('writesByOffset')
    }
    // Each (column, row) pair appears exactly once across the whole run.
    const pairs = writes.map((w) => `${w.columnIndex}:${w.sgsRowOffset}`)
    expect(new Set(pairs).size).toBe(pairs.length)
  })

  it('FAILURE IN ONE CELL NEVER WRITES THE WRONG CELL/COLUMN: each instruction is self-describing, so skipping one leaves every other target untouched', () => {
    const roster = buildRoster(4)
    const scores = buildScores(roster, { k1: 8, k2: 9 })
    scores[roster[1].studentId].k1 = null // student 2 is skipped in column A only
    const plans = planFor({ roster, selected: [SGS_COLUMNS[0], SGS_COLUMNS[1]], scores })
    const writes = buildSequentialWriteInstructions(plans).filter((i) => i.kind === 'WRITE_CELL')

    // Column A is missing exactly the skipped student's row — and every
    // OTHER row still targets its own original offset, never shifted up
    // to fill the gap.
    const columnA = writes.filter((w) => w.columnIndex === 3)
    expect(columnA.map((w) => w.sgsRowOffset)).toEqual([0, 2, 3])
    expect(columnA.map((w) => w.studentId)).toEqual(['s1', 's3', 's4'])

    // Column B is untouched by column A's skip.
    const columnB = writes.filter((w) => w.columnIndex === 4)
    expect(columnB.map((w) => w.sgsRowOffset)).toEqual([0, 1, 2, 3])
  })

  it('a NOT_FOUND / AMBIGUOUS student never produces a write instruction at all', () => {
    const roster = buildRoster(3)
    const mappingResults = buildMappingResults(roster)
    const unmatched = [
      mappingResults[0],
      { ...mappingResults[1], status: 'NOT_FOUND' as const, matchedSgsRowKey: null },
      { ...mappingResults[2], status: 'AMBIGUOUS' as const, matchedSgsRowKey: null },
    ]
    const plans = buildMultiColumnPlan({
      roster,
      scoresByStudentIdAndColumnKey: buildScores(roster, { k1: 8 }),
      mappingResults: unmatched,
      matches: autoMatchColumns(KRUNAME_COLUMNS, SGS_COLUMNS),
      selectedSgsColumns: [SGS_COLUMNS[0]],
      existingScoresByColumnKey: {},
      overwriteMode: 'skip_existing',
    })

    const writes = buildSequentialWriteInstructions(plans).filter((i) => i.kind === 'WRITE_CELL')
    expect(writes).toHaveLength(1)
    expect(writes[0].studentId).toBe('s1')
  })
})

describe('final report', () => {
  it('reports the seven required totals plus a per-column line', () => {
    const roster = buildRoster(4)
    const scores = buildScores(roster, { k1: 8, k2: 9 })
    scores[roster[3].studentId].k1 = null
    const plans = planFor({
      roster,
      selected: [SGS_COLUMNS[0], SGS_COLUMNS[1]],
      scores,
      existingScoresByColumnKey: { 'col-10-3': { 'row-2': 0 } },
    })

    // Column A: row0 written, row1 FAILED its read-back, row2 skipped
    // (existing 0), row3 skipped (no score). Column B: all four written.
    const columnResults = [
      {
        sgsColumnKey: plans[0].sgsColumnKey,
        sgsColumnLabel: plans[0].sgsColumnLabel,
        verifiedPlan: plans[0].plan.map((row, index) => ({
          ...row,
          writeOutcome: row.status === MULTI_COLUMN_STATUS.READY ? (index === 1 ? 'FAILED' : 'WRITTEN') : null,
        })),
      },
      {
        sgsColumnKey: plans[1].sgsColumnKey,
        sgsColumnLabel: plans[1].sgsColumnLabel,
        verifiedPlan: plans[1].plan.map((row) => ({ ...row, writeOutcome: row.status === MULTI_COLUMN_STATUS.READY ? 'WRITTEN' : null })),
      },
    ]

    const report = summarizeMultiColumnRun(columnResults)
    expect(report.columns).toBe(2)
    expect(report.written).toBe(1 + 4)
    expect(report.failed).toBe(1)
    expect(report.skippedExisting).toBe(1)
    expect(report.skippedNoScore).toBe(1)
    expect(report.invalidScore).toBe(0)
    expect(report.notFound).toBe(0)
    expect(report.ambiguous).toBe(0)

    expect(report.perColumn).toHaveLength(2)
    expect(report.perColumn[0]).toMatchObject({ sgsColumnLabel: '10', written: 1, failed: 1, skippedExisting: 1, skippedNoScore: 1 })
    expect(report.perColumn[1]).toMatchObject({ sgsColumnLabel: '11', written: 4, failed: 0 })
  })

  it('a full clean 32 x 4 run reports 128 written and nothing else', () => {
    const plans = planFor({})
    const report = summarizeMultiColumnRun(
      plans.map((column) => ({
        sgsColumnKey: column.sgsColumnKey,
        sgsColumnLabel: column.sgsColumnLabel,
        verifiedPlan: column.plan.map((row) => ({ ...row, writeOutcome: 'WRITTEN' })),
      })),
    )
    expect(report.written).toBe(128)
    expect(report.failed).toBe(0)
    expect(report.perColumn.map((c) => c.written)).toEqual([32, 32, 32, 32])
  })
})
