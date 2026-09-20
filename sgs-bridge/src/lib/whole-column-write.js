/**
 * NEXT PHASE — safe WHOLE-COLUMN writing, now that the guarded
 * single-cell test has passed on the real SGS system. This module is the
 * pure planning/verification logic for "send ONE selected SGS score
 * column to every matched, currently-visible student" — it never touches
 * the DOM itself (that stays in content-diagnostic.js's existing
 * fillSgsColumnValues/readColumnValues, reused as-is, never modified for
 * this phase).
 *
 * STRUCTURAL "never cross columns" guarantee: every function here takes
 * exactly ONE columnIndex/columnKey and applies it to every row it
 * produces — there is no code path anywhere in this module capable of
 * emitting a write instruction for a second column, a total, a
 * percentage, a grade/status column, a remark, or a checkbox. The one
 * DOM-writing function this feeds (fillSgsColumnValues) takes a single
 * `columnIndex` parameter for its entire call, so even a caller bug here
 * could not smuggle a second column through.
 *
 * PAGINATION: this module only ever knows about "the current SGS page's
 * visible, matched rows" — it has no concept of a page boundary or of
 * writing across pages in one call. popup.js re-runs the whole scan ->
 * plan -> write pipeline once per visible page (semi-automatic: the
 * teacher opens the next SGS page and clicks "ดำเนินการต่อ" — see
 * popup.js's own doc comment on why automatic page navigation is not
 * attempted yet) and combines each page's summarizeWholeColumnResult via
 * mergeWholeColumnSummaries.
 */

/** Every status a preview row can show BEFORE any write is attempted.
 * READY is the only status that ever produces a write instruction. */
export const WHOLE_COLUMN_STATUS = {
  READY: 'READY',
  SKIP_NO_SCORE: 'SKIP_NO_SCORE',
  SKIP_EXISTING: 'SKIP_EXISTING',
  NOT_FOUND: 'NOT_FOUND',
  AMBIGUOUS: 'AMBIGUOUS',
  INVALID_SCORE: 'INVALID_SCORE',
}

/**
 * @param {{studentId: string, studentNumber: number|null, fullName: string, score: number|null}[]} krunameStudents
 * @param {ReturnType<typeof import('./mapping.js').matchStudentsToSgs>} mappingResults - same order/length as krunameStudents
 * @param {Record<string, number|null>} existingScoresBySgsRowKey - keyed by the matched row's sgsRowKey
 * @param {'skip_existing'|'overwrite_selected_column'} overwriteMode
 * @param {number|null} maxScore - the CONFIRMED real SGS column's max score (never the KrunameClass payload's own claimed max — the teacher may have picked a different real column)
 */
export function computeWholeColumnPlan(krunameStudents, mappingResults, existingScoresBySgsRowKey, overwriteMode, maxScore) {
  return krunameStudents.map((student, index) => {
    const mapping = mappingResults[index]
    const base = {
      studentId: student.studentId,
      studentNumber: student.studentNumber,
      fullName: student.fullName,
      krunameScore: student.score,
      matchedSgsRowKey: mapping.matchedSgsRowKey,
      mappingReason: mapping.reason,
    }

    // A student KrunameClass can't confidently place in the real SGS
    // table is NEVER written — there is no safe cell to write to,
    // whatever their KrunameClass score is.
    if (mapping.status === 'NOT_FOUND' || mapping.status === 'AMBIGUOUS') {
      return { ...base, sgsRowOffset: null, sgsExistingScore: null, status: mapping.status }
    }

    const sgsRowOffset = sgsRowOffsetFromKey(mapping.matchedSgsRowKey)
    const sgsExistingScore = Object.prototype.hasOwnProperty.call(existingScoresBySgsRowKey, mapping.matchedSgsRowKey)
      ? existingScoresBySgsRowKey[mapping.matchedSgsRowKey]
      : null

    if (student.score === null || student.score === undefined) {
      return { ...base, sgsRowOffset, sgsExistingScore, status: WHOLE_COLUMN_STATUS.SKIP_NO_SCORE }
    }
    // 0 is a real, intentional score — never treated the same as "no
    // score entered" (matches every other score-handling rule in this
    // codebase). Only explicitly out-of-range values are rejected.
    if (!Number.isFinite(student.score) || student.score < 0 || (maxScore !== null && maxScore !== undefined && student.score > maxScore)) {
      return { ...base, sgsRowOffset, sgsExistingScore, status: WHOLE_COLUMN_STATUS.INVALID_SCORE }
    }
    if (sgsExistingScore !== null && overwriteMode === 'skip_existing') {
      return { ...base, sgsRowOffset, sgsExistingScore, status: WHOLE_COLUMN_STATUS.SKIP_EXISTING }
    }
    return { ...base, sgsRowOffset, sgsExistingScore, status: WHOLE_COLUMN_STATUS.READY }
  })
}

/** Mirrors sgs-table-extraction.js's sgsRowIndexFromKey exactly (row-<n>
 * -> n) — duplicated here rather than imported so this module stays
 * import-free and trivially unit-testable; both must stay in sync with
 * buildSgsRowKey's own format. */
function sgsRowOffsetFromKey(sgsRowKey) {
  if (typeof sgsRowKey !== 'string') return null
  const match = /^row-(\d+)$/.exec(sgsRowKey)
  return match ? Number(match[1]) : null
}

export function formatSgsExistingScoreDisplay(row) {
  if (row.status === WHOLE_COLUMN_STATUS.NOT_FOUND || row.status === WHOLE_COLUMN_STATUS.AMBIGUOUS) {
    return 'ไม่ทราบ (ไม่พบแถวที่ตรงกัน)'
  }
  return row.sgsExistingScore === null ? 'ว่าง' : String(row.sgsExistingScore)
}

export function formatSgsNewValueDisplay(row) {
  return row.status === WHOLE_COLUMN_STATUS.READY ? String(row.krunameScore) : 'ไม่เปลี่ยน'
}

/**
 * The ONE place a "write this to SGS" instruction is ever produced for
 * whole-column mode. `columnIndex` is a single value applied to the
 * WHOLE `writesByOffset` map this returns — structurally, there is no
 * way for two different columns to appear in one call's output.
 *
 * @returns {{columnIndex: number, writesByOffset: Record<number, number>}}
 */
export function buildWholeColumnWriteInstructions(plan, columnIndex) {
  const writesByOffset = {}
  for (const row of plan) {
    if (row.status !== WHOLE_COLUMN_STATUS.READY) continue
    if (row.sgsRowOffset === null) continue
    writesByOffset[row.sgsRowOffset] = row.krunameScore
  }
  return { columnIndex, writesByOffset }
}

/**
 * The whole-column confirmation button's ONE gate — every condition
 * item 3 of the spec requires, checked together, returning the FIRST
 * failing reason (never a batch) so the UI always shows one unambiguous
 * next step. Deliberately does NOT check "every write candidate is
 * MATCHED" as a literal 100%-of-roster requirement — a genuinely
 * NOT_FOUND/AMBIGUOUS student is reported and skipped (per the preview's
 * own statuses), never a reason to block the OTHER, correctly-matched
 * students from being written. What DOES block confirmation outright is
 * any INVALID_SCORE row (a score exceeding this column's real max) and
 * zero READY rows (nothing to safely write at all).
 *
 * @param {{
 *   subjectClassroomOk: boolean,
 *   columnWritableNow: boolean,
 *   headerCheckboxOk: boolean,
 *   plan: ReturnType<typeof computeWholeColumnPlan>,
 * }} input
 */
export function evaluateWholeColumnPreconditions({ subjectClassroomOk, columnWritableNow, headerCheckboxOk, plan }) {
  if (!subjectClassroomOk) {
    return { ok: false, reason: 'รายวิชา/ห้องเรียนในหน้า SGS ไม่ตรงกับ Bridge Payload ที่โหลดไว้ กรุณาตรวจสอบ' }
  }
  if (!columnWritableNow) {
    return { ok: false, reason: 'คอลัมน์ที่เลือกไม่ใช่ช่องคะแนนที่กรอกได้จริงในขณะนี้ (writableScoreColumn)' }
  }
  if (!headerCheckboxOk) {
    return { ok: false, reason: 'กรุณาติ๊กเปิดช่องคะแนนนี้ด้วยตนเองใน SGS ก่อน แล้วกด "สแกนใหม่"' }
  }
  const invalidCount = plan.filter((row) => row.status === WHOLE_COLUMN_STATUS.INVALID_SCORE).length
  if (invalidCount > 0) {
    return { ok: false, reason: `มีคะแนนเกินคะแนนเต็มของคอลัมน์นี้ ${invalidCount} รายการ — กรุณาแก้ไขคะแนนใน KrunameClass ก่อน` }
  }
  const readyCount = plan.filter((row) => row.status === WHOLE_COLUMN_STATUS.READY).length
  if (readyCount === 0) {
    return { ok: false, reason: 'ไม่มีรายการที่พร้อมเขียนในหน้านี้ (นักเรียนทุกคนถูกข้ามหรือไม่พบ)' }
  }
  return { ok: true, reason: null }
}

/** The explicit consent gate — every precondition above AND the
 * teacher's freshly-read consent checkbox, in that order (a checked box
 * never substitutes for a missing precondition). */
export function canEnableWholeColumnWrite(preconditionsOk, consentChecked) {
  return preconditionsOk === true && consentChecked === true
}

/**
 * Combines the DOM write call's own report (fillSgsColumnValues:
 * `missingOffsets` — a cell that no longer had a writable input at write
 * time) with an immediate post-write READ-BACK of the same column
 * (readColumnValues) to decide WRITTEN vs FAILED per student — "record
 * success/failure per student" (item 5) means never trusting the write
 * call's own optimistic writtenCount alone; a value can be accepted by
 * `input.value = ...` and still not be what SGS's own JS ultimately kept
 * (e.g. its own validation reverting it), so the read-back is what
 * actually decides success.
 *
 * @param {ReturnType<typeof computeWholeColumnPlan>} plan
 * @param {Record<number, number>} writesByOffset - what was attempted (from buildWholeColumnWriteInstructions)
 * @param {{found: boolean, writtenCount: number, missingOffsets: number[]}} fillResult
 * @param {{found: boolean, values: Record<number, number|null>}} freshValuesResult
 */
export function verifyWholeColumnWrite(plan, writesByOffset, fillResult, freshValuesResult) {
  const missingOffsets = new Set((fillResult?.missingOffsets ?? []).map(Number))
  const freshValues = freshValuesResult?.values ?? {}
  return plan.map((row) => {
    if (row.status !== WHOLE_COLUMN_STATUS.READY) return { ...row, writeOutcome: null }
    const attempted = Object.prototype.hasOwnProperty.call(writesByOffset, row.sgsRowOffset)
    if (!attempted) return { ...row, writeOutcome: null }
    if (missingOffsets.has(row.sgsRowOffset)) return { ...row, writeOutcome: 'FAILED' }
    const expected = writesByOffset[row.sgsRowOffset]
    const actual = freshValues[row.sgsRowOffset] ?? null
    return { ...row, writeOutcome: actual === expected ? 'WRITTEN' : 'FAILED' }
  })
}

/** The exact six counts the result summary (item 6) requires, from ONE
 * page's verified plan. */
export function summarizeWholeColumnResult(verifiedPlan) {
  return {
    written: verifiedPlan.filter((row) => row.writeOutcome === 'WRITTEN').length,
    skippedNoScore: verifiedPlan.filter((row) => row.status === WHOLE_COLUMN_STATUS.SKIP_NO_SCORE).length,
    skippedExisting: verifiedPlan.filter((row) => row.status === WHOLE_COLUMN_STATUS.SKIP_EXISTING).length,
    notFound: verifiedPlan.filter((row) => row.status === WHOLE_COLUMN_STATUS.NOT_FOUND).length,
    ambiguous: verifiedPlan.filter((row) => row.status === WHOLE_COLUMN_STATUS.AMBIGUOUS).length,
    failed: verifiedPlan.filter((row) => row.writeOutcome === 'FAILED').length,
  }
}

/** Field-wise addition of two page summaries — the running total shown
 * across the semi-automatic multi-page flow (item 4/6: each SGS page is
 * processed and re-scanned separately, but the teacher sees ONE
 * cumulative result across every page they've completed so far). */
export function mergeWholeColumnSummaries(a, b) {
  return {
    written: a.written + b.written,
    skippedNoScore: a.skippedNoScore + b.skippedNoScore,
    skippedExisting: a.skippedExisting + b.skippedExisting,
    notFound: a.notFound + b.notFound,
    ambiguous: a.ambiguous + b.ambiguous,
    failed: a.failed + b.failed,
  }
}

export function emptyWholeColumnSummary() {
  return { written: 0, skippedNoScore: 0, skippedExisting: 0, notFound: 0, ambiguous: 0, failed: 0 }
}

/** "Show failed students clearly" (item 6) — every row whose write was
 * actually attempted and did NOT verify, from ONE page's verified plan. */
export function collectFailedStudents(verifiedPlan) {
  return verifiedPlan
    .filter((row) => row.writeOutcome === 'FAILED')
    .map((row) => ({ studentNumber: row.studentNumber, fullName: row.fullName }))
}

/**
 * Re-locates the confirmed column by its STABLE identity (its `key`,
 * derived from the label) among a FRESHLY-scanned page's
 * writableScoreColumns — a column's raw INDEX can differ from page to
 * page even for the exact same real column, so an index carried over
 * from a previous page/scan is never trusted. Returns null (an explicit
 * "this column can't be found on the current page right now" signal,
 * never a guess) when no match exists — e.g. its header checkbox got
 * unchecked, making it no longer a writableScoreColumn at all.
 */
export function locateColumnOnCurrentPage(writableScoreColumns, columnKey) {
  return writableScoreColumns.find((c) => c.key === columnKey) ?? null
}

/**
 * The whole-column "guard against stale DOM" check, performed
 * immediately before EVERY page's write — compares the context confirmed
 * when the teacher clicked "ยืนยัน" against a FRESH re-scan of the SAME
 * page taken right before writing it. Any drift (a different
 * subject/classroom now selected in SGS, or the column no longer being a
 * writableScoreColumn at all — e.g. its header checkbox got toggled off
 * since) means abort — never write into a page state this module can no
 * longer vouch for. `fresh.columnKey` is expected to already be the
 * result of `locateColumnOnCurrentPage(...)?.key ?? null` against the
 * SAME fresh scan, so "the column disappeared from writableScoreColumns"
 * and "a different column now sits at that key" are both naturally
 * caught by the one key comparison below — no separate checkbox field
 * needed, since writableScoreColumns membership already REQUIRES the
 * header checkbox to be checked (or absent) — see classifyScoreColumns'
 * own `writableNow` definition. Mirrors single-cell-test.js's
 * revalidateSingleCellTestContext, one level up (a whole page's write,
 * not one cell).
 *
 * @param {{subjectFilterText: string|null, classroomFilterText: string|null, columnKey: string}} confirmed
 * @param {{subjectFilterText: string|null, classroomFilterText: string|null, columnKey: string|null}} fresh
 */
export function revalidateWholeColumnContext(confirmed, fresh) {
  if (confirmed.subjectFilterText !== fresh.subjectFilterText) {
    return { ok: false, reason: 'ตัวกรองวิชาบนหน้า SGS เปลี่ยนไปตั้งแต่ตอนดูตัวอย่าง — ยกเลิกเพื่อความปลอดภัย' }
  }
  if (confirmed.classroomFilterText !== fresh.classroomFilterText) {
    return { ok: false, reason: 'ตัวกรองห้องเรียนบนหน้า SGS เปลี่ยนไปตั้งแต่ตอนดูตัวอย่าง — ยกเลิกเพื่อความปลอดภัย' }
  }
  if (confirmed.columnKey !== fresh.columnKey) {
    return {
      ok: false,
      reason: 'ไม่พบคอลัมน์ที่เลือกไว้เป็นช่องกรอกได้จริงในหน้านี้อีกต่อไป (อาจถูกปิดใช้งานใน SGS) — ยกเลิกเพื่อความปลอดภัย',
    }
  }
  return { ok: true, reason: null }
}
