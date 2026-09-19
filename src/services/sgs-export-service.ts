import type { ExportTable } from '@/lib/export/export-table'
import type { AssignmentSubmission } from '@/types/assignment'
import {
  DEFAULT_SGS_OVERWRITE_MODE,
  SGS_BRIDGE_PAYLOAD_VERSION,
  type SgsBridgePayload,
  type SgsColumnDefinition,
  type SgsOverwriteMode,
} from '@/types/sgs-bridge'
import type { ClassroomStudent } from '@/types/student'

/**
 * Phase 1 SGS export — read-only over the SAME `assignments` +
 * `assignment_submissions.score` data every other grade view
 * (assignment-service.ts, the Grades tab) already reads. No new grade
 * model, no new table: this module only reshapes what's already loaded
 * on the assignment detail page into an SGS-shaped preview/export.
 *
 * The one rule every function here enforces identically: a NULL score
 * ("not graded yet") is never the same thing as an explicit 0, and is
 * never sent — see buildSgsExportRows.
 */
export interface SgsExportRow {
  studentId: string
  studentNumber: number | null
  fullName: string
  /** null means "no score recorded in KrunameClass yet" — never 0. */
  krunameScore: number | null
  /** Whether this row would be included in the bridge payload —
   * always exactly `krunameScore !== null`, kept as its own field so
   * callers never need to re-derive (and risk drifting from) that rule. */
  willSend: boolean
}

/**
 * One row per roster student, in roster order — the caller (the
 * assignment detail page) already sorts/filters the roster the same way
 * the on-screen table does, so this export always matches what the
 * teacher is currently looking at.
 */
export function buildSgsExportRows(
  roster: Pick<ClassroomStudent, 'id' | 'number' | 'firstName' | 'lastName'>[],
  submissions: Record<string, AssignmentSubmission>,
): SgsExportRow[] {
  return roster.map((student) => {
    const score = submissions[student.id]?.score ?? null
    return {
      studentId: student.id,
      studentNumber: student.number,
      fullName: `${student.firstName} ${student.lastName}`.trim(),
      krunameScore: score,
      willSend: score !== null,
    }
  })
}

export interface SgsExportSummary {
  totalStudents: number
  withScore: number
  skipped: number
  maxScore: number
}

export function computeSgsExportSummary(rows: SgsExportRow[], maxScore: number): SgsExportSummary {
  const withScore = rows.filter((r) => r.willSend).length
  return {
    totalStudents: rows.length,
    withScore,
    skipped: rows.length - withScore,
    maxScore,
  }
}

// ==================================================
// Column-specific fill — the teacher must pick exactly ONE SGS score
// column per operation (ช่อง 1 / ช่อง 2 / .../ กลางภาค / ปลายภาค), and
// every other column must stay completely untouched. This section is
// mirrored, line-for-rule, in sgs-bridge/src/lib/column-fill.js — the
// extension can't import a TS module from this app's src/, the same
// reason sgs-mapping-service.ts is mirrored there too.
// ==================================================

/**
 * Placeholder default column set. The real SGS instance's actual
 * columns/labels/max scores are unknown until Phase 5's diagnostic mode
 * has been run against the live page — this list is the one thing that
 * needs to change once that's confirmed; nothing else in this file
 * depends on these exact values.
 */
export const SGS_COLUMNS: SgsColumnDefinition[] = [
  { key: 'col1', label: 'ช่อง 1', maxScore: 15 },
  { key: 'col2', label: 'ช่อง 2', maxScore: 15 },
  { key: 'col3', label: 'ช่อง 3', maxScore: 15 },
  { key: 'col4', label: 'ช่อง 4', maxScore: 15 },
  { key: 'midterm', label: 'กลางภาค', maxScore: 10 },
  { key: 'final', label: 'ปลายภาค', maxScore: 30 },
]

export type SgsColumnFillAction = 'skip_no_score' | 'skip_existing' | 'write'

export interface SgsColumnFillRow {
  studentId: string
  studentNumber: number | null
  fullName: string
  krunameScore: number | null
  /** What the target column currently holds for this student, as read
   * by the extension from the live SGS page — null means "empty," NOT
   * "unknown." KrunameClass itself has no way to read the live SGS page,
   * so every call made from sgs-export-dialog.tsx passes an empty map
   * here (see the dialog's own on-screen disclosure about this). */
  sgsExistingScore: number | null
  action: SgsColumnFillAction
}

/**
 * The one function that decides, per student, whether the target
 * column's cell gets written — and the ONLY three things it ever
 * decides:
 *   1. no KrunameClass score at all -> 'skip_no_score' (blank in
 *      KrunameClass always means skip, regardless of overwrite mode —
 *      there is nothing to write).
 *   2. the column already has a value AND the teacher chose
 *      'skip_existing' (the default) -> 'skip_existing'.
 *   3. otherwise -> 'write', using the KrunameClass score exactly,
 *      including an explicit 0.
 * This never looks at, and has no way to reference, any OTHER column —
 * every input row here is already scoped to one column's existing
 * value, and every output row is a decision about that same one column.
 */
export function computeSgsColumnFillPlan(
  rows: Pick<SgsExportRow, 'studentId' | 'studentNumber' | 'fullName' | 'krunameScore'>[],
  existingScoresByStudentId: Record<string, number | null>,
  overwriteMode: SgsOverwriteMode,
): SgsColumnFillRow[] {
  return rows.map((row) => {
    const sgsExistingScore = existingScoresByStudentId[row.studentId] ?? null
    let action: SgsColumnFillAction
    if (row.krunameScore === null) {
      action = 'skip_no_score'
    } else if (sgsExistingScore !== null && overwriteMode === 'skip_existing') {
      action = 'skip_existing'
    } else {
      action = 'write'
    }
    return {
      studentId: row.studentId,
      studentNumber: row.studentNumber,
      fullName: row.fullName,
      krunameScore: row.krunameScore,
      sgsExistingScore,
      action,
    }
  })
}

export function formatSgsExistingScoreDisplay(score: number | null): string {
  return score === null ? 'ว่าง' : String(score)
}

export function formatSgsNewValueDisplay(row: SgsColumnFillRow): string {
  return row.action === 'write' ? String(row.krunameScore) : 'ไม่เปลี่ยน'
}

export interface SgsColumnWriteInstruction {
  studentId: string
  columnKey: string
  value: number
}

/**
 * The actual "what to write" list for ONE column — every instruction
 * carries the SAME `columnKey` (the one passed in), so a future DOM-
 * filling function that only ever accepts a single-column instruction
 * list is structurally unable to touch any other SGS column. Rows
 * whose action isn't 'write' simply produce no instruction — an
 * unrelated existing value is left exactly as-is because nothing here
 * ever asks to change it.
 */
export function buildSgsColumnWriteInstructions(plan: SgsColumnFillRow[], columnKey: string): SgsColumnWriteInstruction[] {
  return plan
    .filter((row): row is SgsColumnFillRow & { krunameScore: number } => row.action === 'write')
    .map((row) => ({ studentId: row.studentId, columnKey, value: row.krunameScore }))
}

/**
 * "ดาวน์โหลด CSV" — a teacher-readable snapshot of exactly what would
 * happen for the selected column: existing value, new value (or "ไม่
 * เปลี่ยน" when skipped), for every roster student.
 */
export function buildSgsColumnFillCsvTable(
  subjectName: string,
  classroomName: string,
  assignmentTitle: string,
  targetColumn: SgsColumnDefinition,
  plan: SgsColumnFillRow[],
): ExportTable {
  return {
    title: `ส่งคะแนนไป SGS — ${assignmentTitle}`,
    subtitle: `รายวิชา: ${subjectName} · ห้อง: ${classroomName} · ช่องที่จะกรอก: ${targetColumn.label} · คะแนนเต็ม: ${targetColumn.maxScore}`,
    headers: ['เลขที่', 'นักเรียน', 'คะแนน KrunameClass', 'คะแนนเดิม SGS', 'คะแนนใหม่'],
    rows: plan.map((r) => [
      r.studentNumber ?? '-',
      r.fullName,
      r.krunameScore ?? '—',
      formatSgsExistingScoreDisplay(r.sgsExistingScore),
      formatSgsNewValueDisplay(r),
    ]),
  }
}

export interface BuildSgsBridgePayloadArgs {
  subjectId: string
  subjectName: string
  classroomId: string
  classroomName: string
  assignmentId: string
  assignmentTitle: string
  assignmentMaxScore: number
  targetColumn: SgsColumnDefinition
  overwriteMode?: SgsOverwriteMode
}

/**
 * Builds the exact payload handed to the SGS Bridge extension (as a
 * downloaded JSON file — see sgs-export-dialog.tsx). Only rows with
 * `willSend` end up in `students`; every other row is recorded in
 * `skippedStudentIds` for audit purposes only. `students[]` always
 * includes every graded student regardless of `overwriteMode` — the
 * skip-if-already-filled decision needs the column's CURRENT value on
 * the live SGS page, which only the extension can read, so that
 * decision is deliberately deferred to computeSgsColumnFillPlan running
 * there, not made here. Nothing here ever reads or forwards a Supabase
 * session/token — this function's only inputs are already-fetched,
 * already-on-screen grade data.
 */
export function buildSgsBridgePayload(args: BuildSgsBridgePayloadArgs, rows: SgsExportRow[]): SgsBridgePayload {
  return {
    version: SGS_BRIDGE_PAYLOAD_VERSION,
    generatedAt: new Date().toISOString(),
    subjectId: args.subjectId,
    subjectName: args.subjectName,
    classroomId: args.classroomId,
    classroomName: args.classroomName,
    assignmentId: args.assignmentId,
    assignmentTitle: args.assignmentTitle,
    assignmentMaxScore: args.assignmentMaxScore,
    targetColumn: args.targetColumn,
    overwriteMode: args.overwriteMode ?? DEFAULT_SGS_OVERWRITE_MODE,
    students: rows
      .filter((r) => r.willSend)
      .map((r) => ({
        studentId: r.studentId,
        studentNumber: r.studentNumber,
        fullName: r.fullName,
        score: r.krunameScore as number,
      })),
    skippedStudentIds: rows
      .filter((r) => !r.willSend)
      .map((r) => ({
        studentId: r.studentId,
        studentNumber: r.studentNumber,
        fullName: r.fullName,
        reason: 'no_score' as const,
      })),
  }
}

/**
 * Keys that must never appear anywhere in a bridge payload, at any
 * depth — defense in depth on top of the fact that buildSgsBridgePayload
 * above never reads or writes any of these itself. Catches both a
 * future accidental addition here AND a hand-edited/tampered JSON file
 * a teacher might load into the extension.
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

const OVERWRITE_MODES: SgsOverwriteMode[] = ['skip_existing', 'overwrite_selected_column']

export interface SgsBridgePayloadValidation {
  ok: boolean
  errors: string[]
}

/**
 * Strong validation for a bridge payload — run before it's downloaded
 * (KrunameClass side) AND run again before it's trusted by the
 * extension (its own mirrored copy of these rules; see
 * sgs-bridge/src/lib/payload-validation.js). Never throws: every
 * failure is collected into `errors` so a caller can show all of them
 * at once rather than one-at-a-time.
 */
export function validateSgsBridgePayload(raw: unknown): SgsBridgePayloadValidation {
  const errors: string[] = []

  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: ['payload ต้องเป็น object'] }
  }
  const payload = raw as Record<string, unknown>

  if (payload.version !== SGS_BRIDGE_PAYLOAD_VERSION) {
    errors.push(`version ไม่ถูกต้อง (คาดหวัง ${SGS_BRIDGE_PAYLOAD_VERSION})`)
  }

  const requiredStringFields = [
    'subjectId',
    'subjectName',
    'classroomId',
    'classroomName',
    'assignmentId',
    'assignmentTitle',
  ] as const
  for (const field of requiredStringFields) {
    if (typeof payload[field] !== 'string' || (payload[field] as string).trim() === '') {
      errors.push(`${field} ต้องเป็นข้อความที่ไม่ว่าง`)
    }
  }

  const assignmentMaxScore = payload.assignmentMaxScore
  if (typeof assignmentMaxScore !== 'number' || !Number.isFinite(assignmentMaxScore) || assignmentMaxScore <= 0) {
    errors.push('assignmentMaxScore ต้องเป็นตัวเลขมากกว่า 0')
  }

  let targetColumnMaxScore: number | null = null
  const targetColumn = payload.targetColumn
  if (typeof targetColumn !== 'object' || targetColumn === null) {
    errors.push('targetColumn ต้องเป็น object')
  } else {
    const col = targetColumn as Record<string, unknown>
    if (typeof col.key !== 'string' || col.key.trim() === '') {
      errors.push('targetColumn.key ต้องเป็นข้อความที่ไม่ว่าง')
    }
    if (typeof col.label !== 'string' || col.label.trim() === '') {
      errors.push('targetColumn.label ต้องเป็นข้อความที่ไม่ว่าง')
    }
    if (typeof col.maxScore !== 'number' || !Number.isFinite(col.maxScore) || col.maxScore <= 0) {
      errors.push('targetColumn.maxScore ต้องเป็นตัวเลขมากกว่า 0')
    } else {
      targetColumnMaxScore = col.maxScore
    }
  }

  if (!OVERWRITE_MODES.includes(payload.overwriteMode as SgsOverwriteMode)) {
    errors.push(`overwriteMode ต้องเป็นหนึ่งใน ${OVERWRITE_MODES.join(', ')}`)
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
      if (typeof r.studentId !== 'string' || r.studentId.trim() === '') {
        errors.push(`students[${index}].studentId ไม่ถูกต้อง`)
      }
      if (typeof r.fullName !== 'string' || r.fullName.trim() === '') {
        errors.push(`students[${index}].fullName ไม่ถูกต้อง`)
      }
      if (r.studentNumber !== null && typeof r.studentNumber !== 'number') {
        errors.push(`students[${index}].studentNumber ต้องเป็นตัวเลขหรือ null`)
      }
      if (typeof r.score !== 'number' || !Number.isFinite(r.score)) {
        errors.push(`students[${index}].score ต้องเป็นตัวเลข (ห้ามเป็น null — แถวที่ไม่มีคะแนนต้องไม่อยู่ใน students)`)
      } else {
        if (r.score < 0) errors.push(`students[${index}].score ติดลบไม่ได้`)
        if (typeof assignmentMaxScore === 'number' && r.score > assignmentMaxScore) {
          errors.push(`students[${index}].score (${r.score}) เกินคะแนนเต็มของงาน (${assignmentMaxScore})`)
        }
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
