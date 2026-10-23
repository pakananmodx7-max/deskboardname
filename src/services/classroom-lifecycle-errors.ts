import { toFriendlyErrorMessage } from '@/lib/errors'

/**
 * Why an archive / restore / permanent-delete request failed. The codes
 * come from 0032_classroom_archive_and_delete.sql (KC001-KC006) plus the
 * standard Postgres/PostgREST ones; the message is always safe to show.
 */
export type ClassroomLifecycleErrorKind =
  | 'session'
  | 'permission'
  | 'not_archived'
  | 'name_mismatch'
  | 'stale'
  | 'blocked'
  | 'already_archived'
  | 'already_active'
  | 'unavailable'
  | 'network'
  | 'other'

export class ClassroomLifecycleError extends Error {
  readonly kind: ClassroomLifecycleErrorKind
  constructor(message: string, kind: ClassroomLifecycleErrorKind) {
    super(message)
    this.name = 'ClassroomLifecycleError'
    this.kind = kind
  }
}

const MISSING_FUNCTION_CODES = new Set(['42883', 'PGRST202'])

const KC_KINDS: Record<string, [ClassroomLifecycleErrorKind, string]> = {
  KC001: ['not_archived', 'ต้องเก็บถาวรห้องเรียนก่อน จึงจะลบถาวรได้'],
  KC002: ['name_mismatch', 'ชื่อห้องเรียนที่พิมพ์ไม่ตรงกับชื่อห้องเรียน'],
  KC003: ['stale', 'ข้อมูลของห้องเรียนนี้เปลี่ยนไปหลังจากที่คุณเปิดหน้ายืนยัน กรุณาตรวจสอบรายการที่จะถูกลบอีกครั้ง'],
  KC004: ['blocked', 'ลบห้องเรียนนี้ถาวรไม่ได้ เพราะยืนยันความเป็นเจ้าของข้อมูลทั้งหมดไม่ได้'],
  KC005: ['already_archived', 'ห้องเรียนนี้ถูกเก็บถาวรอยู่แล้ว'],
  KC006: ['already_active', 'ห้องเรียนนี้ใช้งานอยู่แล้ว'],
}

/** True when the database does not have 0032's functions yet. */
export function isLifecycleRpcMissing(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  return MISSING_FUNCTION_CODES.has(code)
}

function hasThai(message: string | undefined): message is string {
  return Boolean(message && /[฀-๿]/.test(message))
}

/** Maps a Supabase/PostgREST/network error to a ClassroomLifecycleError. */
export function toClassroomLifecycleError(error: unknown): ClassroomLifecycleError {
  if (error instanceof ClassroomLifecycleError) return error
  const e = error as { code?: string; message?: string } | null
  const code = e?.code ?? ''
  const message = e?.message ?? ''

  const kc = KC_KINDS[code]
  if (kc) return new ClassroomLifecycleError(hasThai(message) ? message : kc[1], kc[0])
  if (MISSING_FUNCTION_CODES.has(code)) {
    return new ClassroomLifecycleError('ฟีเจอร์นี้ยังไม่พร้อมใช้งานบนฐานข้อมูล (ต้องติดตั้ง migration 0032) กรุณาติดต่อผู้ดูแลระบบ', 'unavailable')
  }
  if (code === 'PGRST301' || code === '28000' || /jwt expired|invalid jwt|refresh token|auth session missing/i.test(message)) {
    return new ClassroomLifecycleError('เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่ แล้วลองอีกครั้ง', 'session')
  }
  if (code === '42501') {
    return new ClassroomLifecycleError(hasThai(message) ? message : 'คุณไม่มีสิทธิ์จัดการห้องเรียนนี้', 'permission')
  }
  if (/failed to fetch|networkerror|load failed|fetch failed|network request failed/i.test(message) || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return new ClassroomLifecycleError('ไม่สามารถเชื่อมต่ออินเทอร์เน็ตได้ — ยังไม่มีการเปลี่ยนแปลงใด ๆ กรุณาลองใหม่', 'network')
  }
  return new ClassroomLifecycleError(toFriendlyErrorMessage(error, 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'), 'other')
}

/** Message to show for any archive/restore/delete failure. */
export function classroomLifecycleErrorMessage(error: unknown): string {
  return toClassroomLifecycleError(error).message
}
