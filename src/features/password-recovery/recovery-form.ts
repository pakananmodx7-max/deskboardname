import { toFriendlyErrorMessage } from '@/lib/errors'

/** Same policy as sign-up (and Supabase's default minimum). */
export const MIN_PASSWORD_LENGTH = 6
/** Supabase Auth (bcrypt) ignores anything past 72 bytes. */
export const MAX_PASSWORD_LENGTH = 72

export type RecoveryAudience = 'teacher' | 'student'

/**
 * Where each audience's recovery pages live. The reset path is what the
 * email link lands on (redirectTo) — it must be listed in Supabase Auth →
 * URL Configuration → Redirect URLs. The audience only picks pages and
 * wording; it never grants anything (the recovery session does).
 */
export const RECOVERY_ROUTES = {
  teacher: { loginPath: '/login', forgotPath: '/forgot-password', resetPath: '/reset-password', emailLabel: 'อีเมล', loginButton: 'ไปหน้าเข้าสู่ระบบสำหรับคุณครู' },
  student: { loginPath: '/student/login', forgotPath: '/student/forgot-password', resetPath: '/student/reset-password', emailLabel: 'อีเมลนักเรียน', loginButton: 'ไปหน้าเข้าสู่ระบบนักเรียน' },
} as const

/** Seconds before "ส่งอีกครั้ง" is enabled — matches Supabase's per-email limit. */
export const RESEND_COOLDOWN_SECONDS = 60

/** Pure form check — returns a Thai message, or null when the input is fine. */
export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `รหัสผ่านต้องมีอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_LENGTH) return `รหัสผ่านยาวเกินไป (ไม่เกิน ${MAX_PASSWORD_LENGTH} ตัวอักษรภาษาอังกฤษ)`
  if (!password.trim()) return 'รหัสผ่านต้องไม่เป็นช่องว่างทั้งหมด'
  if (password !== confirm) return 'รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน'
  return null
}

/** supabase-js AuthError fields used to tell recovery failures apart. */
interface AuthLikeError {
  code?: string
  status?: number
  name?: string
  message?: string
}

/**
 * Thai messages for the recovery pages (teacher and student).
 * None of these reveal whether an email has an account.
 */
export function recoveryErrorMessage(error: unknown): string {
  const e = (error ?? {}) as AuthLikeError
  const text = `${e.code ?? ''} ${e.message ?? ''}`
  if (e.status === 429 || /rate_limit|rate limit|only request this after/i.test(text)) {
    return 'มีการขอลิงก์บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่'
  }
  if (/same_password|should be different from the old password/i.test(text)) {
    return 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม'
  }
  if (/weak_password|password should|password is known to be weak/i.test(text)) {
    return 'รหัสผ่านนี้ไม่ปลอดภัยพอ กรุณาใช้รหัสผ่านที่ยาวขึ้นหรือคาดเดายากขึ้น'
  }
  if (/error sending recovery email|sending email/i.test(text) || (e.status ?? 0) >= 500) {
    return 'ขณะนี้ระบบส่งอีเมลไม่ได้ กรุณาลองใหม่ภายหลัง'
  }
  return toFriendlyErrorMessage(error)
}

/** The recovery session is gone or no longer valid (expired, revoked). */
export function isRecoverySessionError(error: unknown): boolean {
  const e = (error ?? {}) as AuthLikeError
  return e.name === 'AuthSessionMissingError' || e.status === 401 || e.status === 403 || /session_not_found|session missing|jwt expired|bad_jwt/i.test(`${e.code ?? ''} ${e.message ?? ''}`)
}
