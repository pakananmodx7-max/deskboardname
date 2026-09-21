import { getAssignments, getSubmissions } from '@/services/assignment-service'
import { setSgsScore } from '@/services/sgs-score-workspace-service'
import type {
  SgsScoreCalculationConfigValidation,
  SgsScoreCalculationFormula,
  SgsScoreCalculationGroup,
  SgsScoreCalculationPreview,
  SgsScoreCalculationRounding,
  SgsScoreCalculationSource,
  SgsScoreCalculationWeight,
  SgsStudentCalculationResult,
} from '@/types/sgs-score-calculation'

/**
 * SGS Score Calculator — pure math + planning only (no React, no DOM).
 * See src/types/sgs-score-calculation.ts's own doc comment for the full
 * pipeline this sits in. The only stateful/IO functions in this whole
 * file are getSgsScoreCalculationSources (wraps the EXISTING, canonical
 * getAssignments/getSubmissions — never a new score-retrieval query) and
 * applySgsScoreCalculation (writes through the EXISTING setSgsScore —
 * never a new write primitive). Every other export is a pure function
 * over plain data, independently testable without a live Supabase
 * connection.
 *
 * WEIGHTED MODES, ONE RULE FOR BOTH: a "group" (mode B) and an
 * "individually weighted item" (mode C) are the same underlying concept
 * — a set of one or more sources with its own weight — so both modes
 * share this rule: EVERY group/item must have at least one usable score
 * for a student, or that student's whole result is `missing_data`. Under
 * `exclude`, this means one missing item you explicitly weighted blocks
 * the calculation rather than silently reweighting the rest — the
 * teacher configured a specific weight for that piece and nothing here
 * ever substitutes a different one.
 */

// ==================================================
// Low-level pure math (the suggested function names)
// ==================================================

/** MODE A: `(studentSelectedScoreTotal / selectedMaximumTotal) *
 * targetSgsMaxScore` — the exact formula from the spec. Caller must
 * never call this with `usedMax <= 0`. */
export function calculateProportionalScore(usedTotal: number, usedMax: number, targetMaxScore: number): number {
  return (usedTotal / usedMax) * targetMaxScore
}

function weightedFractionScore(items: { fraction: number; weightPercent: number }[], targetMaxScore: number): number {
  const weightedSum = items.reduce((sum, item) => sum + item.fraction * item.weightPercent, 0) / 100
  return weightedSum * targetMaxScore
}

/** MODE B: each group's fraction is ALREADY normalized independently
 * (total/max within that group only) before this runs — this function
 * only applies each group's weight and sums. */
export function calculateWeightedGroupScore(groupFractions: { fraction: number; weightPercent: number }[], targetMaxScore: number): number {
  return weightedFractionScore(groupFractions, targetMaxScore)
}

/** MODE C: identical math to MODE B, with each individually-weighted
 * item standing in for a singleton group of its own. Kept as its own
 * named export (rather than a bare alias) so it is independently
 * testable, per item 12/13 of the spec. */
export function calculateIndividualWeightedScore(itemFractions: { fraction: number; weightPercent: number }[], targetMaxScore: number): number {
  return weightedFractionScore(itemFractions, targetMaxScore)
}

export function applyRounding(value: number, rounding: SgsScoreCalculationRounding): number {
  switch (rounding) {
    case 'none':
      return value
    case 'integer':
      return Math.round(value)
    case 'one_decimal':
      return Math.round(value * 10) / 10
    case 'two_decimal':
      return Math.round(value * 100) / 100
  }
}

// ==================================================
// Per-student calculation
// ==================================================

const OUT_OF_RANGE_EPSILON = 1e-9

function totalsForSources(
  ids: string[],
  scoresByAssignmentId: Record<string, number | null>,
  sourcesById: Map<string, SgsScoreCalculationSource>,
  missingPolicy: SgsScoreCalculationFormula['missingScorePolicy'],
): { total: number; max: number } | null {
  let total = 0
  let max = 0
  let any = false
  for (const id of ids) {
    const source = sourcesById.get(id)
    if (!source) continue
    // A numeric 0 is a REAL score — `?? null` only ever substitutes for
    // an actually-missing (undefined) entry, never for 0 itself.
    const raw = scoresByAssignmentId[id] ?? null
    if (raw === null) {
      if (missingPolicy === 'treat_as_zero') {
        max += source.maxScore
        any = true
      }
      // exclude: this source contributes nothing to either total or max.
      continue
    }
    total += raw
    max += source.maxScore
    any = true
  }
  if (!any || max === 0) return null
  return { total, max }
}

function sourceLabel(id: string, sourcesById: Map<string, SgsScoreCalculationSource>): string {
  return sourcesById.get(id)?.label ?? id
}

/** The single per-student entry point every mode goes through. Never
 * mutates its inputs, never touches anything outside this one
 * calculation — see the module doc comment for the shared weighted-mode
 * rule. */
export function calculateStudentSgsScore(
  formula: SgsScoreCalculationFormula,
  scoresByAssignmentId: Record<string, number | null>,
  sources: SgsScoreCalculationSource[],
): SgsStudentCalculationResult {
  const sourcesById = new Map(sources.map((s) => [s.assignmentId, s]))

  let raw: number
  let display: { total: number; max: number } | null

  if (formula.mode === 'proportional') {
    const totals = totalsForSources(formula.sourceAssignmentIds, scoresByAssignmentId, sourcesById, formula.missingScorePolicy)
    if (!totals) {
      return { status: 'blocked', reason: 'missing_data', message: 'ไม่มีคะแนนต้นทางที่ใช้คำนวณได้สำหรับนักเรียนคนนี้' }
    }
    raw = calculateProportionalScore(totals.total, totals.max, formula.targetMaxScore)
    display = totals
  } else if (formula.mode === 'weighted_groups') {
    const fractions: { fraction: number; weightPercent: number }[] = []
    const allIds: string[] = []
    for (const group of formula.groups) {
      const totals = totalsForSources(group.sourceAssignmentIds, scoresByAssignmentId, sourcesById, formula.missingScorePolicy)
      if (!totals) {
        return { status: 'blocked', reason: 'missing_data', message: `กลุ่ม "${group.label}" ไม่มีคะแนนต้นทางที่ใช้คำนวณได้สำหรับนักเรียนคนนี้` }
      }
      fractions.push({ fraction: totals.total / totals.max, weightPercent: group.weightPercent })
      allIds.push(...group.sourceAssignmentIds)
    }
    raw = calculateWeightedGroupScore(fractions, formula.targetMaxScore)
    display = totalsForSources(allIds, scoresByAssignmentId, sourcesById, formula.missingScorePolicy)
  } else {
    const fractions: { fraction: number; weightPercent: number }[] = []
    const allIds: string[] = []
    for (const weight of formula.weights) {
      const totals = totalsForSources([weight.assignmentId], scoresByAssignmentId, sourcesById, formula.missingScorePolicy)
      if (!totals) {
        return {
          status: 'blocked',
          reason: 'missing_data',
          message: `"${sourceLabel(weight.assignmentId, sourcesById)}" ไม่มีคะแนนที่ใช้คำนวณได้สำหรับนักเรียนคนนี้`,
        }
      }
      fractions.push({ fraction: totals.total / totals.max, weightPercent: weight.weightPercent })
      allIds.push(weight.assignmentId)
    }
    raw = calculateIndividualWeightedScore(fractions, formula.targetMaxScore)
    display = totalsForSources(allIds, scoresByAssignmentId, sourcesById, formula.missingScorePolicy)
  }

  const rounded = applyRounding(raw, formula.rounding)

  // NEVER silently clamped — a result outside 0..targetMaxScore is
  // reported and blocked, not corrected, so the teacher sees exactly
  // why (see spec item 9). The epsilon only absorbs floating-point
  // noise from the arithmetic above, never a genuine overage.
  if (rounded < -OUT_OF_RANGE_EPSILON || rounded > formula.targetMaxScore + OUT_OF_RANGE_EPSILON) {
    return {
      status: 'blocked',
      reason: 'out_of_range',
      message: `คะแนนที่คำนวณได้ (${rounded}) เกินช่วงคะแนนเต็มของช่องนี้ (0-${formula.targetMaxScore}) — ตรวจสอบคะแนนต้นทาง`,
    }
  }
  const calculatedScore = Math.min(Math.max(rounded, 0), formula.targetMaxScore)

  return {
    status: 'ok',
    usedTotal: display?.total ?? 0,
    usedMax: display?.max ?? 0,
    percent: formula.targetMaxScore > 0 ? (calculatedScore / formula.targetMaxScore) * 100 : 0,
    calculatedScore,
  }
}

// ==================================================
// Whole-class preview
// ==================================================

/**
 * Runs calculateStudentSgsScore for every roster student. Pure —
 * students/scores/sources are exactly what the caller already fetched
 * (getSgsScoreCalculationSources + getStudentsByClassroom), scoped to
 * whichever subject+classroom that fetch was scoped to; this function
 * has no way to reach outside that.
 */
export function calculateClassPreview(
  formula: SgsScoreCalculationFormula,
  roster: { studentId: string; studentNumber: number | null; fullName: string }[],
  scoresByStudentIdAndAssignmentId: Record<string, Record<string, number | null>>,
  sources: SgsScoreCalculationSource[],
): SgsScoreCalculationPreview {
  const rows = roster.map((student) => ({
    studentId: student.studentId,
    studentNumber: student.studentNumber,
    fullName: student.fullName,
    result: calculateStudentSgsScore(formula, scoresByStudentIdAndAssignmentId[student.studentId] ?? {}, sources),
  }))

  const okResults = rows.map((r) => r.result).filter((r): r is Extract<SgsStudentCalculationResult, { status: 'ok' }> => r.status === 'ok')
  const scores = okResults.map((r) => r.calculatedScore)

  return {
    summary: {
      totalStudents: rows.length,
      calculable: okResults.length,
      missingData: rows.length - okResults.length,
      average: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      highest: scores.length > 0 ? Math.max(...scores) : null,
      lowest: scores.length > 0 ? Math.min(...scores) : null,
    },
    rows,
  }
}

// ==================================================
// Config validation
// ==================================================

const WEIGHT_TOTAL_TOLERANCE_PERCENT = 0.01

function sumWeights(items: { weightPercent: number }[]): number {
  return items.reduce((sum, item) => sum + item.weightPercent, 0)
}

function everyIdKnown(ids: string[], available: Set<string>): boolean {
  return ids.every((id) => available.has(id))
}

/** Checked BEFORE every calculation (preview or recalculation) — never
 * just at save time — so a source that was later archived/deleted, or
 * weights that no longer sum to 100%, are caught instead of silently
 * mis-calculating. */
export function validateCalculationConfig(formula: SgsScoreCalculationFormula, availableAssignmentIds: string[]): SgsScoreCalculationConfigValidation {
  const available = new Set(availableAssignmentIds)

  if (formula.mode === 'proportional') {
    if (formula.sourceAssignmentIds.length === 0) {
      return { ok: false, reason: 'กรุณาเลือกคะแนนต้นทางอย่างน้อย 1 รายการ' }
    }
    if (!everyIdKnown(formula.sourceAssignmentIds, available)) {
      return { ok: false, reason: 'มีคะแนนต้นทางที่เลือกไว้ไม่อยู่ในวิชา/ห้องเรียนนี้แล้ว กรุณาเลือกใหม่' }
    }
    return { ok: true, reason: null }
  }

  if (formula.mode === 'weighted_groups') {
    return validateGroups(formula.groups, available)
  }

  return validateWeights(formula.weights, available)
}

function validateGroups(groups: SgsScoreCalculationGroup[], available: Set<string>): SgsScoreCalculationConfigValidation {
  if (groups.length === 0) {
    return { ok: false, reason: 'กรุณาสร้างกลุ่มอย่างน้อย 1 กลุ่ม' }
  }
  for (const group of groups) {
    if (group.sourceAssignmentIds.length === 0) {
      return { ok: false, reason: `กลุ่ม "${group.label}" ยังไม่มีคะแนนต้นทาง` }
    }
    if (!everyIdKnown(group.sourceAssignmentIds, available)) {
      return { ok: false, reason: `กลุ่ม "${group.label}" มีคะแนนต้นทางที่ไม่อยู่ในวิชา/ห้องเรียนนี้แล้ว กรุณาเลือกใหม่` }
    }
  }
  const total = sumWeights(groups)
  if (Math.abs(total - 100) > WEIGHT_TOTAL_TOLERANCE_PERCENT) {
    return { ok: false, reason: `น้ำหนักรวมของทุกกลุ่มต้องเท่ากับ 100% (ขณะนี้รวม ${total}%)` }
  }
  return { ok: true, reason: null }
}

function validateWeights(weights: SgsScoreCalculationWeight[], available: Set<string>): SgsScoreCalculationConfigValidation {
  if (weights.length === 0) {
    return { ok: false, reason: 'กรุณาเลือกคะแนนต้นทางอย่างน้อย 1 รายการ' }
  }
  const ids = weights.map((w) => w.assignmentId)
  if (new Set(ids).size !== ids.length) {
    return { ok: false, reason: 'มีคะแนนต้นทางถูกกำหนดน้ำหนักซ้ำกันมากกว่าหนึ่งครั้ง' }
  }
  if (!everyIdKnown(ids, available)) {
    return { ok: false, reason: 'มีคะแนนต้นทางที่เลือกไว้ไม่อยู่ในวิชา/ห้องเรียนนี้แล้ว กรุณาเลือกใหม่' }
  }
  const total = sumWeights(weights)
  if (Math.abs(total - 100) > WEIGHT_TOTAL_TOLERANCE_PERCENT) {
    return { ok: false, reason: `น้ำหนักรวมต้องเท่ากับ 100% (ขณะนี้รวม ${total}%)` }
  }
  return { ok: true, reason: null }
}

// ==================================================
// Applying an approved preview — existing-value skip / overwrite
// ==================================================

export type SgsScoreCalculationApplyAction = 'write' | 'skip_existing' | 'skip_not_calculable'

export interface SgsScoreCalculationApplyPlanRow {
  studentId: string
  action: SgsScoreCalculationApplyAction
  calculatedScore: number | null
}

/** Section 10's rule: a student whose target column already holds a
 * value is skipped by default; only `overwriteExisting: true` writes
 * over it. A student the preview could not calculate is never written,
 * regardless of overwrite. */
export function planSgsScoreCalculationApply(
  preview: SgsScoreCalculationPreview,
  existingScoresByStudentId: Record<string, number | null>,
  overwriteExisting: boolean,
): SgsScoreCalculationApplyPlanRow[] {
  return preview.rows.map((row) => {
    if (row.result.status !== 'ok') {
      return { studentId: row.studentId, action: 'skip_not_calculable', calculatedScore: null }
    }
    const existing = existingScoresByStudentId[row.studentId] ?? null
    if (existing !== null && !overwriteExisting) {
      return { studentId: row.studentId, action: 'skip_existing', calculatedScore: row.result.calculatedScore }
    }
    return { studentId: row.studentId, action: 'write', calculatedScore: row.result.calculatedScore }
  })
}

/** How many students already hold a value in the target column — shown
 * before applying ("ช่องนี้มีคะแนนอยู่แล้ว X คน"), never computed
 * silently after the fact. */
export function countExistingTargetScores(existingScoresByStudentId: Record<string, number | null>): number {
  return Object.values(existingScoresByStudentId).filter((score) => score !== null).length
}

/** One row that failed to persist, and why — never swallowed, never
 * folded into a single generic thrown error that hides which students
 * actually saved. */
export interface SgsScoreCalculationApplyFailure {
  studentId: string
  message: string
}

export interface SgsScoreCalculationApplyResult {
  written: number
  failed: SgsScoreCalculationApplyFailure[]
}

/**
 * The ONLY function in this file that writes anything — and it writes
 * through the EXISTING setSgsScore (sgs-score-workspace-service.ts),
 * the same primitive manual score entry already uses, one student at a
 * time, for the SELECTED column only. Never touches any other column,
 * assignment_submissions, attendance, or another subject/classroom.
 *
 * ATOMICITY/SAFETY: the existing setSgsScore is a per-student upsert —
 * there is no existing batch/transactional variant to reuse, and this
 * never invents one. What this DOES guarantee: every planned row is
 * ATTEMPTED regardless of an earlier row's failure (never silently
 * abandoning the rest of the class after one bad row), and every
 * failure is reported individually instead of one thrown error hiding
 * how many students actually saved. The caller
 * (score-calculation-modal.tsx) decides what "success" means from
 * `written`/`failed` — it never infers success merely from this
 * function not throwing.
 */
export async function applySgsScoreCalculation(
  columnId: string,
  plan: SgsScoreCalculationApplyPlanRow[],
  // Defaults to the EXISTING setSgsScore in every real call site — this
  // parameter exists only so the regression test can execute the real
  // per-row attempt/collect-failures loop (the actual bug's own logic)
  // without a live Supabase connection, the same dependency-injection
  // shape sgs-bridge's own executeSequentialColumnRun already uses for
  // the identical reason. Never anything other than setSgsScore in
  // production.
  write: (columnId: string, studentId: string, score: number | null) => Promise<void> = setSgsScore,
): Promise<SgsScoreCalculationApplyResult> {
  const toWrite = plan.filter((row) => row.action === 'write')
  let written = 0
  const failed: SgsScoreCalculationApplyFailure[] = []
  for (const row of toWrite) {
    try {
      await write(columnId, row.studentId, row.calculatedScore)
      written += 1
    } catch (err) {
      failed.push({ studentId: row.studentId, message: err instanceof Error ? err.message : String(err) })
    }
  }
  return { written, failed }
}

// ==================================================
// Source retrieval — wraps the EXISTING canonical assignment score
// query (assignment-service.ts's getAssignments/getSubmissions), never
// a new/parallel score-retrieval path. Only active (non-archived)
// assignments are offered as calculator sources.
// ==================================================

export async function getSgsScoreCalculationSources(
  subjectId: string,
  classroomId: string,
): Promise<{
  sources: SgsScoreCalculationSource[]
  scoresByStudentIdAndAssignmentId: Record<string, Record<string, number | null>>
}> {
  const assignments = await getAssignments(subjectId, classroomId)
  const activeAssignments = assignments.filter((a) => !a.isArchived)
  const submissionsByAssignment = await Promise.all(activeAssignments.map((a) => getSubmissions(a.id)))

  const sources: SgsScoreCalculationSource[] = activeAssignments.map((a) => ({
    assignmentId: a.id,
    label: a.title,
    maxScore: a.maxScore,
  }))

  const scoresByStudentIdAndAssignmentId: Record<string, Record<string, number | null>> = {}
  activeAssignments.forEach((assignment, index) => {
    for (const [studentId, submission] of Object.entries(submissionsByAssignment[index])) {
      scoresByStudentIdAndAssignmentId[studentId] ??= {}
      scoresByStudentIdAndAssignmentId[studentId][assignment.id] = submission.score
    }
  })

  return { sources, scoresByStudentIdAndAssignmentId }
}
