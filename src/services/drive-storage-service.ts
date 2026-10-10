import { getSupabaseClient } from '@/lib/supabase'

import { MAX_UPLOAD_BYTES, validateUpload, type DriveErrorCode, type DriveItemDto, type StorageQuota } from '../../supabase/functions/_shared/drive-storage'

/**
 * Browser side of the KrunameClass Google Drive storage (Document Center,
 * Phase 2). Every call goes to the `google-drive-files` Edge Function
 * through supabase-js, which attaches the signed-in teacher's Supabase
 * session; the function verifies it, holds the Google tokens, and only
 * touches this teacher's KrunameClass items. The browser never sees a
 * Google token, never calls Google directly, and nothing here writes to
 * Supabase tables.
 */

export const DRIVE_FILES_FUNCTION = 'google-drive-files'
export { MAX_UPLOAD_BYTES }
export type DriveStorageItem = DriveItemDto
export type DriveQuota = StorageQuota

export interface DriveOverview {
  root: DriveStorageItem | null
  items: DriveStorageItem[]
  quota: DriveQuota | null
}

/** Server codes plus `not_deployed` (the function itself is missing). */
export type DriveStorageErrorCode = DriveErrorCode | 'not_deployed'

export class DriveStorageClientError extends Error {
  readonly code: DriveStorageErrorCode
  constructor(code: DriveStorageErrorCode, message: string) {
    super(message)
    this.name = 'DriveStorageClientError'
    this.code = code
  }
}

const NOT_DEPLOYED_MESSAGE = 'ยังไม่ได้ติดตั้งระบบจัดเก็บบน Google Drive บนเซิร์ฟเวอร์'

/** supabase-js invoke error → our typed error (reads the function's JSON
 * `{ error, code }` body; a 404 without our code = function not deployed). */
export async function toDriveError(error: unknown): Promise<DriveStorageClientError> {
  const context = (error as { context?: Response } | null)?.context
  const name = (error as { name?: string } | null)?.name
  if (context && typeof context.json === 'function') {
    const parsed = (await context
      .clone()
      .json()
      .catch(() => null)) as { error?: string; code?: string } | null
    if (parsed?.code && typeof parsed.code === 'string' && parsed.code === parsed.code.toLowerCase()) {
      return new DriveStorageClientError(parsed.code as DriveStorageErrorCode, parsed.error || 'เกิดข้อผิดพลาด')
    }
    if (context.status === 404) return new DriveStorageClientError('not_deployed', NOT_DEPLOYED_MESSAGE)
  }
  if (name === 'FunctionsFetchError' || name === 'FunctionsRelayError') return new DriveStorageClientError('drive_unavailable', 'ติดต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่')
  return new DriveStorageClientError('drive_unavailable', 'ติดต่อ Google Drive ไม่สำเร็จ กรุณาลองใหม่')
}

async function invoke<T>(body: Record<string, unknown> | FormData): Promise<T> {
  const { data, error } = await getSupabaseClient().functions.invoke(DRIVE_FILES_FUNCTION, { body })
  if (error) throw await toDriveError(error)
  return data as T
}

export function getDriveOverview(): Promise<DriveOverview> {
  return invoke<DriveOverview>({ action: 'overview' })
}

export async function createDriveFolder(name: string, parentId: string | null): Promise<DriveStorageItem> {
  return (await invoke<{ item: DriveStorageItem }>({ action: 'create_folder', name, parentId })).item
}

/** Checked here first (same rules as the server) so a bad file never uploads. */
export function checkUpload(file: { name: string; size: number }): string | null {
  try {
    validateUpload(file)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : 'ไฟล์ไม่ถูกต้อง'
  }
}

export async function uploadDriveFile(file: File, parentId: string | null): Promise<DriveStorageItem> {
  const problem = checkUpload(file)
  if (problem) throw new DriveStorageClientError('invalid_request', problem)
  const form = new FormData()
  form.set('action', 'upload')
  if (parentId) form.set('parentId', parentId)
  form.set('file', file, file.name)
  return (await invoke<{ item: DriveStorageItem }>(form)).item
}

export async function renameDriveItem(fileId: string, name: string): Promise<DriveStorageItem> {
  return (await invoke<{ item: DriveStorageItem }>({ action: 'rename', fileId, name })).item
}

/** Moves to Google Drive's trash (recoverable there for 30 days). */
export async function trashDriveItem(fileId: string): Promise<void> {
  await invoke<{ trashed: boolean }>({ action: 'trash', fileId })
}

export async function downloadDriveItem(fileId: string): Promise<Blob> {
  const data = await invoke<unknown>({ action: 'download', fileId })
  if (!(data instanceof Blob)) throw new DriveStorageClientError('drive_unavailable', 'ดาวน์โหลดไฟล์ไม่สำเร็จ')
  return data
}
