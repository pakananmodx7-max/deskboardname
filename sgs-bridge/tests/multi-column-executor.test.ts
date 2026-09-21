import { describe, expect, it, vi } from 'vitest'

import {
  attachOutcomesToColumnPlans,
  executeSequentialColumnRun,
  RUN_EVENT,
} from '../src/lib/multi-column-executor'
import {
  autoMatchColumns,
  buildMultiColumnPlan,
  buildSequentialWriteInstructions,
  summarizeMultiColumnPreview,
  summarizeMultiColumnRun,
} from '../src/lib/multi-column-run'

const TABLE_INDEX = 2
const RUN_START_INDEX = 5

const SGS_COLUMNS = [
  { key: 'col-10-3', label: '10', columnIndex: 3, maxScore: 10 },
  { key: 'col-11-4', label: '11', columnIndex: 4, maxScore: 10 },
  { key: 'col-final-6', label: 'ปลายภาค', columnIndex: 6, maxScore: 30 },
]
const KRUNAME_COLUMNS = [
  { key: 'k1', label: 'ช่อง 10', maxScore: 10 },
  { key: 'k2', label: 'ช่อง 11', maxScore: 10 },
  { key: 'k4', label: 'ปลายภาค', maxScore: 30 },
]

function buildRoster(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    studentId: `s${i + 1}`,
    studentNumber: i + 1,
    studentCode: `100${i + 1}`,
    fullName: `นักเรียน ${i + 1}`,
  }))
}

function plansFor(count: number, selected = SGS_COLUMNS, scoreByColumnKey: Record<string, number | null> = { k1: 8, k2: 9, k4: 25 }) {
  const roster = buildRoster(count)
  const scores: Record<string, Record<string, number | null>> = {}
  for (const student of roster) scores[student.studentId] = { ...scoreByColumnKey }
  return buildMultiColumnPlan({
    roster,
    scoresByStudentIdAndColumnKey: scores,
    mappingResults: roster.map((student, index) => ({
      studentId: student.studentId,
      status: 'MATCHED' as const,
      matchedSgsRowKey: `row-${index}`,
      reason: 'จับคู่ด้วยรหัสนักเรียน',
    })),
    matches: autoMatchColumns(KRUNAME_COLUMNS, SGS_COLUMNS),
    selectedSgsColumns: selected,
    existingScoresByColumnKey: {},
    overwriteMode: 'skip_existing',
  })
}

/** A fake SGS grid: every write lands in a cell map, and the read-back
 * returns whatever that cell actually holds — so a write that is
 * rejected/reverted is genuinely observable, exactly like the live page. */
function createFakeGrid(options: { rejectCell?: (columnIndex: number, rowOffset: number) => boolean; revertCell?: (columnIndex: number, rowOffset: number) => boolean } = {}) {
  const cells = new Map<string, number | null>()
  const writeCalls: { columnIndex: number; writesByOffset: Record<number, number> }[] = []
  const readCalls: { columnIndex: number; rowIndex: number }[] = []

  const diagnostic = {
    fillSgsColumnValues: vi.fn((tableIndex: number, runStartIndex: number, columnIndex: number, writesByOffset: Record<number, number>) => {
      expect(tableIndex).toBe(TABLE_INDEX)
      expect(runStartIndex).toBe(RUN_START_INDEX)
      writeCalls.push({ columnIndex, writesByOffset })
      const missingOffsets: number[] = []
      for (const [offsetText, value] of Object.entries(writesByOffset)) {
        const offset = Number(offsetText)
        if (options.rejectCell?.(columnIndex, offset)) {
          missingOffsets.push(offset)
          continue
        }
        cells.set(`${columnIndex}:${offset}`, options.revertCell?.(columnIndex, offset) ? null : value)
      }
      return { found: true, writtenCount: Object.keys(writesByOffset).length - missingOffsets.length, missingOffsets }
    }),
    readSingleColumnCellValue: vi.fn((tableIndex: number, rowIndex: number, columnIndex: number) => {
      readCalls.push({ columnIndex, rowIndex })
      const offset = rowIndex - RUN_START_INDEX
      const key = `${columnIndex}:${offset}`
      return cells.has(key) ? { found: true, value: cells.get(key) } : { found: false, value: null }
    }),
  }

  return { diagnostic, cells, writeCalls, readCalls }
}

function run(instructions: ReturnType<typeof buildSequentialWriteInstructions>, grid: ReturnType<typeof createFakeGrid>, extra: Record<string, unknown> = {}) {
  const events: { type: string; [k: string]: unknown }[] = []
  return executeSequentialColumnRun({
    instructions,
    diagnostic: grid.diagnostic,
    tableIndex: TABLE_INDEX,
    runStartIndex: RUN_START_INDEX,
    onEvent: (event) => {
      events.push(event)
    },
    ...extra,
  }).then((result) => ({ ...result, events }))
}

describe('sequential per-column writing — one cell at a time, verified immediately', () => {
  it('writes every cell of column A (with its own read-back) before column B begins', async () => {
    const plans = plansFor(3)
    const grid = createFakeGrid()
    const { events } = await run(buildSequentialWriteInstructions(plans), grid)

    // Every write is immediately followed by a read of the SAME cell.
    expect(grid.writeCalls).toHaveLength(9)
    expect(grid.readCalls).toHaveLength(9)
    for (let i = 0; i < grid.writeCalls.length; i++) {
      const offset = Number(Object.keys(grid.writeCalls[i].writesByOffset)[0])
      expect(grid.readCalls[i].columnIndex).toBe(grid.writeCalls[i].columnIndex)
      expect(grid.readCalls[i].rowIndex).toBe(RUN_START_INDEX + offset)
    }

    // Column order is strictly A fully, then B fully, then C.
    expect(grid.writeCalls.map((c) => c.columnIndex)).toEqual([3, 3, 3, 4, 4, 4, 6, 6, 6])

    const completions = events.filter((e) => e.type === RUN_EVENT.COLUMN_COMPLETE).map((e) => e.sgsColumnKey)
    expect(completions).toEqual(['col-10-3', 'col-11-4', 'col-final-6'])
  })

  it('NEVER batch-writes: every fillSgsColumnValues call carries exactly ONE row offset and ONE column', async () => {
    const grid = createFakeGrid()
    await run(buildSequentialWriteInstructions(plansFor(32)), grid)

    expect(grid.writeCalls).toHaveLength(96)
    for (const call of grid.writeCalls) {
      expect(Object.keys(call.writesByOffset)).toHaveLength(1)
      expect(typeof call.columnIndex).toBe('number')
    }
  })

  it('32 STUDENTS x 3 COLUMNS: every cell ends up holding its own column\'s score', async () => {
    const plans = plansFor(32)
    const grid = createFakeGrid()
    const { outcomesByColumnKey } = await run(buildSequentialWriteInstructions(plans), grid)

    expect(outcomesByColumnKey['col-10-3']).toHaveLength(32)
    expect(outcomesByColumnKey['col-11-4']).toHaveLength(32)
    expect(outcomesByColumnKey['col-final-6']).toHaveLength(32)

    expect(grid.cells.get('3:0')).toBe(8)
    expect(grid.cells.get('4:0')).toBe(9)
    expect(grid.cells.get('6:0')).toBe(25)
    expect(grid.cells.get('6:31')).toBe(25)

    const report = summarizeMultiColumnRun(attachOutcomesToColumnPlans(plans, outcomesByColumnKey))
    expect(report.written).toBe(96)
    expect(report.failed).toBe(0)
    expect(report.perColumn.map((c) => c.written)).toEqual([32, 32, 32])
  })

  it('a score of 0 is really written, and its read-back of 0 verifies as WRITTEN (never mistaken for an empty cell)', async () => {
    const plans = plansFor(2, [SGS_COLUMNS[0]], { k1: 0 })
    const grid = createFakeGrid()
    const { outcomesByColumnKey } = await run(buildSequentialWriteInstructions(plans), grid)

    expect(grid.cells.get('3:0')).toBe(0)
    expect(outcomesByColumnKey['col-10-3'].every((o) => o.writeOutcome === 'WRITTEN')).toBe(true)
  })
})

describe('FAILURE IN ONE CELL DOES NOT WRITE THE WRONG CELL OR COLUMN', () => {
  it('a rejected cell is recorded FAILED, and every other cell still lands on its own exact target', async () => {
    const plans = plansFor(4)
    // Column A (index 3), student 2 (offset 1) refuses the write.
    const grid = createFakeGrid({ rejectCell: (columnIndex, offset) => columnIndex === 3 && offset === 1 })
    const { outcomesByColumnKey, events } = await run(buildSequentialWriteInstructions(plans), grid)

    const columnA = outcomesByColumnKey['col-10-3']
    expect(columnA.map((o) => o.writeOutcome)).toEqual(['WRITTEN', 'FAILED', 'WRITTEN', 'WRITTEN'])

    // The failed cell holds nothing...
    expect(grid.cells.has('3:1')).toBe(false)
    // ...and NO other cell was written in its place: every other offset
    // of column A holds its own student's score, unshifted.
    expect(grid.cells.get('3:0')).toBe(8)
    expect(grid.cells.get('3:2')).toBe(8)
    expect(grid.cells.get('3:3')).toBe(8)
    // ...and no cell of column A was written twice.
    const columnAWrites = grid.writeCalls.filter((c) => c.columnIndex === 3).map((c) => Object.keys(c.writesByOffset)[0])
    expect(columnAWrites).toEqual(['0', '1', '2', '3'])

    // The later columns are completely unaffected.
    expect(outcomesByColumnKey['col-11-4'].every((o) => o.writeOutcome === 'WRITTEN')).toBe(true)
    expect(grid.cells.get('4:1')).toBe(9)
    expect(events.filter((e) => e.type === RUN_EVENT.CELL_FAILED)).toHaveLength(1)
  })

  it('a cell SGS silently reverts fails its read-back verification rather than being reported written', async () => {
    const plans = plansFor(2, [SGS_COLUMNS[0]])
    const grid = createFakeGrid({ revertCell: (columnIndex, offset) => columnIndex === 3 && offset === 0 })
    const { outcomesByColumnKey } = await run(buildSequentialWriteInstructions(plans), grid)

    expect(outcomesByColumnKey['col-10-3'][0].writeOutcome).toBe('FAILED')
    expect(outcomesByColumnKey['col-10-3'][0].actualValue).toBeNull()
    expect(outcomesByColumnKey['col-10-3'][1].writeOutcome).toBe('WRITTEN')
  })

  it('a DOM call that throws fails only that one cell, and the run continues with the next one', async () => {
    const plans = plansFor(3, [SGS_COLUMNS[0]])
    const grid = createFakeGrid()
    const realFill = grid.diagnostic.fillSgsColumnValues
    let call = 0
    grid.diagnostic.fillSgsColumnValues = vi.fn((...args: unknown[]) => {
      call += 1
      if (call === 2) throw new Error('SGS input disappeared')
      return (realFill as unknown as (...a: unknown[]) => unknown)(...args)
    }) as unknown as typeof realFill

    const { outcomesByColumnKey } = await run(buildSequentialWriteInstructions(plans), grid)
    const outcomes = outcomesByColumnKey['col-10-3']
    expect(outcomes.map((o) => o.writeOutcome)).toEqual(['WRITTEN', 'FAILED', 'WRITTEN'])
    expect(String(outcomes[1].error)).toContain('SGS input disappeared')
    expect(grid.cells.get('3:2')).toBe(8)
  })

  it('the final report counts the failure without inventing a success anywhere else', async () => {
    const plans = plansFor(4)
    const grid = createFakeGrid({ rejectCell: (columnIndex, offset) => columnIndex === 4 && offset === 2 })
    const { outcomesByColumnKey } = await run(buildSequentialWriteInstructions(plans), grid)

    const report = summarizeMultiColumnRun(attachOutcomesToColumnPlans(plans, outcomesByColumnKey))
    expect(report.written).toBe(11)
    expect(report.failed).toBe(1)
    expect(report.perColumn.find((c) => c.sgsColumnLabel === '11')).toMatchObject({ written: 3, failed: 1 })
    expect(report.perColumn.find((c) => c.sgsColumnLabel === '10')).toMatchObject({ written: 4, failed: 0 })
  })
})

describe('stopping between cells', () => {
  it('honours Stop BETWEEN cells — never leaving a half-written cell, and never starting the next column', async () => {
    const plans = plansFor(4)
    const grid = createFakeGrid()
    let writes = 0
    const { stopped, outcomesByColumnKey } = await run(buildSequentialWriteInstructions(plans), grid, {
      shouldStop: () => {
        writes += 1
        return writes > 2
      },
    })

    expect(stopped).toBe(true)
    expect(outcomesByColumnKey['col-10-3']).toHaveLength(2)
    expect(outcomesByColumnKey['col-11-4']).toBeUndefined()
    // Every cell that WAS attempted is fully written and verified.
    expect(outcomesByColumnKey['col-10-3'].every((o) => o.writeOutcome === 'WRITTEN')).toBe(true)
  })
})

describe('attachOutcomesToColumnPlans', () => {
  it('leaves a skipped/unwritten row at writeOutcome null — never a fabricated success', async () => {
    const roster = buildRoster(3)
    const scores: Record<string, Record<string, number | null>> = {}
    for (const student of roster) scores[student.studentId] = { k1: 8 }
    scores[roster[1].studentId].k1 = null // skipped: no score

    const plans = buildMultiColumnPlan({
      roster,
      scoresByStudentIdAndColumnKey: scores,
      mappingResults: roster.map((student, index) => ({
        studentId: student.studentId,
        status: 'MATCHED' as const,
        matchedSgsRowKey: `row-${index}`,
        reason: 'ok',
      })),
      matches: autoMatchColumns(KRUNAME_COLUMNS, SGS_COLUMNS),
      selectedSgsColumns: [SGS_COLUMNS[0]],
      existingScoresByColumnKey: {},
      overwriteMode: 'skip_existing',
    })

    const grid = createFakeGrid()
    const { outcomesByColumnKey } = await run(buildSequentialWriteInstructions(plans), grid)
    const [column] = attachOutcomesToColumnPlans(plans, outcomesByColumnKey)

    expect(column.verifiedPlan.map((r) => r.writeOutcome)).toEqual(['WRITTEN', null, 'WRITTEN'])
    expect(summarizeMultiColumnRun([column]).skippedNoScore).toBe(1)
  })
})

describe('an ASYNC DOM facade — the shape popup.js actually uses (chrome.scripting.executeScript returns promises)', () => {
  it('awaits each write and read, so an async facade verifies exactly like a sync one (never reporting every cell FAILED)', async () => {
    const plans = plansFor(3, [SGS_COLUMNS[0]])
    const grid = createFakeGrid()
    const syncFill = grid.diagnostic.fillSgsColumnValues
    const syncRead = grid.diagnostic.readSingleColumnCellValue
    const order: string[] = []

    // Promise-returning facade, exactly like prExecuteInPage.
    grid.diagnostic.fillSgsColumnValues = vi.fn(async (...args: unknown[]) => {
      order.push('write')
      await Promise.resolve()
      return (syncFill as unknown as (...a: unknown[]) => unknown)(...args)
    }) as unknown as typeof syncFill
    grid.diagnostic.readSingleColumnCellValue = vi.fn(async (...args: unknown[]) => {
      order.push('read')
      await Promise.resolve()
      return (syncRead as unknown as (...a: unknown[]) => unknown)(...args)
    }) as unknown as typeof syncRead

    const { outcomesByColumnKey } = await run(buildSequentialWriteInstructions(plans), grid)

    expect(outcomesByColumnKey['col-10-3'].map((o) => o.writeOutcome)).toEqual(['WRITTEN', 'WRITTEN', 'WRITTEN'])
    // Each write fully resolves before its own read-back is taken.
    expect(order).toEqual(['write', 'read', 'write', 'read', 'write', 'read'])
  })
})

/**
 * v1.0.0 REGRESSION LOCK — the exact case a real SGS page confirmed live:
 * 32 students, 4 selected/mapped columns, 128 candidate cells, 88 written,
 * 40 no-score, and 0 everything else (invalid/not-found/ambiguous/failed).
 * Per-column: 10 (max 10) 29 written/3 no-score; 11 (max 10) 20/12;
 * 12 (max 10) 19/13; ปลายภาค (max 30) 20/12. This exercises the FULL
 * pipeline this file already covers piece by piece — plan, preview,
 * sequential write + immediate read-back, and the final report — as one
 * frozen baseline for the proven grading engine.
 */
describe('LIVE-PROVEN PRODUCTION CASE — v1.0.0 regression lock', () => {
  const LIVE_SGS_COLUMNS = [
    { key: 'col-10-3', label: '10', columnIndex: 3, maxScore: 10 },
    { key: 'col-11-4', label: '11', columnIndex: 4, maxScore: 10 },
    { key: 'col-12-5', label: '12', columnIndex: 5, maxScore: 10 },
    { key: 'col-final-6', label: 'ปลายภาค', columnIndex: 6, maxScore: 30 },
  ]
  const LIVE_KRUNAME_COLUMNS = [
    { key: 'k1', label: 'ช่อง 10', maxScore: 10 },
    { key: 'k2', label: 'ช่อง 11', maxScore: 10 },
    { key: 'k3', label: 'ช่อง 12', maxScore: 10 },
    { key: 'k4', label: 'ปลายภาค', maxScore: 30 },
  ]

  /** Reproduces the exact per-column no-score counts the live run
   * reported (3/12/13/12 of the 32 students, respectively, had no
   * KrunameClass score for that column — everyone else did). */
  function buildLiveVerifiedScores(roster: ReturnType<typeof buildRoster>) {
    const noScoreCounts: Record<string, number> = { k1: 3, k2: 12, k3: 13, k4: 12 }
    const values: Record<string, number> = { k1: 8, k2: 9, k3: 7, k4: 25 }
    const scores: Record<string, Record<string, number | null>> = {}
    roster.forEach((student, index) => {
      scores[student.studentId] = {}
      for (const key of ['k1', 'k2', 'k3', 'k4']) {
        scores[student.studentId][key] = index < noScoreCounts[key] ? null : values[key]
      }
    })
    return scores
  }

  it('reproduces 128 candidate cells, 88 written, 40 no-score, 0 everything else — plan, preview, write, and final report all agree', async () => {
    const roster = buildRoster(32)
    const mappingResults = roster.map((student, index) => ({
      studentId: student.studentId,
      status: 'MATCHED' as const,
      matchedSgsRowKey: `row-${index}`,
      reason: 'จับคู่ด้วยรหัสนักเรียน',
    }))
    const matches = autoMatchColumns(LIVE_KRUNAME_COLUMNS, LIVE_SGS_COLUMNS)
    expect(matches.every((m) => m.status === 'AUTO')).toBe(true)

    const plans = buildMultiColumnPlan({
      roster,
      scoresByStudentIdAndColumnKey: buildLiveVerifiedScores(roster),
      mappingResults,
      matches,
      selectedSgsColumns: LIVE_SGS_COLUMNS,
      existingScoresByColumnKey: {},
      overwriteMode: 'skip_existing',
    })

    const preview = summarizeMultiColumnPreview(plans)
    expect(preview.columns).toBe(4)
    expect(preview.toWrite).toBe(88)
    expect(preview.noScore).toBe(40)
    expect(preview.skippedExisting).toBe(0)
    expect(preview.invalidScore).toBe(0)
    expect(preview.notFound).toBe(0)
    expect(preview.ambiguous).toBe(0)
    expect(preview.perColumn.map((c) => ({ label: c.sgsColumnLabel, toWrite: c.toWrite, noScore: c.noScore }))).toEqual([
      { label: '10', toWrite: 29, noScore: 3 },
      { label: '11', toWrite: 20, noScore: 12 },
      { label: '12', toWrite: 19, noScore: 13 },
      { label: 'ปลายภาค', toWrite: 20, noScore: 12 },
    ])

    const instructions = buildSequentialWriteInstructions(plans)
    expect(instructions.filter((i) => i.kind === 'WRITE_CELL')).toHaveLength(88)
    expect(roster.length * LIVE_SGS_COLUMNS.length).toBe(128)

    const grid = createFakeGrid()
    const { outcomesByColumnKey } = await run(instructions, grid)
    const report = summarizeMultiColumnRun(attachOutcomesToColumnPlans(plans, outcomesByColumnKey))

    expect(report.written).toBe(88)
    expect(report.skippedNoScore).toBe(40)
    expect(report.skippedExisting).toBe(0)
    expect(report.invalidScore).toBe(0)
    expect(report.notFound).toBe(0)
    expect(report.ambiguous).toBe(0)
    expect(report.failed).toBe(0)
    expect(report.perColumn.map((c) => ({ label: c.sgsColumnLabel, written: c.written }))).toEqual([
      { label: '10', written: 29 },
      { label: '11', written: 20 },
      { label: '12', written: 19 },
      { label: 'ปลายภาค', written: 20 },
    ])
  })
})
