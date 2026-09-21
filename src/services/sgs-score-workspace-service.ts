import { getSupabaseClient } from '@/lib/supabase'
import {
  SGS_SCORE_WORKSPACE_MULTI_PAYLOAD_KIND,
  SGS_SCORE_WORKSPACE_MULTI_PAYLOAD_VERSION,
  SGS_SCORE_WORKSPACE_PAYLOAD_KIND,
  SGS_SCORE_WORKSPACE_PAYLOAD_VERSION,
  type CreateSgsScoreColumnInput,
  type SgsScoreColumn,
  type SgsScoreWorkspaceColumnDefinition,
  type SgsScoreWorkspaceMultiPayload,
  type SgsScoreWorkspacePayload,
  type SgsScoreWorkspaceRow,
} from '@/types/sgs-score-workspace'
import type { SgsScoreCalculationFormula } from '@/types/sgs-score-calculation'
import type { ClassroomStudent } from '@/types/student'

/**
 * The "คะแนน SGS" workspace — real Supabase I/O only, deliberately
 * separate from assignment-service.ts (see src/types/sgs-score-workspace.ts's
 * own doc comment on why this is never unified with assignment grades).
 * There is no demo-mode counterpart for this service on purpose: SGS
 * Bridge payloads must only ever come from real student/classroom/
 * subject data, never from src/demo/* mock rows.
 */

interface SgsScoreColumnRow {
  id: string
  subject_id: string
  classroom_id: string
  label: string
  max_score: number
  position: number
  created_at: string
  updated_at: string
}

/**
 * REGRESSION FIX (live production incident): this select list used to
 * also carry `calculation_formula`, which exists only once migration
 * 0025 has been applied to a given database — and every migration in
 * this repo is written but explicitly NOT auto-applied (see every prior
 * migration's own doc comment). Selecting a column that does not exist
 * yet fails the WHOLE query, which failed the WHOLE Promise.all in
 * sgs-scores-tab.tsx's refresh(), so neither columns nor students ever
 * got set — an existing, already-working คะแนน SGS workspace (32
 * students, real columns/scores) broke outright ("เกิดข้อผิดพลาด...",
 * "ยังไม่มีนักเรียนในห้องเรียนนี้") the moment this feature shipped,
 * even for a teacher who had not touched the calculator at all.
 *
 * The base workspace query (list, create) must NEVER depend on
 * calculation_formula existing — that optional column is now fetched
 * ONLY by getSgsScoreColumnFormulas/updateSgsScoreColumnFormula, called
 * separately from the base load and independently error-handled, so an
 * unapplied migration 0025 degrades to "no saved formulas" instead of
 * breaking the workspace.
 */
const SGS_SCORE_COLUMN_SELECT = 'id, subject_id, classroom_id, label, max_score, position, created_at, updated_at'

interface SgsScoreColumnFormulaRow {
  id: string
  calculation_formula: SgsScoreCalculationFormula | null
}

interface SgsScoreRow {
  student_id: string
  score: number | null
}

/** Exported for the regression test proving this mapping can never fail
 * (and never guesses a formula) when `calculation_formula` is absent
 * from `row` — the exact shape every query using the base
 * SGS_SCORE_COLUMN_SELECT returns. */
export function mapColumn(row: SgsScoreColumnRow): SgsScoreColumn {
  return {
    id: row.id,
    subjectId: row.subject_id,
    classroomId: row.classroom_id,
    label: row.label,
    maxScore: row.max_score,
    position: row.position,
    // NEVER populated here on purpose — see the calculation_formula
    // comment above getSgsScoreColumnFormulas. A caller that needs a
    // column's saved formula fetches it separately.
    calculationFormula: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function requireTeacherId(): Promise<string> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) {
    throw new Error('กรุณาเข้าสู่ระบบก่อนใช้งาน')
  }
  return data.user.id
}

/** Every SGS column read in this app is scoped to one subject+classroom
 * pair — same "never merge across a subject's other linked classrooms"
 * rule as getAssignments (assignment-service.ts). */
export async function getSgsScoreColumns(subjectId: string, classroomId: string): Promise<SgsScoreColumn[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('sgs_score_columns')
    .select(SGS_SCORE_COLUMN_SELECT)
    .eq('subject_id', subjectId)
    .eq('classroom_id', classroomId)
    .order('position', { ascending: true })

  if (error) throw error
  return (data as SgsScoreColumnRow[]).map(mapColumn)
}

export async function createSgsScoreColumn(input: CreateSgsScoreColumnInput): Promise<SgsScoreColumn> {
  const teacherId = await requireTeacherId()
  const supabase = getSupabaseClient()
  const { data: existing, error: existingError } = await supabase
    .from('sgs_score_columns')
    .select('position')
    .eq('subject_id', input.subjectId)
    .eq('classroom_id', input.classroomId)
    .order('position', { ascending: false })
    .limit(1)
  if (existingError) throw existingError
  const nextPosition = ((existing as { position: number }[])[0]?.position ?? 0) + 1

  const { data, error } = await supabase
    .from('sgs_score_columns')
    .insert({
      subject_id: input.subjectId,
      classroom_id: input.classroomId,
      label: input.label,
      max_score: input.maxScore,
      position: nextPosition,
      created_by: teacherId,
    })
    .select(SGS_SCORE_COLUMN_SELECT)
    .single()

  if (error) throw error
  return mapColumn(data as SgsScoreColumnRow)
}

/**
 * Saves (or clears, with `formula: null`) the calculation configuration
 * for one column — never itself writes a single score. Only "คำนวณใหม่"
 * plus an explicit approved preview (applySgsScoreCalculation,
 * sgs-score-calculation-service.ts) ever changes a score value; saving a
 * formula is purely configuration.
 *
 * This is the ONE place calculation_formula is written, and it only ever
 * runs from an explicit calculator action (never the base page load) —
 * if migration 0025 has not been applied yet, this throws and the
 * calculator UI's own try/catch reports it as a calculator-specific
 * error (see score-calculation-modal.tsx), never a whole-workspace
 * failure.
 */
export async function updateSgsScoreColumnFormula(columnId: string, formula: SgsScoreCalculationFormula | null): Promise<SgsScoreColumn> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('sgs_score_columns')
    .update({ calculation_formula: formula })
    .eq('id', columnId)
    .select(`${SGS_SCORE_COLUMN_SELECT}, calculation_formula`)
    .single()

  if (error) throw error
  const row = data as SgsScoreColumnRow & { calculation_formula: SgsScoreCalculationFormula | null }
  return { ...mapColumn(row), calculationFormula: row.calculation_formula ?? null }
}

/**
 * The calculator's OWN, separately-failing read of every column's saved
 * formula in this subject+classroom — see the comment above
 * SGS_SCORE_COLUMN_SELECT for why this must never be folded into
 * getSgsScoreColumns. Callers (sgs-scores-tab.tsx) fetch this
 * independently of the base workspace load and handle its rejection on
 * their own (e.g. "no saved formulas yet" / a small calculator-scoped
 * notice) — never by failing the whole page.
 */
export async function getSgsScoreColumnFormulas(subjectId: string, classroomId: string): Promise<Record<string, SgsScoreCalculationFormula | null>> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('sgs_score_columns')
    .select('id, calculation_formula')
    .eq('subject_id', subjectId)
    .eq('classroom_id', classroomId)

  if (error) throw error
  const formulasByColumnId: Record<string, SgsScoreCalculationFormula | null> = {}
  for (const row of data as SgsScoreColumnFormulaRow[]) {
    formulasByColumnId[row.id] = row.calculation_formula ?? null
  }
  return formulasByColumnId
}

export async function deleteSgsScoreColumn(columnId: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.from('sgs_score_columns').delete().eq('id', columnId)
  if (error) throw error
}

/** All scores for ONE column, keyed by student id — never any other
 * column's, matching readColumnValues's own single-column scoping
 * convention on the extension side. */
export async function getSgsScores(columnId: string): Promise<Record<string, number | null>> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.from('sgs_scores').select('student_id, score').eq('column_id', columnId)
  if (error) throw error

  const scores: Record<string, number | null> = {}
  for (const row of data as SgsScoreRow[]) {
    scores[row.student_id] = row.score
  }
  return scores
}

/**
 * Upserts ONE student's score for ONE column — `score: null` is exactly
 * how a teacher clears a previously entered value (see 0023's own
 * comment on why `sgs_scores` has no DELETE policy: this UPDATE path is
 * the only way a score value goes away, the row itself only disappears
 * via its column's cascading delete).
 */
export async function setSgsScore(columnId: string, studentId: string, score: number | null): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('sgs_scores')
    .upsert({ column_id: columnId, student_id: studentId, score }, { onConflict: 'column_id,student_id' })
  if (error) throw error
}

/**
 * Builds one spreadsheet row per roster student — เลขที่/รหัสนักเรียน/
 * ชื่อ-นามสกุล plus every currently-defined SGS column's score (or null).
 * Pure, so the SGS Scores tab and its tests never need a live fetch to
 * exercise the row-building rule itself.
 */
export function buildSgsScoreWorkspaceRows(
  roster: Pick<ClassroomStudent, 'id' | 'number' | 'studentCode' | 'firstName' | 'lastName'>[],
  columns: Pick<SgsScoreColumn, 'id'>[],
  scoresByColumnId: Record<string, Record<string, number | null>>,
): SgsScoreWorkspaceRow[] {
  return roster.map((student) => {
    const scoresForRow: Record<string, number | null> = {}
    for (const column of columns) {
      scoresForRow[column.id] = scoresByColumnId[column.id]?.[student.id] ?? null
    }
    return {
      studentId: student.id,
      studentNumber: student.number,
      studentCode: student.studentCode,
      fullName: `${student.firstName} ${student.lastName}`.trim(),
      scoresByColumnId: scoresForRow,
    }
  })
}

export type SgsScoreWorkspaceSendAction = 'skip_no_score' | 'skip_over_max' | 'send'

export interface SgsScoreWorkspaceSendRow {
  studentId: string
  studentNumber: number | null
  studentCode: string | null
  fullName: string
  score: number | null
  action: SgsScoreWorkspaceSendAction
}

/**
 * The teacher's exact three rules for ONE selected column (item 2 of the
 * task spec):
 *   1. blank/null score -> 'skip_no_score' (nothing to send).
 *   2. an explicit score > the column's max score -> 'skip_over_max'
 *      (REJECTED — never silently clamped or sent as the max).
 *   3. otherwise (including an explicit 0) -> 'send'.
 * This never looks at any OTHER column — every input row is already
 * scoped to the one column the teacher picked.
 */
export function computeSgsScoreWorkspaceSendPlan(
  rows: SgsScoreWorkspaceRow[],
  columnId: string,
  maxScore: number,
): SgsScoreWorkspaceSendRow[] {
  return rows.map((row) => {
    const score = row.scoresByColumnId[columnId] ?? null
    let action: SgsScoreWorkspaceSendAction
    if (score === null) {
      action = 'skip_no_score'
    } else if (score > maxScore) {
      action = 'skip_over_max'
    } else {
      action = 'send'
    }
    return {
      studentId: row.studentId,
      studentNumber: row.studentNumber,
      studentCode: row.studentCode,
      fullName: row.fullName,
      score,
      action,
    }
  })
}

export interface BuildSgsScoreWorkspacePayloadArgs {
  subjectId: string
  subjectName: string
  classroomId: string
  classroomName: string
  targetColumn: SgsScoreWorkspaceColumnDefinition
}

/**
 * Builds the exact payload handed to the SGS Bridge extension (as a
 * downloaded JSON file). Only 'send' rows end up in `students`; every
 * other row is recorded in `skippedStudentIds` with WHY, for the
 * teacher's own audit trail only — the extension never needs it. Nothing
 * here ever reads or forwards a Supabase session/token, an SGS
 * credential, or any other secret — this function's only inputs are
 * already-fetched, already-on-screen score-workspace data.
 */
export function buildSgsScoreWorkspacePayload(
  args: BuildSgsScoreWorkspacePayloadArgs,
  plan: SgsScoreWorkspaceSendRow[],
): SgsScoreWorkspacePayload {
  return {
    kind: SGS_SCORE_WORKSPACE_PAYLOAD_KIND,
    version: SGS_SCORE_WORKSPACE_PAYLOAD_VERSION,
    generatedAt: new Date().toISOString(),
    subject: { id: args.subjectId, name: args.subjectName },
    classroom: { id: args.classroomId, name: args.classroomName },
    targetColumn: args.targetColumn,
    students: plan
      .filter((r) => r.action === 'send')
      .map((r) => ({
        studentId: r.studentId,
        studentNumber: r.studentNumber,
        studentCode: r.studentCode,
        fullName: r.fullName,
        score: r.score as number,
      })),
    skippedStudentIds: plan
      .filter((r) => r.action !== 'send')
      .map((r) => ({
        studentId: r.studentId,
        studentNumber: r.studentNumber,
        studentCode: r.studentCode,
        fullName: r.fullName,
        reason: r.action === 'skip_over_max' ? ('over_max_score' as const) : ('no_score' as const),
      })),
  }
}

/**
 * Keys that must never appear anywhere in a bridge payload, at any
 * depth — same defense-in-depth guard as sgs-export-service.ts's own
 * findForbiddenKey, duplicated here (not imported) so this module stays
 * fully independent of the assignment-scoped payload family.
 */
const FORBIDDEN_KEY_PATTERN = /password|token|cookie|secret|service_?role|credential|session/i

function findForbiddenKey(value: unknown, path = ''): string | null {
  if (value === null || typeof value !== 'object') return null
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key
    if (FORBIDDEN_KEY_PATTERN.test(key)) return childPath
    const nested = findForbiddenKey(child, childPath)
    if (nested) return nested
  }
  return null
}

export interface SgsScoreWorkspacePayloadValidation {
  ok: boolean
  errors: string[]
}

/**
 * Strong validation for an SGS score workspace payload — run before it's
 * downloaded (KrunameClass side) AND mirrored in the extension's own
 * copy of these rules (sgs-bridge/src/lib/payload-validation.js) before
 * it's trusted there. Never throws: every failure is collected into
 * `errors`.
 */
export function validateSgsScoreWorkspacePayload(raw: unknown): SgsScoreWorkspacePayloadValidation {
  const errors: string[] = []

  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: ['payload ต้องเป็น object'] }
  }
  const payload = raw as Record<string, unknown>

  if (payload.kind !== SGS_SCORE_WORKSPACE_PAYLOAD_KIND) {
    errors.push(`kind ไม่ถูกต้อง (คาดหวัง ${SGS_SCORE_WORKSPACE_PAYLOAD_KIND})`)
  }
  if (payload.version !== SGS_SCORE_WORKSPACE_PAYLOAD_VERSION) {
    errors.push(`version ไม่ถูกต้อง (คาดหวัง ${SGS_SCORE_WORKSPACE_PAYLOAD_VERSION})`)
  }

  function requireNonEmptyString(value: unknown, fieldName: string) {
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`${fieldName} ต้องเป็นข้อความที่ไม่ว่าง`)
    }
  }

  const subject = payload.subject
  if (typeof subject !== 'object' || subject === null) {
    errors.push('subject ต้องเป็น object')
  } else {
    requireNonEmptyString((subject as Record<string, unknown>).id, 'subject.id')
    requireNonEmptyString((subject as Record<string, unknown>).name, 'subject.name')
  }

  const classroom = payload.classroom
  if (typeof classroom !== 'object' || classroom === null) {
    errors.push('classroom ต้องเป็น object')
  } else {
    requireNonEmptyString((classroom as Record<string, unknown>).id, 'classroom.id')
    requireNonEmptyString((classroom as Record<string, unknown>).name, 'classroom.name')
  }

  let targetColumnMaxScore: number | null = null
  const targetColumn = payload.targetColumn
  if (typeof targetColumn !== 'object' || targetColumn === null) {
    errors.push('targetColumn ต้องเป็น object')
  } else {
    const col = targetColumn as Record<string, unknown>
    requireNonEmptyString(col.key, 'targetColumn.key')
    requireNonEmptyString(col.label, 'targetColumn.label')
    if (typeof col.maxScore !== 'number' || !Number.isFinite(col.maxScore) || col.maxScore <= 0) {
      errors.push('targetColumn.maxScore ต้องเป็นตัวเลขมากกว่า 0')
    } else {
      targetColumnMaxScore = col.maxScore
    }
  }

  if (!Array.isArray(payload.students)) {
    errors.push('students ต้องเป็น array')
  } else {
    payload.students.forEach((row, index) => {
      if (typeof row !== 'object' || row === null) {
        errors.push(`students[${index}] ต้องเป็น object`)
        return
      }
      const r = row as Record<string, unknown>
      requireNonEmptyString(r.studentId, `students[${index}].studentId`)
      requireNonEmptyString(r.fullName, `students[${index}].fullName`)
      if (r.studentNumber !== null && typeof r.studentNumber !== 'number') {
        errors.push(`students[${index}].studentNumber ต้องเป็นตัวเลขหรือ null`)
      }
      if (r.studentCode !== null && typeof r.studentCode !== 'string') {
        errors.push(`students[${index}].studentCode ต้องเป็นข้อความหรือ null`)
      }
      if (typeof r.score !== 'number' || !Number.isFinite(r.score)) {
        errors.push(`students[${index}].score ต้องเป็นตัวเลข (ห้ามเป็น null — แถวที่ไม่มีคะแนนต้องไม่อยู่ใน students)`)
      } else {
        if (r.score < 0) errors.push(`students[${index}].score ติดลบไม่ได้`)
        if (targetColumnMaxScore !== null && r.score > targetColumnMaxScore) {
          errors.push(`students[${index}].score (${r.score}) เกินคะแนนเต็มของช่อง SGS ที่เลือก (${targetColumnMaxScore})`)
        }
      }
    })
  }

  const forbiddenPath = findForbiddenKey(payload)
  if (forbiddenPath) {
    errors.push(`payload ห้ามมีข้อมูลลับ (พบ key ต้องสงสัย: ${forbiddenPath})`)
  }

  return { ok: errors.length === 0, errors }
}

/**
 * Turns the teacher's checkbox selection in the "ส่งคะแนนไป SGS" dialog
 * into the exact `columns` array the multi-column payload builder below
 * expects. Selection is by `SgsScoreColumn.id`, and the result always
 * follows the WORKSPACE's own column order (never the order the boxes
 * happened to be ticked in), so a payload's column order always matches
 * what the teacher sees in the table. An id that no longer exists — a
 * column deleted while the dialog was open — is silently dropped rather
 * than exported as a phantom column.
 */
export function selectSgsScoreWorkspaceColumnsForExport(
  columns: SgsScoreColumn[],
  selectedColumnIds: string[],
): SgsScoreWorkspaceColumnDefinition[] {
  const selected = new Set(selectedColumnIds)
  return columns
    .filter((column) => selected.has(column.id))
    .map((column) => ({ key: column.id, label: column.label, maxScore: column.maxScore }))
}

export interface BuildSgsScoreWorkspaceMultiPayloadArgs {
  subjectId: string
  subjectName: string
  classroomId: string
  classroomName: string
  columns: SgsScoreWorkspaceColumnDefinition[]
}

/**
 * The PRODUCTION multi-column payload: every selected score column, plus
 * each roster student's score per column. Unlike the single-column
 * builder above it never filters students out — a student with no score
 * in a column carries an explicit `null` for that column, so the
 * extension can tell "no score entered" apart from a real 0 (which is a
 * sendable score) without guessing.
 */
export function buildSgsScoreWorkspaceMultiPayload(
  args: BuildSgsScoreWorkspaceMultiPayloadArgs,
  rows: SgsScoreWorkspaceRow[],
): SgsScoreWorkspaceMultiPayload {
  return {
    kind: SGS_SCORE_WORKSPACE_MULTI_PAYLOAD_KIND,
    version: SGS_SCORE_WORKSPACE_MULTI_PAYLOAD_VERSION,
    generatedAt: new Date().toISOString(),
    subject: { id: args.subjectId, name: args.subjectName },
    classroom: { id: args.classroomId, name: args.classroomName },
    columns: args.columns,
    students: rows.map((row) => ({
      studentId: row.studentId,
      studentNumber: row.studentNumber,
      studentCode: row.studentCode,
      fullName: row.fullName,
      scoresByColumnKey: Object.fromEntries(args.columns.map((column) => [column.key, row.scoresByColumnId[column.key] ?? null])),
    })),
  }
}

export interface SgsScoreWorkspaceMultiPayloadValidation {
  ok: boolean
  errors: string[]
}

/**
 * Mirrors the single-column validator's strictness, extended to the
 * per-column score map: every score must be a finite number within ITS
 * OWN column's max (never another column's), and `null` stays a valid,
 * meaningful "no score" — only a wrong TYPE is an error.
 */
export function validateSgsScoreWorkspaceMultiPayload(raw: unknown): SgsScoreWorkspaceMultiPayloadValidation {
  const errors: string[] = []

  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: ['payload ต้องเป็น object'] }
  }
  const payload = raw as Record<string, unknown>

  if (payload.kind !== SGS_SCORE_WORKSPACE_MULTI_PAYLOAD_KIND) {
    errors.push(`kind ไม่ถูกต้อง (คาดหวัง ${SGS_SCORE_WORKSPACE_MULTI_PAYLOAD_KIND})`)
  }
  if (payload.version !== SGS_SCORE_WORKSPACE_MULTI_PAYLOAD_VERSION) {
    errors.push(`version ไม่ถูกต้อง (คาดหวัง ${SGS_SCORE_WORKSPACE_MULTI_PAYLOAD_VERSION})`)
  }

  const maxScoreByKey = new Map<string, number>()
  if (!Array.isArray(payload.columns) || payload.columns.length === 0) {
    errors.push('columns ต้องเป็น array และมีอย่างน้อย 1 คอลัมน์')
  } else {
    payload.columns.forEach((rawColumn, index) => {
      const column = rawColumn as Record<string, unknown>
      if (typeof column?.key !== 'string' || column.key.trim() === '') {
        errors.push(`columns[${index}].key ต้องเป็นข้อความที่ไม่ว่าง`)
        return
      }
      if (typeof column.label !== 'string' || column.label.trim() === '') {
        errors.push(`columns[${index}].label ต้องเป็นข้อความที่ไม่ว่าง`)
      }
      if (typeof column.maxScore !== 'number' || !Number.isFinite(column.maxScore) || column.maxScore <= 0) {
        errors.push(`columns[${index}].maxScore ต้องเป็นตัวเลขมากกว่า 0`)
        return
      }
      if (maxScoreByKey.has(column.key)) {
        errors.push(`columns[${index}].key ซ้ำกับคอลัมน์อื่น (${column.key})`)
        return
      }
      maxScoreByKey.set(column.key, column.maxScore)
    })
  }

  if (!Array.isArray(payload.students)) {
    errors.push('students ต้องเป็น array')
  } else {
    payload.students.forEach((rawStudent, index) => {
      const student = rawStudent as Record<string, unknown>
      if (typeof student?.studentId !== 'string' || student.studentId.trim() === '') {
        errors.push(`students[${index}].studentId ต้องเป็นข้อความที่ไม่ว่าง`)
      }
      if (typeof student?.fullName !== 'string' || student.fullName.trim() === '') {
        errors.push(`students[${index}].fullName ต้องเป็นข้อความที่ไม่ว่าง`)
      }
      const scores = student?.scoresByColumnKey
      if (typeof scores !== 'object' || scores === null) {
        errors.push(`students[${index}].scoresByColumnKey ต้องเป็น object`)
        return
      }
      for (const [key, value] of Object.entries(scores as Record<string, unknown>)) {
        if (value === null) continue
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          errors.push(`students[${index}].scoresByColumnKey.${key} ต้องเป็นตัวเลขหรือ null`)
          continue
        }
        if (value < 0) {
          errors.push(`students[${index}].scoresByColumnKey.${key} ต้องไม่ติดลบ`)
          continue
        }
        const max = maxScoreByKey.get(key)
        if (max !== undefined && value > max) {
          errors.push(`students[${index}].scoresByColumnKey.${key} (${value}) เกินคะแนนเต็มของคอลัมน์ (${max})`)
        }
      }
    })
  }

  return { ok: errors.length === 0, errors }
}
