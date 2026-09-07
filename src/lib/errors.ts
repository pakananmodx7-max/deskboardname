import { SupabaseNotConfiguredError } from '@/lib/supabase'

/** Error shape returned by supabase-js / postgrest-js on failed requests. */
interface PostgrestLikeError {
  message?: string
  code?: string
}

const UNIQUE_VIOLATION = '23505'
const FOREIGN_KEY_VIOLATION = '23503'
const INSUFFICIENT_PRIVILEGE = '42501'
const INVALID_AUTHORIZATION = '28000'
const INVALID_PARAMETER = '22023'

/**
 * Our own SQL functions/triggers raise exceptions with a Thai message
 * already (see supabase/migrations/0001_init.sql), so a matching error
 * code isn't automatically "generic" — only fall back to a canned
 * message when Postgres's own (English) text came through instead.
 */
function looksLikeFriendlyMessage(message: string | undefined): message is string {
  return Boolean(message && /[฀-๿]/.test(message))
}

/**
 * Converts a raw error (Supabase, network, or unknown) into a safe,
 * user-facing Thai message. Full details are always logged to the console
 * for developers instead of being shown to the user.
 */
export function toFriendlyErrorMessage(error: unknown, fallback = 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'): string {
  if (error instanceof SupabaseNotConfiguredError) {
    return error.message
  }

  console.error(error)

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'ไม่สามารถเชื่อมต่ออินเทอร์เน็ตได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่'
  }

  const pgError = error as PostgrestLikeError
  if (pgError?.code === UNIQUE_VIOLATION) {
    return 'ข้อมูลนี้มีอยู่ในระบบแล้ว'
  }
  if (pgError?.code === FOREIGN_KEY_VIOLATION) {
    return 'ไม่สามารถดำเนินการได้ เนื่องจากข้อมูลที่เกี่ยวข้องไม่ถูกต้อง'
  }
  if (pgError?.code === INSUFFICIENT_PRIVILEGE) {
    return looksLikeFriendlyMessage(pgError.message) ? pgError.message : 'คุณไม่มีสิทธิ์ดำเนินการนี้'
  }
  if (pgError?.code === INVALID_AUTHORIZATION) {
    return looksLikeFriendlyMessage(pgError.message) ? pgError.message : 'กรุณาเข้าสู่ระบบก่อนใช้งาน'
  }
  if (pgError?.code === INVALID_PARAMETER) {
    return looksLikeFriendlyMessage(pgError.message) ? pgError.message : 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง'
  }

  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้ กรุณาลองใหม่อีกครั้ง'
  }

  return fallback
}
