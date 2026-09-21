/**
 * SGS Score Calculator — derives ONE sgs_score_columns value from MANY
 * existing assignment scores (see src/services/assignment-service.ts).
 * This is KrunameClass score-PREPARATION only: it reads assignment
 * scores, writes only to `sgs_scores` (via the SAME setSgsScore already
 * used for manual entry — see sgs-score-workspace-service.ts), and never
 * touches assignment_submissions, attendance, another SGS column, or any
 * other subject/classroom. It has nothing to do with sgs-bridge/, which
 * stays completely unmodified — see the calculation service's own doc
 * comment for the full pipeline: raw scores -> this calculator ->
 * teacher preview/approval -> an sgs_score_columns column -> the
 * EXISTING, unchanged multi-column export -> SGS Bridge v1.0.0.
 *
 * Only ASSIGNMENT scores (assignment-service.ts's canonical
 * getAssignments/getSubmissions) are supported as a source right now —
 * the one source type the spec's own example uses (ใบงาน, Quiz,
 * กิจกรรม, สอบหน่วย are all assignments). Nothing here reads attendance
 * or any other data.
 */

export type SgsScoreCalculationMode = 'proportional' | 'weighted_groups' | 'individual_weights'

export const SGS_SCORE_CALCULATION_MODE_LABEL: Record<SgsScoreCalculationMode, string> = {
  proportional: 'คิดตามสัดส่วนคะแนนรวม',
  weighted_groups: 'กำหนดน้ำหนักเป็นกลุ่ม',
  individual_weights: 'กำหนดน้ำหนักแต่ละรายการ',
}

/** How a student missing ONE OR MORE of the selected raw scores is
 * handled. `treat_as_zero` counts the missing item as 0 (still counted
 * in the denominator); `exclude` drops that item from BOTH the
 * numerator and denominator for that student only — a numeric score of
 * 0 is never affected by either policy, since 0 is a real score, never
 * "missing." */
export type SgsScoreCalculationMissingPolicy = 'treat_as_zero' | 'exclude'

export const SGS_SCORE_CALCULATION_MISSING_POLICY_LABEL: Record<SgsScoreCalculationMissingPolicy, string> = {
  treat_as_zero: 'ถือเป็น 0 คะแนน',
  exclude: 'ไม่นำรายการที่ไม่มีคะแนนมาคำนวณ',
}

export type SgsScoreCalculationRounding = 'none' | 'one_decimal' | 'two_decimal' | 'integer'

export const SGS_SCORE_CALCULATION_ROUNDING_LABEL: Record<SgsScoreCalculationRounding, string> = {
  none: 'ไม่ปัด',
  one_decimal: '1 ตำแหน่ง',
  two_decimal: '2 ตำแหน่ง',
  integer: 'จำนวนเต็ม',
}

export const DEFAULT_SGS_SCORE_CALCULATION_ROUNDING: SgsScoreCalculationRounding = 'one_decimal'
export const DEFAULT_SGS_SCORE_CALCULATION_MISSING_POLICY: SgsScoreCalculationMissingPolicy = 'treat_as_zero'

/** One weighted group (MODE B) — e.g. "งาน/กิจกรรม 40%" made of several
 * source assignments, normalized independently before its weight is
 * applied. */
export interface SgsScoreCalculationGroup {
  id: string
  label: string
  weightPercent: number
  sourceAssignmentIds: string[]
}

/** One individually-weighted source (MODE C) — e.g. "Quiz 20%". */
export interface SgsScoreCalculationWeight {
  assignmentId: string
  weightPercent: number
}

interface SgsScoreCalculationFormulaBase {
  /** The `sgs_score_columns.id` this formula produces a value for. */
  targetColumnId: string
  /** That column's OWN max score at the time the formula was saved —
   * re-validated against the column's current maxScore before every
   * recalculation (see validateCalculationConfig), never assumed. */
  targetMaxScore: number
  missingScorePolicy: SgsScoreCalculationMissingPolicy
  rounding: SgsScoreCalculationRounding
}

export type SgsScoreCalculationFormula =
  | (SgsScoreCalculationFormulaBase & { mode: 'proportional'; sourceAssignmentIds: string[] })
  | (SgsScoreCalculationFormulaBase & { mode: 'weighted_groups'; groups: SgsScoreCalculationGroup[] })
  | (SgsScoreCalculationFormulaBase & { mode: 'individual_weights'; weights: SgsScoreCalculationWeight[] })

/** One raw source score this calculator can draw from — always an
 * assignment right now (see the module doc comment). */
export interface SgsScoreCalculationSource {
  assignmentId: string
  label: string
  maxScore: number
}

/** Per-student result of applying a formula. `ok` carries everything the
 * preview table shows for that student; `blocked` covers both "no usable
 * source data" (missing_data) and "the raw math produced something
 * outside 0..targetMaxScore" (out_of_range) — NEVER silently clamped or
 * substituted, per the spec's explicit safety rule. */
export type SgsStudentCalculationResult =
  | {
      status: 'ok'
      usedTotal: number
      usedMax: number
      percent: number
      calculatedScore: number
    }
  | {
      status: 'blocked'
      reason: 'missing_data' | 'out_of_range'
      message: string
    }

export interface SgsScoreCalculationPreviewRow {
  studentId: string
  studentNumber: number | null
  fullName: string
  result: SgsStudentCalculationResult
}

export interface SgsScoreCalculationPreviewSummary {
  totalStudents: number
  calculable: number
  missingData: number
  average: number | null
  highest: number | null
  lowest: number | null
}

export interface SgsScoreCalculationPreview {
  summary: SgsScoreCalculationPreviewSummary
  rows: SgsScoreCalculationPreviewRow[]
}

export interface SgsScoreCalculationConfigValidation {
  ok: boolean
  reason: string | null
}
