import type { ExportTable } from '@/lib/export/export-table'
import type { AssignmentSubmission } from '@/types/assignment'
import { SGS_BRIDGE_PAYLOAD_VERSION, type SgsBridgePayload } from '@/types/sgs-bridge'
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
  /** Whether this row would be included in the CSV/bridge payload —
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

/**
 * "ดาวน์โหลด CSV" — a teacher-readable snapshot of exactly what would be
 * sent to SGS, including the skipped rows (marked ไม่ส่ง) so the file is
 * a complete record, not just the subset that would transfer.
 */
export function buildSgsExportCsvTable(
  subjectName: string,
  classroomName: string,
  assignmentTitle: string,
  maxScore: number,
  rows: SgsExportRow[],
): ExportTable {
  return {
    title: `ส่งคะแนนไป SGS — ${assignmentTitle}`,
    subtitle: `รายวิชา: ${subjectName} · ห้อง: ${classroomName} · คะแนนเต็ม: ${maxScore}`,
    headers: ['เลขที่', 'นักเรียน', 'คะแนน KrunameClass', 'ส่งไป SGS'],
    rows: rows.map((r) => [
      r.studentNumber ?? '-',
      r.fullName,
      r.krunameScore ?? '—',
      r.willSend ? (r.krunameScore as number) : 'ไม่ส่ง',
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
  maxScore: number
}

/**
 * Builds the exact payload handed to the SGS Bridge extension (as a
 * downloaded JSON file — see sgs-export-dialog.tsx). Only rows with
 * `willSend` end up in `students`; every other row is recorded in
 * `skippedStudentIds` for audit purposes only. Nothing here ever reads
 * or forwards a Supabase session/token — this function's only inputs
 * are already-fetched, already-on-screen grade data.
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
    maxScore: args.maxScore,
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

  const maxScore = payload.maxScore
  if (typeof maxScore !== 'number' || !Number.isFinite(maxScore) || maxScore <= 0) {
    errors.push('maxScore ต้องเป็นตัวเลขมากกว่า 0')
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
        if (typeof maxScore === 'number' && r.score > maxScore) {
          errors.push(`students[${index}].score (${r.score}) เกินคะแนนเต็ม (${maxScore})`)
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
