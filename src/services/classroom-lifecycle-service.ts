import { parseDeletionPreview, type ClassroomDeletionPreview } from '@/features/classroom-management/classroom-deletion-model'
import { getSupabaseClient } from '@/lib/supabase'
import { toClassroomLifecycleError } from '@/services/classroom-lifecycle-errors'

export { archiveClassroom, reactivateClassroom } from '@/services/classroom-service'
export { ClassroomLifecycleError, type ClassroomLifecycleErrorKind } from '@/services/classroom-lifecycle-errors'

async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  let response
  try {
    response = await getSupabaseClient().rpc(fn, args)
  } catch (err) {
    throw toClassroomLifecycleError(err)
  }
  if (response.error) throw toClassroomLifecycleError(response.error)
  return response.data
}

/**
 * Live counts of everything a permanent delete would remove or keep,
 * plus blockers and a fingerprint (0032). Read-only; ownership is
 * checked on the server.
 */
export async function getClassroomDeletionPreview(classroomId: string): Promise<ClassroomDeletionPreview> {
  return parseDeletionPreview(await rpc('get_classroom_deletion_preview', { p_classroom_id: classroomId }))
}

export interface ClassroomDeletionResult {
  eventId: string
  queuedFiles: number
}

/**
 * Permanently deletes the classroom in ONE database transaction
 * (delete_classroom_permanently, 0032). The server re-checks ownership,
 * that the classroom is archived, the typed name, and that nothing
 * changed since `fingerprint` was read — any failure deletes nothing.
 * Files are never deleted here; their references are queued for a
 * separate, approved cleanup.
 */
export async function deleteClassroomPermanently(classroomId: string, typedName: string, fingerprint: string): Promise<ClassroomDeletionResult> {
  const data = (await rpc('delete_classroom_permanently', {
    p_classroom_id: classroomId,
    p_confirmation_name: typedName,
    p_expected_fingerprint: fingerprint,
  })) as { event_id?: unknown; queued_files?: unknown } | null
  // Only a server-confirmed result counts as success.
  if (!data || typeof data.event_id !== 'string') {
    throw toClassroomLifecycleError(new Error('ไม่ได้รับการยืนยันการลบจากเซิร์ฟเวอร์ กรุณาตรวจสอบรายการห้องเรียนอีกครั้ง'))
  }
  return { eventId: data.event_id, queuedFiles: typeof data.queued_files === 'number' ? data.queued_files : 0 }
}
