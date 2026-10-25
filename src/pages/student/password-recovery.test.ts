import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { parseRecoveryLink, recoveryLinkErrorMessage } from '@/lib/password-recovery'

import { isRecoverySessionError, MIN_PASSWORD_LENGTH, studentRecoveryErrorMessage, validateNewPassword } from './password-recovery-form'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf-8')
const BASE = 'https://krunameclass.com/student/reset-password'

describe('parseRecoveryLink — what kind of link opened the page', () => {
  it('default email link: a recovery session in the hash', () => {
    expect(parseRecoveryLink(`${BASE}#access_token=aaa&expires_in=3600&refresh_token=bbb&token_type=bearer&type=recovery`)).toEqual({ recovery: true, tokenHash: null, error: null })
  })

  it('expired / used link: the error the auth server put in the hash', () => {
    expect(parseRecoveryLink(`${BASE}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`)).toEqual({
      recovery: false,
      tokenHash: null,
      error: { code: 'otp_expired', description: 'Email link is invalid or has expired' },
    })
  })

  it('token_hash link (template linking straight to the app)', () => {
    expect(parseRecoveryLink(`${BASE}?token_hash=xyz&type=recovery`)).toEqual({ recovery: true, tokenHash: 'xyz', error: null })
  })

  it('a sign-up confirmation or a plain visit is not a recovery', () => {
    expect(parseRecoveryLink(`${BASE}#access_token=a&refresh_token=b&expires_in=1&token_type=bearer&type=signup`).recovery).toBe(false)
    expect(parseRecoveryLink(BASE)).toEqual({ recovery: false, tokenHash: null, error: null })
    expect(parseRecoveryLink(`${BASE}?type=recovery`).recovery).toBe(false)
  })

  it('Thai message for link errors', () => {
    expect(recoveryLinkErrorMessage({ code: 'otp_expired', description: '' })).toBe('ลิงก์ตั้งรหัสผ่านใหม่หมดอายุหรือถูกใช้ไปแล้ว')
    expect(recoveryLinkErrorMessage({ code: 'access_denied', description: 'bad' })).toBe('ลิงก์ตั้งรหัสผ่านใหม่ไม่ถูกต้องหรือหมดอายุ')
  })
})

describe('reset form rules', () => {
  it('uses the existing policy (at least 6 characters) and requires matching passwords', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(6)
    expect(validateNewPassword('12345', '12345')).toBe('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร')
    expect(validateNewPassword('123456', '123457')).toBe('รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน')
    expect(validateNewPassword('123456', '123456')).toBeNull()
  })

  it('error messages never say whether an email is registered', () => {
    expect(studentRecoveryErrorMessage({ status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' })).toBe('มีการขอลิงก์บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่')
    expect(studentRecoveryErrorMessage({ status: 422, code: 'same_password', message: 'New password should be different from the old password.' })).toBe('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม')
    expect(studentRecoveryErrorMessage({ status: 422, code: 'weak_password', message: 'Password is known to be weak' })).toContain('ไม่ปลอดภัยพอ')
    expect(studentRecoveryErrorMessage({ status: 500, message: 'Error sending recovery email' })).toBe('ขณะนี้ระบบส่งอีเมลไม่ได้ กรุณาลองใหม่ภายหลัง')
    for (const m of ['มีการขอลิงก์บ่อยเกินไป', 'ขณะนี้ระบบส่งอีเมลไม่ได้']) expect(m).not.toMatch(/ไม่พบ|ไม่มีบัญชี/)
  })

  it('recognises an expired or missing recovery session', () => {
    expect(isRecoverySessionError({ name: 'AuthSessionMissingError', message: 'Auth session missing!' })).toBe(true)
    expect(isRecoverySessionError({ status: 401, message: 'invalid JWT' })).toBe(true)
    expect(isRecoverySessionError({ status: 422, code: 'same_password' })).toBe(false)
  })
})

describe('wiring', () => {
  const router = read('../../app/router.tsx')
  const auth = read('../../lib/auth-context.tsx')

  it('both student recovery routes are public (no guard can redirect away)', () => {
    expect(router).toContain("{ path: 'student/forgot-password', element: <StudentForgotPasswordPage /> }")
    expect(router).toContain("{ path: 'student/reset-password', element: <StudentResetPasswordPage /> }")
  })

  it('student login links to the student recovery page under the password field', () => {
    const login = read('./login-page.tsx')
    expect(login).toMatch(/autoComplete="current-password"[\s\S]*?<Link to="\/student\/forgot-password"[^>]*>\s*ลืมรหัสผ่าน\?\s*<\/Link>/)
  })

  it('the student link lands on /student/reset-password; the teacher default is unchanged', () => {
    expect(read('./forgot-password-page.tsx')).toContain("await sendPasswordReset(email.trim(), '/student/reset-password')")
    expect(auth).toContain("async sendPasswordReset(email, redirectPath = '/reset-password') {")
    expect(auth).toContain('redirectTo: `${window.location.origin}${redirectPath}`,')
    expect(read('../auth/forgot-password-page.tsx')).toContain('await sendPasswordReset(email.trim())')
  })

  it('the recovery link is read before the Supabase client is created (it clears the hash)', () => {
    const client = read('../../lib/supabase.ts')
    expect(client.indexOf('captureRecoveryLink()')).toBeGreaterThan(0)
    expect(client.indexOf('captureRecoveryLink()')).toBeLessThan(client.indexOf('createClient(supabaseUrl'))
  })

  it('the form requires a recovery link, and the session is signed out after saving', () => {
    const page = read('./reset-password-page.tsx')
    expect(page).toContain('if (linkError || !user || !isRecoveryInProgress()) {')
    expect(page).toContain('clearRecoveryState()')
    expect(page).toContain('await client.auth.signOut()')
    expect(page).toContain('scrubAuthParamsFromUrl()')
  })

  it('no service-role key or token logging in the browser code', () => {
    for (const p of ['./reset-password-page.tsx', './forgot-password-page.tsx', '../../lib/password-recovery.ts', '../../lib/supabase.ts']) {
      const src = read(p)
      expect(src).not.toMatch(/service_role|SERVICE_ROLE/)
      expect(src).not.toMatch(/console\.(log|info|debug)\(/)
    }
  })
})
