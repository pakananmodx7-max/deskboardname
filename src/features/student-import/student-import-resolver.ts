import {
  addStudentToClassroom,
  createStudent,
  findStudentByCode,
  isStudentInClassroom,
} from '@/services/student-service'
import type {
  DraftImportRow,
  ImportCommitResult,
  ImportRowAction,
  ImportRowStatus,
  ResolvedImportRow,
} from '@/features/student-import/types'

interface ExistingStudentMatch {
  id: string
  alreadyInClassroom: boolean
}

interface RowDecision {
  action: ImportRowAction
  status: ImportRowStatus
  reason: string | null
  existingStudentId: string | null
}

/**
 * Pure decision table for what to do with one row given whether its
 * student_code already exists (and whether that student is already in
 * the target classroom). Kept separate from the Supabase lookups in
 * resolveImportRows so the branching logic can be unit tested directly.
 */
export function resolveRowAction(
  row: DraftImportRow,
  existingMatch: ExistingStudentMatch | null,
): RowDecision {
  if (row.status !== 'ready') {
    return { action: 'skip', status: row.status, reason: row.reason, existingStudentId: null }
  }

  if (!row.studentCode || !existingMatch) {
    return { action: 'create', status: 'ready', reason: null, existingStudentId: null }
  }

  if (existingMatch.alreadyInClassroom) {
    return {
      action: 'skip',
      status: 'duplicate',
      reason: 'นักเรียนอยู่ในห้องนี้แล้ว',
      existingStudentId: existingMatch.id,
    }
  }

  return {
    action: 'link',
    status: 'ready',
    reason: null,
    existingStudentId: existingMatch.id,
  }
}

/** Cross-checks each draft row's student_code against the database. */
export async function resolveImportRows(
  rows: DraftImportRow[],
  classroomId: string,
): Promise<ResolvedImportRow[]> {
  const resolved: ResolvedImportRow[] = []

  for (const row of rows) {
    let existingMatch: ExistingStudentMatch | null = null

    if (row.status === 'ready' && row.studentCode) {
      const existing = await findStudentByCode(row.studentCode)
      if (existing) {
        const alreadyInClassroom = await isStudentInClassroom(existing.id, classroomId)
        existingMatch = { id: existing.id, alreadyInClassroom }
      }
    }

    const decision = resolveRowAction(row, existingMatch)
    resolved.push({ ...row, ...decision })
  }

  return resolved
}

/** Applies resolved rows to Supabase one at a time, never aborting the whole batch on a single row's failure. */
export async function commitImportRows(
  rows: ResolvedImportRow[],
  classroomId: string,
): Promise<ImportCommitResult> {
  const result: ImportCommitResult = {
    created: 0,
    linkedExisting: 0,
    duplicates: 0,
    failed: 0,
    failedRows: [],
  }

  for (const row of rows) {
    try {
      if (row.action === 'create') {
        await createStudent({
          classroomId,
          studentCode: row.studentCode,
          number: row.number,
          firstName: row.firstName,
          lastName: row.lastName,
          nickname: row.nickname,
          email: row.email,
          phone: row.phone,
        })
        result.created += 1
      } else if (row.action === 'link' && row.existingStudentId) {
        await addStudentToClassroom(row.existingStudentId, classroomId)
        result.linkedExisting += 1
      } else if (row.status === 'duplicate') {
        result.duplicates += 1
      }
    } catch (error) {
      result.failed += 1
      result.failedRows.push({
        rowNumber: row.rowNumber,
        firstName: row.firstName,
        lastName: row.lastName,
        reason: error instanceof Error ? error.message : 'ไม่สามารถบันทึกข้อมูลได้',
      })
    }
  }

  return result
}
