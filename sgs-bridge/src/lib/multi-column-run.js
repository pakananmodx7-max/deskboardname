/**
 * PRODUCTION SINGLE-PAGE, MULTI-COLUMN RUN — the pure planning layer for
 * the production workflow: the teacher sets SGS to show the WHOLE
 * classroom on one page, picks one or MORE writable SGS score columns,
 * and sends them in a single run.
 *
 * Deliberately built by COMPOSING the already-proven single-column
 * planner (whole-column-write.js's computeWholeColumnPlan) once per
 * selected column, rather than re-implementing any of its rules. Every
 * safety property that module already guarantees therefore still holds
 * per column, unchanged:
 *   - 0 is a REAL score, never "no score" (and, as an EXISTING SGS
 *     value, never "empty" either — so it is skipped like any other
 *     existing score unless overwrite is explicitly enabled),
 *   - a score outside 0..maxScore is INVALID_SCORE and is never written,
 *   - a student SGS can't confidently place (NOT_FOUND/AMBIGUOUS) is
 *     never written, whatever their KrunameClass score is,
 *   - one call only ever carries ONE columnIndex into a write.
 *
 * What this module adds on top is exactly the multi-column concerns:
 * the all-students-visible gate, KrunameClass->SGS column mapping that
 * refuses to guess, a per-column plan bundle, and the preview/result
 * summaries. It never touches the DOM and never writes anything — the
 * sequential per-column, per-student write+read-back loop lives in
 * content-script.js, driven by the plans this module produces.
 *
 * PAGINATION is intentionally absent here: production mode requires the
 * whole classroom on one page (see evaluateAllStudentsVisibleGate), so
 * there is no page boundary for this module to reason about at all.
 */

import { computeWholeColumnPlan, WHOLE_COLUMN_STATUS } from './whole-column-write.js'

export { WHOLE_COLUMN_STATUS as MULTI_COLUMN_STATUS }

/** Shown when the SGS page is not currently displaying every student in
 * the classroom. Production mode NEVER navigates pages by itself — the
 * teacher raises SGS's own "rows per page" instead. */
export const ALL_STUDENTS_MUST_BE_VISIBLE_MESSAGE = 'กรุณาตั้งจำนวนรายการต่อหน้าใน SGS ให้แสดงนักเรียนทั้งห้องก่อน'

/**
 * The production safety gate: every student in the classroom must be
 * visible on the CURRENT SGS page (32 visible / 32 total = READY). An
 * unknown total is never treated as "probably fine" — it fails, because
 * a run that silently covers only part of a classroom is exactly what
 * this gate exists to prevent.
 */
export function evaluateAllStudentsVisibleGate({ visibleStudentRows, totalStudentRows }) {
  const visible = Number.isFinite(visibleStudentRows) ? visibleStudentRows : null
  const total = Number.isFinite(totalStudentRows) ? totalStudentRows : null
  if (visible === null || total === null) {
    return { ok: false, visible, total, reason: ALL_STUDENTS_MUST_BE_VISIBLE_MESSAGE }
  }
  if (visible !== total) {
    return { ok: false, visible, total, reason: ALL_STUDENTS_MUST_BE_VISIBLE_MESSAGE }
  }
  return { ok: true, visible, total, reason: null }
}

export const COLUMN_MAPPING_STATUS = {
  /** Exactly one SGS column matched this KrunameClass column's label. */
  AUTO: 'AUTO',
  /** The teacher chose this pairing explicitly. */
  MANUAL: 'MANUAL',
  /** More than one SGS column matched — NEVER auto-resolved. */
  AMBIGUOUS: 'AMBIGUOUS',
  /** No SGS column matched, and the teacher has not chosen one. */
  UNMAPPED: 'UNMAPPED',
}

/**
 * Label normalisation used ONLY to find an exact, unambiguous pairing:
 * case/space-insensitive, and with the Thai "ช่อง"/"ช่องที่"/"คะแนน"
 * prefixes a KrunameClass column label commonly carries removed, so
 * "ช่อง 10" and SGS's own "10" are recognised as the same column. It
 * never strips anything that could make two DIFFERENT columns collapse
 * into one — and even when it does produce a collision, the result is
 * AMBIGUOUS (below), never a guess.
 */
export function normalizeColumnLabel(label) {
  if (typeof label !== 'string') return ''
  return label
    .trim()
    .toLowerCase()
    .replace(/^ช่องที่/, '')
    .replace(/^ช่อง/, '')
    .replace(/^คะแนน/, '')
    .replace(/\s+/g, '')
}

/**
 * Pairs each KrunameClass column with an SGS column by exact normalised
 * label. "Never guess an ambiguous mapping": two or more SGS columns
 * matching the same label yields AMBIGUOUS with every candidate listed
 * for the teacher to choose from — a maxScore tiebreak would still be a
 * guess, so it is deliberately not attempted.
 */
export function autoMatchColumns(krunameColumns, sgsColumns) {
  return krunameColumns.map((krunameColumn) => {
    const normalized = normalizeColumnLabel(krunameColumn.label)
    const candidates = normalized === '' ? [] : sgsColumns.filter((sgs) => normalizeColumnLabel(sgs.label) === normalized)

    if (candidates.length === 1) {
      return {
        krunameColumnKey: krunameColumn.key,
        krunameColumnLabel: krunameColumn.label,
        sgsColumnKey: candidates[0].key,
        status: COLUMN_MAPPING_STATUS.AUTO,
        candidates: candidates.map((c) => c.key),
      }
    }
    return {
      krunameColumnKey: krunameColumn.key,
      krunameColumnLabel: krunameColumn.label,
      sgsColumnKey: null,
      status: candidates.length > 1 ? COLUMN_MAPPING_STATUS.AMBIGUOUS : COLUMN_MAPPING_STATUS.UNMAPPED,
      candidates: candidates.map((c) => c.key),
    }
  })
}

/**
 * The teacher's own explicit choices always win over (and resolve) an
 * AUTO/AMBIGUOUS/UNMAPPED result. A manual choice for a column that was
 * ambiguous is exactly how an ambiguous pairing is meant to be settled.
 */
export function applyManualColumnMapping(matches, manualByKrunameKey) {
  const manual = manualByKrunameKey ?? {}
  return matches.map((match) => {
    if (!Object.prototype.hasOwnProperty.call(manual, match.krunameColumnKey)) return match
    const chosen = manual[match.krunameColumnKey]
    if (chosen === null || chosen === undefined || chosen === '') {
      return { ...match, sgsColumnKey: null, status: COLUMN_MAPPING_STATUS.UNMAPPED }
    }
    return { ...match, sgsColumnKey: chosen, status: COLUMN_MAPPING_STATUS.MANUAL }
  })
}

/**
 * Every SELECTED SGS column must end up with exactly one resolved
 * KrunameClass source before a run may start. Returns the FIRST blocking
 * reason (never a batch) so the UI always shows one unambiguous next
 * step — an ambiguous pairing blocks outright rather than being
 * silently dropped from the run.
 */
export function evaluateColumnMappingReadiness(matches, selectedSgsColumnKeys) {
  const selected = selectedSgsColumnKeys ?? []
  if (selected.length === 0) {
    return { ok: false, reason: 'ยังไม่ได้เลือกคอลัมน์คะแนนของ SGS แม้แต่คอลัมน์เดียว' }
  }

  const ambiguous = matches.find((m) => m.status === COLUMN_MAPPING_STATUS.AMBIGUOUS && selected.includes(m.sgsColumnKey ?? ''))
  const ambiguousAny = matches.find((m) => m.status === COLUMN_MAPPING_STATUS.AMBIGUOUS)
  if (ambiguous || (ambiguousAny && ambiguousAny.candidates.some((key) => selected.includes(key)))) {
    const blocking = ambiguous ?? ambiguousAny
    return {
      ok: false,
      reason: `จับคู่คอลัมน์ "${blocking.krunameColumnLabel}" กับ SGS ไม่ได้อย่างชัดเจน — กรุณาเลือกคอลัมน์ SGS ที่ต้องการด้วยตนเอง`,
    }
  }

  const resolvedKeys = matches.filter((m) => m.sgsColumnKey !== null).map((m) => m.sgsColumnKey)
  const missing = selected.find((key) => !resolvedKeys.includes(key))
  if (missing !== undefined) {
    return { ok: false, reason: `คอลัมน์ SGS ที่เลือกไว้ยังไม่มีคอลัมน์คะแนนของ KrunameClass จับคู่ไว้ — กรุณาเลือกให้ครบก่อน` }
  }

  const duplicated = resolvedKeys.filter((key, index) => selected.includes(key) && resolvedKeys.indexOf(key) !== index)
  if (duplicated.length > 0) {
    return { ok: false, reason: 'มีคอลัมน์ SGS ที่ถูกจับคู่ซ้ำมากกว่าหนึ่งช่องคะแนน — กรุณาแก้ไขการจับคู่ก่อน' }
  }

  return { ok: true, reason: null }
}

/**
 * One plan bundle per SELECTED SGS column, in the order the columns will
 * actually be written (see orderColumnsForSequentialWrite). Each
 * column's rows come from the proven single-column planner, fed that
 * column's OWN maxScore and that column's OWN KrunameClass scores — a
 * column's max score is never applied to another column's values.
 *
 * @param {{
 *   roster: {studentId: string, studentNumber: number|null, studentCode: string|null, fullName: string}[],
 *   scoresByStudentIdAndColumnKey: Record<string, Record<string, number|null>>,
 *   mappingResults: ReturnType<typeof import('./mapping.js').matchStudentsToSgs>,
 *   matches: ReturnType<typeof autoMatchColumns>,
 *   selectedSgsColumns: {key: string, label: string, columnIndex: number, maxScore: number|null}[],
 *   existingScoresByColumnKey: Record<string, Record<string, number|null>>,
 *   overwriteMode: 'skip_existing'|'overwrite_selected_column',
 * }} input
 */
export function buildMultiColumnPlan({
  roster,
  scoresByStudentIdAndColumnKey,
  mappingResults,
  matches,
  selectedSgsColumns,
  existingScoresByColumnKey,
  overwriteMode,
}) {
  return orderColumnsForSequentialWrite(selectedSgsColumns).map((sgsColumn) => {
    const match = matches.find((m) => m.sgsColumnKey === sgsColumn.key) ?? null
    const krunameColumnKey = match?.krunameColumnKey ?? null

    // Each column is planned from the SAME roster, but projected onto
    // that column's own per-student score — this is the only place a
    // multi-column payload's scoresByColumnKey becomes the single
    // `score` field the proven single-column planner expects.
    const studentsForColumn = roster.map((student) => ({
      ...student,
      score: krunameColumnKey === null ? null : (scoresByStudentIdAndColumnKey?.[student.studentId]?.[krunameColumnKey] ?? null),
    }))

    const plan = computeWholeColumnPlan(
      studentsForColumn,
      mappingResults,
      existingScoresByColumnKey?.[sgsColumn.key] ?? {},
      overwriteMode,
      sgsColumn.maxScore,
    )

    return {
      sgsColumnKey: sgsColumn.key,
      sgsColumnLabel: sgsColumn.label,
      sgsColumnIndex: sgsColumn.columnIndex,
      maxScore: sgsColumn.maxScore,
      krunameColumnKey,
      krunameColumnLabel: match?.krunameColumnLabel ?? null,
      plan,
    }
  })
}

/**
 * The write order: stable and deterministic (by the column's own
 * left-to-right position on the SGS page, then by key), so a run's
 * "Column A fully finishes before Column B starts" sequence is the same
 * every time and is never dependent on checkbox click order.
 */
export function orderColumnsForSequentialWrite(selectedSgsColumns) {
  return [...selectedSgsColumns].sort((a, b) => {
    const aIndex = Number.isFinite(a.columnIndex) ? a.columnIndex : Number.MAX_SAFE_INTEGER
    const bIndex = Number.isFinite(b.columnIndex) ? b.columnIndex : Number.MAX_SAFE_INTEGER
    if (aIndex !== bIndex) return aIndex - bIndex
    return String(a.key).localeCompare(String(b.key))
  })
}

function countStatus(plan, status) {
  return plan.filter((row) => row.status === status).length
}

/**
 * The ONE pre-write preview (step 7): totals across every selected
 * column, plus the exact per-column breakdown the teacher confirms
 * against. `wouldOverwrite` answers "existing SGS scores that WOULD be
 * overwritten if overwrite is enabled" in BOTH modes — in skip mode
 * those rows are currently SKIP_EXISTING; in overwrite mode they are
 * READY rows that already hold an existing value (0 included).
 */
export function summarizeMultiColumnPreview(columnPlans) {
  const perColumn = columnPlans.map((column) => ({
    sgsColumnKey: column.sgsColumnKey,
    sgsColumnLabel: column.sgsColumnLabel,
    krunameColumnLabel: column.krunameColumnLabel,
    maxScore: column.maxScore,
    toWrite: countStatus(column.plan, WHOLE_COLUMN_STATUS.READY),
    noScore: countStatus(column.plan, WHOLE_COLUMN_STATUS.SKIP_NO_SCORE),
    skippedExisting: countStatus(column.plan, WHOLE_COLUMN_STATUS.SKIP_EXISTING),
    wouldOverwrite:
      countStatus(column.plan, WHOLE_COLUMN_STATUS.SKIP_EXISTING) +
      column.plan.filter((row) => row.status === WHOLE_COLUMN_STATUS.READY && row.sgsExistingScore !== null).length,
    invalidScore: countStatus(column.plan, WHOLE_COLUMN_STATUS.INVALID_SCORE),
    notFound: countStatus(column.plan, WHOLE_COLUMN_STATUS.NOT_FOUND),
    ambiguous: countStatus(column.plan, WHOLE_COLUMN_STATUS.AMBIGUOUS),
  }))

  const sum = (field) => perColumn.reduce((total, column) => total + column[field], 0)
  return {
    columns: perColumn.length,
    toWrite: sum('toWrite'),
    noScore: sum('noScore'),
    skippedExisting: sum('skippedExisting'),
    wouldOverwrite: sum('wouldOverwrite'),
    invalidScore: sum('invalidScore'),
    notFound: sum('notFound'),
    ambiguous: sum('ambiguous'),
    perColumn,
  }
}

/**
 * The final report (step 12): the seven required totals across the whole
 * run, plus the per-column line each selected column contributes. Built
 * from each column's VERIFIED rows (every READY row carries the
 * writeOutcome its own immediate read-back produced), never from what
 * was merely attempted.
 */
export function summarizeMultiColumnRun(columnResults) {
  const perColumn = columnResults.map((column) => ({
    sgsColumnKey: column.sgsColumnKey,
    sgsColumnLabel: column.sgsColumnLabel,
    written: column.verifiedPlan.filter((row) => row.writeOutcome === 'WRITTEN').length,
    skippedNoScore: countStatus(column.verifiedPlan, WHOLE_COLUMN_STATUS.SKIP_NO_SCORE),
    skippedExisting: countStatus(column.verifiedPlan, WHOLE_COLUMN_STATUS.SKIP_EXISTING),
    invalidScore: countStatus(column.verifiedPlan, WHOLE_COLUMN_STATUS.INVALID_SCORE),
    notFound: countStatus(column.verifiedPlan, WHOLE_COLUMN_STATUS.NOT_FOUND),
    ambiguous: countStatus(column.verifiedPlan, WHOLE_COLUMN_STATUS.AMBIGUOUS),
    failed: column.verifiedPlan.filter((row) => row.writeOutcome === 'FAILED').length,
  }))

  const sum = (field) => perColumn.reduce((total, column) => total + column[field], 0)
  return {
    columns: perColumn.length,
    written: sum('written'),
    skippedNoScore: sum('skippedNoScore'),
    skippedExisting: sum('skippedExisting'),
    invalidScore: sum('invalidScore'),
    notFound: sum('notFound'),
    ambiguous: sum('ambiguous'),
    failed: sum('failed'),
    perColumn,
  }
}

/**
 * The production run's own confirmation gate (step 8's prerequisite):
 * the visibility gate, the column mapping, and the plans themselves must
 * all be sound before the teacher can confirm. Returns the FIRST
 * blocking reason. An INVALID_SCORE anywhere blocks the WHOLE run — a
 * score outside a column's range means the KrunameClass data needs
 * fixing first, and silently dropping just that student would hide it.
 */
export function evaluateMultiColumnRunPreconditions({ visibilityGate, mappingReadiness, columnPlans }) {
  if (!visibilityGate?.ok) {
    return { ok: false, reason: visibilityGate?.reason ?? ALL_STUDENTS_MUST_BE_VISIBLE_MESSAGE }
  }
  if (!mappingReadiness?.ok) {
    return { ok: false, reason: mappingReadiness?.reason ?? 'การจับคู่คอลัมน์ยังไม่พร้อม' }
  }
  if (!columnPlans || columnPlans.length === 0) {
    return { ok: false, reason: 'ยังไม่ได้เลือกคอลัมน์คะแนนของ SGS แม้แต่คอลัมน์เดียว' }
  }

  const invalidColumn = columnPlans.find((column) => countStatus(column.plan, WHOLE_COLUMN_STATUS.INVALID_SCORE) > 0)
  if (invalidColumn) {
    const count = countStatus(invalidColumn.plan, WHOLE_COLUMN_STATUS.INVALID_SCORE)
    return {
      ok: false,
      reason: `คอลัมน์ "${invalidColumn.sgsColumnLabel}" มีคะแนนไม่ถูกต้อง ${count} รายการ (ต้องอยู่ระหว่าง 0 ถึง ${invalidColumn.maxScore}) — กรุณาแก้ไขใน KrunameClass ก่อน`,
    }
  }

  const totalReady = columnPlans.reduce((total, column) => total + countStatus(column.plan, WHOLE_COLUMN_STATUS.READY), 0)
  if (totalReady === 0) {
    return { ok: false, reason: 'ไม่มีคะแนนที่พร้อมส่งในคอลัมน์ที่เลือก (ทุกรายการถูกข้ามหรือไม่พบนักเรียน)' }
  }

  return { ok: true, reason: null }
}

/**
 * Step 9's per-cell instruction stream, flattened in the exact order the
 * writes happen: every student of column A (verified one by one), then
 * COLUMN_COMPLETE for A, then column B, and so on. Only READY rows ever
 * appear — a skipped/invalid/unmatched row has no cell to write, so it
 * can never reach the DOM layer at all, and a failure on one cell can
 * never shift a later cell onto the wrong row or column because every
 * instruction carries its own explicit columnIndex + rowOffset.
 */
export function buildSequentialWriteInstructions(columnPlans) {
  const instructions = []
  for (const column of columnPlans) {
    for (const row of column.plan) {
      if (row.status !== WHOLE_COLUMN_STATUS.READY) continue
      if (row.sgsRowOffset === null || row.sgsRowOffset === undefined) continue
      instructions.push({
        kind: 'WRITE_CELL',
        sgsColumnKey: column.sgsColumnKey,
        sgsColumnLabel: column.sgsColumnLabel,
        columnIndex: column.sgsColumnIndex,
        maxScore: column.maxScore,
        sgsRowOffset: row.sgsRowOffset,
        studentId: row.studentId,
        studentNumber: row.studentNumber,
        fullName: row.fullName,
        score: row.krunameScore,
      })
    }
    instructions.push({ kind: 'COLUMN_COMPLETE', sgsColumnKey: column.sgsColumnKey, sgsColumnLabel: column.sgsColumnLabel })
  }
  return instructions
}
