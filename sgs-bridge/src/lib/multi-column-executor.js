/**
 * PRODUCTION SINGLE-PAGE, MULTI-COLUMN RUN — the sequential write
 * engine (step 9). Consumes the instruction stream
 * multi-column-run.js's buildSequentialWriteInstructions produces and
 * performs it strictly one cell at a time:
 *
 *   Column A -> student 1 write -> immediate read-back verify
 *            -> student 2 write -> verify -> ... -> COLUMN_COMPLETE
 *   Column B -> same, only after A has completely finished
 *
 * It NEVER batch-writes several columns (or several students) in one
 * call: every write is a single-entry `writesByOffset` carrying exactly
 * one row offset, against exactly one columnIndex, immediately followed
 * by a read-back of that SAME cell. A cell whose read-back does not
 * return the exact value written is recorded FAILED and the run moves on
 * to the NEXT instruction — which still carries its own explicit
 * columnIndex/rowOffset, so one cell failing can never shift a later
 * write onto the wrong row or the wrong column.
 *
 * The DOM itself is reached only through the injected `diagnostic`
 * facade (content-diagnostic.js's already-audited
 * fillSgsColumnValues/readSingleColumnCellValue, passed in unchanged by
 * content-script.js) — which is also what makes this whole sequence
 * executable in tests without a browser.
 */

export const RUN_EVENT = {
  COLUMN_BEGIN: 'COLUMN_BEGIN',
  CELL_WRITTEN: 'CELL_WRITTEN',
  CELL_FAILED: 'CELL_FAILED',
  COLUMN_COMPLETE: 'COLUMN_COMPLETE',
  STOPPED: 'STOPPED',
}

/**
 * @param {{
 *   instructions: ReturnType<typeof import('./multi-column-run.js').buildSequentialWriteInstructions>,
 *   diagnostic: {fillSgsColumnValues: Function, readSingleColumnCellValue: Function},
 *   tableIndex: number,
 *   runStartIndex: number,
 *   settle?: () => Promise<void>,
 *   onEvent?: (event: {type: string, [k: string]: unknown}) => void|Promise<void>,
 *   shouldStop?: () => boolean|Promise<boolean>,
 * }} input
 */
export async function executeSequentialColumnRun({ instructions, diagnostic, tableIndex, runStartIndex, settle, onEvent, shouldStop }) {
  const emit = async (event) => {
    if (onEvent) await onEvent(event)
  }
  const outcomesByColumnKey = {}
  let startedColumnKey = null
  let stopped = false

  for (const instruction of instructions) {
    if (instruction.kind === 'COLUMN_COMPLETE') {
      if (startedColumnKey === instruction.sgsColumnKey) {
        await emit({
          type: RUN_EVENT.COLUMN_COMPLETE,
          sgsColumnKey: instruction.sgsColumnKey,
          sgsColumnLabel: instruction.sgsColumnLabel,
          outcomes: outcomesByColumnKey[instruction.sgsColumnKey] ?? [],
        })
        startedColumnKey = null
      }
      if (stopped) break
      continue
    }

    if (stopped) continue

    // The teacher's Stop is honoured BETWEEN cells only — never
    // mid-write, so a cell is always left either fully written and
    // verified, or not attempted at all.
    if (shouldStop && (await shouldStop())) {
      stopped = true
      await emit({ type: RUN_EVENT.STOPPED, sgsColumnKey: instruction.sgsColumnKey })
      continue
    }

    if (startedColumnKey !== instruction.sgsColumnKey) {
      startedColumnKey = instruction.sgsColumnKey
      outcomesByColumnKey[instruction.sgsColumnKey] = outcomesByColumnKey[instruction.sgsColumnKey] ?? []
      await emit({ type: RUN_EVENT.COLUMN_BEGIN, sgsColumnKey: instruction.sgsColumnKey, sgsColumnLabel: instruction.sgsColumnLabel })
    }

    // ONE cell: one row offset, one columnIndex. Never a batch.
    const writesByOffset = { [instruction.sgsRowOffset]: instruction.score }
    let writeResult = null
    let readResult = null
    let error = null
    try {
      // Both are awaited: the live popup reaches the page through
      // chrome.scripting.executeScript, so each of these is a PROMISE
      // there (and a plain value in tests). Awaiting also guarantees the
      // write has actually landed before its own read-back is taken.
      writeResult = await diagnostic.fillSgsColumnValues(tableIndex, runStartIndex, instruction.columnIndex, writesByOffset)
      if (settle) await settle()
      readResult = await diagnostic.readSingleColumnCellValue(tableIndex, runStartIndex + instruction.sgsRowOffset, instruction.columnIndex)
    } catch (err) {
      error = String(err)
    }

    const missing = Boolean(writeResult?.missingOffsets?.includes(instruction.sgsRowOffset))
    const actualValue = readResult?.found ? readResult.value : null
    const verified = error === null && !missing && actualValue === instruction.score

    const outcome = {
      studentId: instruction.studentId,
      studentNumber: instruction.studentNumber,
      fullName: instruction.fullName,
      sgsColumnKey: instruction.sgsColumnKey,
      columnIndex: instruction.columnIndex,
      sgsRowOffset: instruction.sgsRowOffset,
      score: instruction.score,
      actualValue,
      writeOutcome: verified ? 'WRITTEN' : 'FAILED',
      error,
    }
    outcomesByColumnKey[instruction.sgsColumnKey] = outcomesByColumnKey[instruction.sgsColumnKey] ?? []
    outcomesByColumnKey[instruction.sgsColumnKey].push(outcome)

    await emit({ type: verified ? RUN_EVENT.CELL_WRITTEN : RUN_EVENT.CELL_FAILED, ...outcome })
  }

  return { outcomesByColumnKey, stopped }
}

/**
 * Folds the executor's per-cell outcomes back onto the ORIGINAL plans,
 * so every planned row (written, failed, or never attempted because it
 * was skipped/invalid/unmatched) carries its final writeOutcome — the
 * exact shape summarizeMultiColumnRun expects for the final report. A
 * row that produced no instruction keeps `writeOutcome: null`, never a
 * fabricated success.
 */
export function attachOutcomesToColumnPlans(columnPlans, outcomesByColumnKey) {
  return columnPlans.map((column) => {
    const byOffset = new Map((outcomesByColumnKey?.[column.sgsColumnKey] ?? []).map((outcome) => [outcome.sgsRowOffset, outcome]))
    return {
      sgsColumnKey: column.sgsColumnKey,
      sgsColumnLabel: column.sgsColumnLabel,
      verifiedPlan: column.plan.map((row) => {
        const outcome = row.sgsRowOffset === null || row.sgsRowOffset === undefined ? undefined : byOffset.get(row.sgsRowOffset)
        return { ...row, writeOutcome: outcome ? outcome.writeOutcome : null }
      }),
    }
  })
}
