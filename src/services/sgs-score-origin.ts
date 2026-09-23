import type {
  ResolvedSgsScoreCell,
  SgsScoreCellAction,
  SgsScoreCellRecord,
  SgsScoreRecalculationValue,
} from '@/types/sgs-score-workspace'

/**
 * SGS score origin — pure rules only (no I/O). The database is the
 * authority: supabase/migrations/0027_sgs_score_origin.sql's RPCs compute
 * every write server-side. Every function here MIRRORS that SQL exactly
 * (see sgs-score-origin.test.ts, and supabase/tests/0027_sgs_score_origin.sql
 * for the same scenarios run against a real Postgres), so the UI can
 * describe a cell, and the tests can model a sequence of actions,
 * without ever inventing a rule the database doesn't enforce.
 *
 * 0 IS A REAL SCORE. Every existence test below is `=== null` /
 * `!== null` — never truthiness.
 */

/** effectiveScore = overrideScore ?? (suppressed ? null : calculatedScore). */
export function computeEffectiveSgsScore(overrideScore: number | null, autoSuppressed: boolean, calculatedScore: number | null): number | null {
  if (overrideScore !== null) return overrideScore
  if (autoSuppressed) return null
  return calculatedScore
}

const EMPTY_RECORD: SgsScoreCellRecord = {
  score: null,
  calculatedScore: null,
  overrideScore: null,
  autoSuppressed: false,
  calculatedAt: null,
}

/**
 * Mirrors sgs_score_reconcile_legacy (0027): when `score` was written
 * directly (a pre-0027 row, an older client, or the legacy setSgsScore)
 * and no longer matches the derived effective value, that direct write
 * is the teacher's intent — a value becomes an override, a clear becomes
 * a suppression. Before migration 0027 every non-null score therefore
 * resolves to OVERRIDE (a teacher-owned value), which is exactly how the
 * backfill classifies it too.
 */
export function reconcileLegacySgsScore(record: SgsScoreCellRecord): SgsScoreCellRecord {
  const derived = computeEffectiveSgsScore(record.overrideScore, record.autoSuppressed, record.calculatedScore)
  if (record.score === derived) return record
  if (record.score !== null) return { ...record, overrideScore: record.score, autoSuppressed: false }
  return { ...record, overrideScore: null, autoSuppressed: true }
}

export function resolveSgsScoreCell(record: SgsScoreCellRecord | undefined): ResolvedSgsScoreCell {
  const r = reconcileLegacySgsScore(record ?? EMPTY_RECORD)
  const effectiveScore = computeEffectiveSgsScore(r.overrideScore, r.autoSuppressed, r.calculatedScore)
  const origin = r.overrideScore !== null ? 'override' : effectiveScore !== null ? 'auto' : 'empty'
  return {
    origin,
    effectiveScore,
    calculatedScore: r.calculatedScore,
    overrideScore: r.overrideScore,
    autoSuppressed: r.overrideScore === null && r.autoSuppressed,
    calculatedAt: r.calculatedAt,
  }
}

/** Mirrors set_sgs_score_cell (0027). Returns `undefined` for a
 * clear_override on a cell with no row (the RPC creates nothing). */
export function applySgsScoreCellAction(
  record: SgsScoreCellRecord | undefined,
  action: SgsScoreCellAction,
  value: number | null = null,
): SgsScoreCellRecord | undefined {
  if (record === undefined && action === 'clear_override') return undefined
  const r = reconcileLegacySgsScore(record ?? EMPTY_RECORD)
  let overrideScore: number | null
  let autoSuppressed: boolean
  if (action === 'override') {
    if (value === null) throw new Error('override requires a value')
    overrideScore = value
    autoSuppressed = false
  } else if (action === 'clear_override') {
    overrideScore = null
    autoSuppressed = false
  } else {
    overrideScore = null
    autoSuppressed = true
  }
  return {
    ...r,
    overrideScore,
    autoSuppressed,
    score: computeEffectiveSgsScore(overrideScore, autoSuppressed, r.calculatedScore),
  }
}

/** Mirrors ONE entry of recalculate_sgs_score_column (0027). Returns
 * `undefined` (no row created) for a not-calculable student who had no
 * row. `calculatedAt` is the caller-supplied timestamp. */
export function applySgsScoreRecalculation(
  record: SgsScoreCellRecord | undefined,
  value: Omit<SgsScoreRecalculationValue, 'studentId'>,
  calculatedAt: string,
): SgsScoreCellRecord | undefined {
  if (record === undefined && value.calculatedScore === null) return undefined
  const r = reconcileLegacySgsScore(record ?? EMPTY_RECORD)
  const overrideScore = value.clearOverride ? null : r.overrideScore
  const autoSuppressed = value.clearOverride ? false : r.autoSuppressed
  return {
    score: computeEffectiveSgsScore(overrideScore, autoSuppressed, value.calculatedScore),
    calculatedScore: value.calculatedScore,
    overrideScore,
    autoSuppressed,
    calculatedAt,
  }
}

/** Mirrors reset_sgs_score_column_to_auto (0027) for one column's rows. */
export function applySgsScoreColumnReset(recordsByStudentId: Record<string, SgsScoreCellRecord>): {
  records: Record<string, SgsScoreCellRecord>
  changed: number
} {
  const records: Record<string, SgsScoreCellRecord> = {}
  let changed = 0
  for (const [studentId, original] of Object.entries(recordsByStudentId)) {
    const r = reconcileLegacySgsScore(original)
    if (r.overrideScore === null && !r.autoSuppressed) {
      records[studentId] = original
      continue
    }
    records[studentId] = { ...r, overrideScore: null, autoSuppressed: false, score: r.calculatedScore }
    changed += 1
  }
  return { records, changed }
}

export interface SgsScoreColumnResetImpact {
  /** Cells holding a teacher-entered value that will be removed. */
  overrides: number
  /** Cells the teacher had cancelled the calculation for. */
  suppressed: number
  /** Of the above, how many end up EMPTY because there is no calculated
   * value to fall back to — shown in the confirmation so the teacher is
   * never surprised by a blank. */
  becomeEmpty: number
}

export function computeSgsScoreColumnResetImpact(cells: Record<string, ResolvedSgsScoreCell>): SgsScoreColumnResetImpact {
  let overrides = 0
  let suppressed = 0
  let becomeEmpty = 0
  for (const cell of Object.values(cells)) {
    if (cell.origin === 'override') overrides += 1
    else if (cell.autoSuppressed) suppressed += 1
    else continue
    if (cell.calculatedScore === null) becomeEmpty += 1
  }
  return { overrides, suppressed, becomeEmpty }
}

/** The effective score per student — what SGS export, the send preview
 * and read-back verification all consume. */
export function effectiveScoresFromCells(cells: Record<string, ResolvedSgsScoreCell>): Record<string, number | null> {
  const scores: Record<string, number | null> = {}
  for (const [studentId, cell] of Object.entries(cells)) scores[studentId] = cell.effectiveScore
  return scores
}

/** A cell the teacher owns a decision on (a value or an explicit
 * "leave empty") — the calculator never overwrites these unless the
 * teacher confirms "เขียนทับคะแนนเดิม". */
export function isTeacherDecidedSgsCell(cell: ResolvedSgsScoreCell): boolean {
  return cell.origin === 'override' || cell.autoSuppressed
}

/** The persisted calculated value no longer matches what the CURRENT
 * source scores calculate to — the UI flags it ("คะแนนต้นทางเปลี่ยน")
 * and offers คำนวณใหม่. Only meaningful for a cell that has been
 * calculated at least once. `live === undefined` means "no live value
 * available" (formula not loaded/invalid), never a change. */
export function hasSgsCalculationDrift(cell: ResolvedSgsScoreCell, live: number | null | undefined): boolean {
  if (live === undefined || cell.calculatedAt === null) return false
  return cell.calculatedScore !== live
}

// ==================================================
// Direct typing into a cell (the table's number input)
// ==================================================

export type SgsScoreCellInputIntent =
  | { kind: 'noop' }
  | { kind: 'override'; value: number }
  | { kind: 'clear_override' }
  /** Blank typed over an AUTO value: the mapping is never silently
   * broken by an empty input — the UI explains the explicit
   * "ยกเลิกการคำนวณสำหรับนักเรียนคนนี้" action instead. */
  | { kind: 'blank_on_auto' }

/** What typing `parsed` (already validated: a number in range, or null
 * for a blank input) into `cell` means. Re-entering the current
 * effective value is a no-op — blurring an AUTO cell without changing it
 * must NEVER silently turn it into an override. */
export function interpretSgsScoreCellInput(cell: ResolvedSgsScoreCell, parsed: number | null): SgsScoreCellInputIntent {
  if (parsed !== null) {
    return parsed === cell.effectiveScore && cell.origin !== 'empty' ? { kind: 'noop' } : { kind: 'override', value: parsed }
  }
  if (cell.origin === 'override') return { kind: 'clear_override' }
  if (cell.origin === 'auto') return { kind: 'blank_on_auto' }
  return { kind: 'noop' }
}

// ==================================================
// Cell actions offered in the "ที่มาคะแนน" dialog
// ==================================================

export type SgsScoreCellMenuAction = 'edit' | 'recalculate' | 'override' | 'restore_auto' | 'clear' | 'suppress_auto'

export const SGS_SCORE_CELL_MENU_LABEL: Record<SgsScoreCellMenuAction, string> = {
  edit: 'แก้คะแนน',
  recalculate: 'คำนวณใหม่จากงานต้นทาง',
  override: 'กรอกคะแนนทับ',
  restore_auto: 'กลับไปใช้คะแนนคำนวณ',
  clear: 'ล้างคะแนน',
  suppress_auto: 'ยกเลิกการคำนวณสำหรับนักเรียนคนนี้',
}

export const SGS_SCORE_ORIGIN_TOOLTIP = {
  auto: 'คำนวณจากงานที่เชื่อม',
  override: 'ครูกำหนดคะแนนเอง',
} as const

/**
 * Which actions make sense for a cell. `hasFormula` = the column has a
 * source mapping (calculation_formula). `supportsOrigin` = migration
 * 0027 is applied; without it only plain edit/clear exist (the pre-0027
 * behavior). Never offers an action that would be a no-op.
 */
export function getSgsScoreCellMenuActions(cell: ResolvedSgsScoreCell, hasFormula: boolean, supportsOrigin: boolean): SgsScoreCellMenuAction[] {
  if (!supportsOrigin) {
    return cell.effectiveScore !== null ? ['edit', 'clear'] : ['edit']
  }
  if (!hasFormula) {
    return cell.overrideScore !== null ? ['edit', 'clear'] : ['edit']
  }
  const actions: SgsScoreCellMenuAction[] = ['recalculate']
  if (cell.origin === 'override') {
    // Removing the teacher value falls back to the calculated value when
    // there is one ("กลับไปใช้คะแนนคำนวณ"), otherwise the cell simply
    // becomes empty ("ล้างคะแนน") — same underlying clear_override.
    actions.push('edit', cell.calculatedScore !== null ? 'restore_auto' : 'clear', 'suppress_auto')
  } else if (cell.origin === 'auto') {
    actions.push('override', 'suppress_auto')
  } else if (cell.autoSuppressed) {
    actions.push('override', 'restore_auto')
  } else {
    actions.push('override')
  }
  return actions
}
