import { computeLiveCalculatedScores, getSgsScoreCalculationSources, listFormulaSourceIds } from '@/services/sgs-score-calculation-service'
import {
  getSgsScoreCellsForColumns,
  getSgsScoreColumnFormulas,
  getSgsScoreColumns,
  recalculateSgsScoreColumn,
  type SgsScoreCellsLoad,
} from '@/services/sgs-score-workspace-service'
import { getStudentsByClassroom } from '@/services/student-service'
import { resolveSgsScoreCell } from '@/services/sgs-score-origin'
import type { SgsScoreCalculationFormula } from '@/types/sgs-score-calculation'
import type { ResolvedSgsScoreCell, SgsScoreCellRecord, SgsScoreColumn, SgsScoreRecalculationValue } from '@/types/sgs-score-workspace'
import type { ClassroomStudent } from '@/types/student'

/**
 * SGS AUTO — keeps calculated SGS columns in step with their source
 * assignments, on top of migration 0027's RPCs (no new data model):
 *
 *   - recalculateSgsColumnsForAssignments: after an assignment score is
 *     saved, recalculates ONLY the SGS columns whose saved mapping
 *     (calculation_formula, 0025) reads one of the changed assignments.
 *     calculated_score is refreshed for every student; overrides and
 *     per-student suppression are always kept (clear_override is never
 *     sent from here), so an OVERRIDE cell keeps its effective score while
 *     the value underneath stays current.
 *   - createSgsAutoRecalculationScheduler: coalesces a burst of saves into
 *     one run per subject+classroom and never runs two at once, so a
 *     later save always triggers a run that reads the newer scores.
 *   - convertSgsScoreColumnToAuto: the teacher's explicit
 *     "เปลี่ยนคอลัมน์นี้เป็นคำนวณอัตโนมัติ" — recalculates from FRESH sources
 *     and clears that column's overrides in ONE atomic RPC call.
 *
 * Every IO dependency is injectable (see SgsAutoDeps) so the rules are
 * tested without a live Supabase connection. Nothing here ever touches
 * assignment_submissions, another subject/classroom, or sgs-bridge/.
 */

// ==================================================
// Dependencies
// ==================================================

export interface SgsAutoDeps {
  getColumns: (subjectId: string, classroomId: string) => Promise<SgsScoreColumn[]>
  getFormulas: (subjectId: string, classroomId: string) => Promise<Record<string, SgsScoreCalculationFormula | null>>
  getSources: (subjectId: string, classroomId: string) => ReturnType<typeof getSgsScoreCalculationSources>
  getStudents: (classroomId: string) => Promise<Pick<ClassroomStudent, 'id'>[]>
  getCells: (columnIds: string[]) => Promise<SgsScoreCellsLoad>
  recalculate: (columnId: string, values: SgsScoreRecalculationValue[]) => Promise<number>
}

export const defaultSgsAutoDeps: SgsAutoDeps = {
  getColumns: getSgsScoreColumns,
  getFormulas: getSgsScoreColumnFormulas,
  getSources: getSgsScoreCalculationSources,
  getStudents: getStudentsByClassroom,
  getCells: getSgsScoreCellsForColumns,
  recalculate: recalculateSgsScoreColumn,
}

// ==================================================
// Pure planning
// ==================================================

/** The columns whose saved mapping reads at least one of
 * `assignmentIds` — the ONLY columns a source-score save may touch. */
export function selectSgsColumnsAffectedByAssignments(
  columns: SgsScoreColumn[],
  formulasByColumnId: Record<string, SgsScoreCalculationFormula | null>,
  assignmentIds: string[],
): { column: SgsScoreColumn; formula: SgsScoreCalculationFormula }[] {
  const changed = new Set(assignmentIds)
  const affected: { column: SgsScoreColumn; formula: SgsScoreCalculationFormula }[] = []
  for (const column of columns) {
    const formula = formulasByColumnId[column.id]
    if (!formula) continue
    if (listFormulaSourceIds(formula).some((id) => changed.has(id))) affected.push({ column, formula })
  }
  return affected
}

/**
 * Values for recalculate_sgs_score_column after a source change: only
 * students whose calculated value actually differs from the stored one
 * (0 !== null, so a real 0 is always written). clearOverride is never
 * set — overrides and suppression are preserved by the RPC.
 */
export function planSgsAutoRecalculationValues(
  studentIds: string[],
  cells: Record<string, SgsScoreCellRecord>,
  live: Record<string, number | null>,
): SgsScoreRecalculationValue[] {
  const values: SgsScoreRecalculationValue[] = []
  for (const studentId of studentIds) {
    const next = live[studentId] ?? null
    const current = cells[studentId]?.calculatedScore ?? null
    if (next !== current) values.push({ studentId, calculatedScore: next })
  }
  return values
}

export interface SgsColumnConvertToAutoPlan {
  values: SgsScoreRecalculationValue[]
  /** Override cells whose teacher value is removed. */
  overridesCleared: number
  /** Suppressed cells re-enabled (only with clearSuppressed). */
  suppressedCleared: number
  /** Cleared cells that end up EMPTY because nothing is calculable. */
  becomeEmpty: number
}

/**
 * "เปลี่ยนคอลัมน์นี้เป็นคำนวณอัตโนมัติ": every roster student gets the
 * current calculated value; override cells additionally get
 * clearOverride, so their effective score becomes that value. A
 * per-student "ยกเลิกการคำนวณ" is a separate explicit decision and is kept
 * unless clearSuppressed is set.
 */
export function planSgsColumnConvertToAuto(
  studentIds: string[],
  cells: Record<string, SgsScoreCellRecord>,
  live: Record<string, number | null>,
  options: { clearSuppressed?: boolean } = {},
): SgsColumnConvertToAutoPlan {
  const values: SgsScoreRecalculationValue[] = []
  let overridesCleared = 0
  let suppressedCleared = 0
  let becomeEmpty = 0
  for (const studentId of studentIds) {
    const record = cells[studentId]
    const cell = resolveSgsScoreCell(record)
    const calculatedScore = live[studentId] ?? null
    const isOverride = cell.origin === 'override'
    const clearSuppression = !isOverride && cell.autoSuppressed && options.clearSuppressed === true
    const clearOverride = isOverride || clearSuppression
    if (isOverride) overridesCleared += 1
    if (clearSuppression) suppressedCleared += 1
    if (clearOverride && calculatedScore === null) becomeEmpty += 1
    // A student with no row and nothing calculable has nothing to record.
    if (!record && calculatedScore === null) continue
    values.push({ studentId, calculatedScore, clearOverride })
  }
  return { values, overridesCleared, suppressedCleared, becomeEmpty }
}

/** Override count for the confirmation text — from the cells already on
 * screen (the operation itself re-reads them). */
export function countSgsOverrideCells(cells: Record<string, ResolvedSgsScoreCell>): number {
  return Object.values(cells).filter((cell) => cell.origin === 'override').length
}

export function describeSgsConvertToAutoConfirmation(overrideCount: number): string {
  return `คะแนนที่ครูกำหนดเองของนักเรียน ${overrideCount} คนจะถูกล้าง และระบบจะคำนวณคะแนนใหม่จากงานที่เชื่อมไว้`
}

// ==================================================
// Recalculation after a source-assignment save
// ==================================================

export interface SgsAutoColumnOutcome {
  columnId: string
  label: string
  /** Rows written by recalculate_sgs_score_column. */
  updated: number
}

export type SgsAutoRecalculationResult =
  | {
      status: 'done'
      updated: SgsAutoColumnOutcome[]
      /** Mapped to a changed assignment but not runnable as saved (source
       * archived/deleted, weights invalid, column max changed). */
      needsReconfigure: { columnId: string; label: string }[]
      failed: { columnId: string; label: string; message: string }[]
    }
  | { status: 'no_affected_columns' }
  /** 0025 (saved mappings) or 0027 (score origin) not applied — nothing
   * is written automatically; the legacy behavior is unchanged. */
  | { status: 'unavailable'; reason: 'no_mapping_storage' | 'no_score_origin' }
  | { status: 'failed'; message: string }

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  return String(err)
}

/**
 * Batched: columns + formulas (2 requests), and only when some column is
 * affected: sources (getAssignments + ONE submissions request), roster
 * and the affected columns' cells (ONE request) — then one RPC per
 * affected column that actually changed. Never per student.
 */
export async function recalculateSgsColumnsForAssignments(
  subjectId: string,
  classroomId: string,
  assignmentIds: string[],
  deps: SgsAutoDeps = defaultSgsAutoDeps,
): Promise<SgsAutoRecalculationResult> {
  if (assignmentIds.length === 0) return { status: 'no_affected_columns' }
  try {
    const [columns, formulas] = await Promise.all([
      deps.getColumns(subjectId, classroomId),
      deps.getFormulas(subjectId, classroomId).catch(() => null),
    ])
    if (formulas === null) return { status: 'unavailable', reason: 'no_mapping_storage' }

    const affected = selectSgsColumnsAffectedByAssignments(columns, formulas, assignmentIds)
    if (affected.length === 0) return { status: 'no_affected_columns' }

    const [sourceData, students, cellsLoad] = await Promise.all([
      deps.getSources(subjectId, classroomId),
      deps.getStudents(classroomId),
      deps.getCells(affected.map((a) => a.column.id)),
    ])
    // Before 0027 an automatic write would have to go through plain
    // setSgsScore and could overwrite a teacher's value — never do that.
    if (!cellsLoad.supportsScoreOrigin) return { status: 'unavailable', reason: 'no_score_origin' }

    const studentIds = students.map((s) => s.id)
    const result: Extract<SgsAutoRecalculationResult, { status: 'done' }> = { status: 'done', updated: [], needsReconfigure: [], failed: [] }

    await Promise.all(
      affected.map(async ({ column, formula }) => {
        const live = computeLiveCalculatedScores(
          formula,
          column.maxScore,
          studentIds,
          sourceData.scoresByStudentIdAndAssignmentId,
          sourceData.sources,
        )
        if (!live) {
          result.needsReconfigure.push({ columnId: column.id, label: column.label })
          return
        }
        const values = planSgsAutoRecalculationValues(studentIds, cellsLoad.cellsByColumnId[column.id] ?? {}, live)
        if (values.length === 0) return
        try {
          const updated = await deps.recalculate(column.id, values)
          result.updated.push({ columnId: column.id, label: column.label, updated })
        } catch (err) {
          // One column's failure never blocks another's (each RPC is its
          // own all-or-nothing transaction).
          result.failed.push({ columnId: column.id, label: column.label, message: messageOf(err) })
        }
      }),
    )
    return result
  } catch (err) {
    return { status: 'failed', message: messageOf(err) }
  }
}

/** The toast after an automatic run — null when there is nothing worth
 * interrupting the teacher for. */
export function describeSgsAutoRecalculationResult(result: SgsAutoRecalculationResult): string | null {
  if (result.status === 'failed') return 'อัปเดตคะแนน SGS อัตโนมัติไม่สำเร็จ — คะแนนงานบันทึกแล้ว เปิดแท็บคะแนน SGS เพื่อคำนวณใหม่'
  if (result.status !== 'done') return null
  if (result.failed.length > 0) {
    return `อัปเดตคะแนน SGS อัตโนมัติไม่สำเร็จ: ${result.failed.map((f) => f.label).join(', ')} — คะแนนงานบันทึกแล้ว`
  }
  const changed = result.updated.filter((u) => u.updated > 0)
  if (changed.length > 0) return `อัปเดตคะแนน SGS อัตโนมัติแล้ว: ${changed.map((u) => u.label).join(', ')}`
  return null
}

// ==================================================
// Scheduler (debounce + one run at a time per subject/classroom)
// ==================================================

export interface SgsAutoRecalculationScheduler {
  schedule: (subjectId: string, classroomId: string, assignmentIds: string[]) => Promise<SgsAutoRecalculationResult>
  /** Runs anything pending now and resolves once no run is in flight for
   * this subject+classroom — the SGS tab awaits this before loading, so
   * it never shows values from before a just-saved source score. */
  flush: (subjectId: string, classroomId: string) => Promise<void>
}

type Runner = (subjectId: string, classroomId: string, assignmentIds: string[]) => Promise<SgsAutoRecalculationResult>

export function createSgsAutoRecalculationScheduler(run: Runner, delayMs = 600): SgsAutoRecalculationScheduler {
  interface Pending {
    subjectId: string
    classroomId: string
    assignmentIds: Set<string>
    timer: ReturnType<typeof setTimeout> | null
    waiters: ((result: SgsAutoRecalculationResult) => void)[]
  }
  const pending = new Map<string, Pending>()
  const running = new Map<string, Promise<void>>()

  function start(key: string) {
    const entry = pending.get(key)
    if (!entry) return
    pending.delete(key)
    if (entry.timer !== null) clearTimeout(entry.timer)
    const previous = running.get(key) ?? Promise.resolve()
    const next = previous
      .then(() => run(entry.subjectId, entry.classroomId, [...entry.assignmentIds]))
      .catch((err: unknown): SgsAutoRecalculationResult => ({ status: 'failed', message: messageOf(err) }))
      .then((result) => {
        for (const resolve of entry.waiters) resolve(result)
      })
    running.set(key, next)
    void next.then(() => {
      if (running.get(key) === next) running.delete(key)
    })
  }

  return {
    schedule(subjectId, classroomId, assignmentIds) {
      const key = `${subjectId}:${classroomId}`
      let entry = pending.get(key)
      if (!entry) {
        entry = { subjectId, classroomId, assignmentIds: new Set(), timer: null, waiters: [] }
        pending.set(key, entry)
      }
      for (const id of assignmentIds) entry.assignmentIds.add(id)
      if (entry.timer !== null) clearTimeout(entry.timer)
      entry.timer = setTimeout(() => start(key), delayMs)
      const target = entry
      return new Promise((resolve) => target.waiters.push(resolve))
    },
    async flush(subjectId, classroomId) {
      const key = `${subjectId}:${classroomId}`
      start(key)
      await running.get(key)
    },
  }
}

/** The app-wide instance every score-save path schedules through. */
export const sgsAutoRecalculation = createSgsAutoRecalculationScheduler((subjectId, classroomId, assignmentIds) =>
  recalculateSgsColumnsForAssignments(subjectId, classroomId, assignmentIds),
)

// ==================================================
// Explicit teacher actions (SGS tab)
// ==================================================

export interface SgsConvertToAutoOutcome {
  written: number
  overridesCleared: number
  suppressedCleared: number
  becomeEmpty: number
}

/**
 * "เปลี่ยนคอลัมน์นี้เป็นคำนวณอัตโนมัติ" for ONE column: fresh sources,
 * roster and this column's cells, then ONE recalculate_sgs_score_column
 * call (all-or-nothing) that writes the current calculated value and
 * clears the overrides. No other column is read for writing or touched.
 */
export async function convertSgsScoreColumnToAuto(
  subjectId: string,
  classroomId: string,
  column: SgsScoreColumn,
  formula: SgsScoreCalculationFormula,
  options: { clearSuppressed?: boolean } = {},
  deps: SgsAutoDeps = defaultSgsAutoDeps,
): Promise<SgsConvertToAutoOutcome> {
  const [sourceData, students, cellsLoad] = await Promise.all([
    deps.getSources(subjectId, classroomId),
    deps.getStudents(classroomId),
    deps.getCells([column.id]),
  ])
  if (!cellsLoad.supportsScoreOrigin) throw new Error('ฐานข้อมูลยังไม่รองรับคะแนนอัตโนมัติ (migration 0027)')
  const studentIds = students.map((s) => s.id)
  const live = computeLiveCalculatedScores(formula, column.maxScore, studentIds, sourceData.scoresByStudentIdAndAssignmentId, sourceData.sources)
  if (!live) throw new Error('ยังคำนวณจากงานที่เชื่อมไม่ได้ — งานต้นทางถูกเก็บถาวร/ลบ หรือคะแนนเต็มของช่องเปลี่ยน กรุณาตั้งค่าการคำนวณใหม่')
  const plan = planSgsColumnConvertToAuto(studentIds, cellsLoad.cellsByColumnId[column.id] ?? {}, live, options)
  const written = plan.values.length > 0 ? await deps.recalculate(column.id, plan.values) : 0
  return { written, overridesCleared: plan.overridesCleared, suppressedCleared: plan.suppressedCleared, becomeEmpty: plan.becomeEmpty }
}

/**
 * ONE cell from FRESH sources: "คำนวณใหม่จากงานต้นทาง" (keeps an
 * override) or, with clearOverride, "กลับไปใช้คะแนนคำนวณ" — the effective
 * score becomes the value calculated from today's source scores, never a
 * calculated_score left over from before a source changed. Returns null
 * when the formula can't run as saved (caller decides the fallback).
 */
export async function recalculateSgsCellFromSources(
  subjectId: string,
  classroomId: string,
  column: SgsScoreColumn,
  formula: SgsScoreCalculationFormula,
  studentId: string,
  clearOverride: boolean,
  deps: Pick<SgsAutoDeps, 'getSources' | 'recalculate'> = defaultSgsAutoDeps,
): Promise<{ calculatedScore: number | null; sourceData: Awaited<ReturnType<SgsAutoDeps['getSources']>> } | null> {
  const sourceData = await deps.getSources(subjectId, classroomId)
  const live = computeLiveCalculatedScores(formula, column.maxScore, [studentId], sourceData.scoresByStudentIdAndAssignmentId, sourceData.sources)
  if (!live) return null
  const calculatedScore = live[studentId] ?? null
  await deps.recalculate(column.id, [{ studentId, calculatedScore, clearOverride }])
  return { calculatedScore, sourceData }
}

/**
 * The ONE call every assignment-score save path makes after a
 * successful save. Fire-and-forget: never throws, never delays or fails
 * the save itself (the scheduler resolves every outcome, errors
 * included, to a result). `notify` gets a message only when SGS columns
 * actually changed or an automatic update failed.
 */
export function afterSourceScoresSaved(
  subjectId: string,
  classroomId: string,
  assignmentIds: string[],
  notify?: (message: string) => void,
  scheduler: SgsAutoRecalculationScheduler = sgsAutoRecalculation,
): void {
  void scheduler.schedule(subjectId, classroomId, assignmentIds).then((result) => {
    const message = describeSgsAutoRecalculationResult(result)
    if (message && notify) notify(message)
  })
}
