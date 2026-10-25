import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { parseRecoveryLink, recoveryLinkErrorMessage } from '@/lib/password-recovery'

import { isRecoverySessionError, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, RECOVERY_ROUTES, recoveryErrorMessage, validateNewPassword } from './recovery-form'

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
    expect(validateNewPassword('      ', '      ')).toBe('รหัสผ่านต้องไม่เป็นช่องว่างทั้งหมด')
    expect(validateNewPassword('a'.repeat(MAX_PASSWORD_LENGTH + 1), 'a'.repeat(MAX_PASSWORD_LENGTH + 1))).toContain('ยาวเกินไป')
  })

  it('error messages never say whether an email is registered', () => {
    expect(recoveryErrorMessage({ status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' })).toBe('มีการขอลิงก์บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่')
    expect(recoveryErrorMessage({ status: 422, code: 'same_password', message: 'New password should be different from the old password.' })).toBe('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม')
    expect(recoveryErrorMessage({ status: 422, code: 'weak_password', message: 'Password is known to be weak' })).toContain('ไม่ปลอดภัยพอ')
    expect(recoveryErrorMessage({ status: 500, message: 'Error sending recovery email' })).toBe('ขณะนี้ระบบส่งอีเมลไม่ได้ กรุณาลองใหม่ภายหลัง')
    for (const m of ['มีการขอลิงก์บ่อยเกินไป', 'ขณะนี้ระบบส่งอีเมลไม่ได้']) expect(m).not.toMatch(/ไม่พบ|ไม่มีบัญชี/)
  })

  it('recognises an expired or missing recovery session', () => {
    expect(isRecoverySessionError({ name: 'AuthSessionMissingError', message: 'Auth session missing!' })).toBe(true)
    expect(isRecoverySessionError({ status: 401, message: 'invalid JWT' })).toBe(true)
    expect(isRecoverySessionError({ status: 422, code: 'same_password' })).toBe(false)
  })
})

describe('wiring', () => {
  const read2 = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf-8')
  const router = read2('../../app/router.tsx')
  const auth = read2('../../lib/auth-context.tsx')

  it('every redirect target is a real, public route (no guard can redirect away)', () => {
    expect(RECOVERY_ROUTES.teacher.resetPath).toBe('/reset-password')
    expect(RECOVERY_ROUTES.student.resetPath).toBe('/student/reset-password')
    expect(router).toContain("{ path: 'forgot-password', element: <ForgotPasswordPage /> }")
    expect(router).toContain("{ path: 'reset-password', element: <ResetPasswordPage /> }")
    expect(router).toContain("{ path: 'student/forgot-password', element: <StudentForgotPasswordPage /> }")
    expect(router).toContain("{ path: 'student/reset-password', element: <StudentResetPasswordPage /> }")
  })

  it('both login pages link to their own recovery page', () => {
    expect(read2('../../pages/student/login-page.tsx')).toMatch(/autoComplete="current-password"[\s\S]*?<Link to="\/student\/forgot-password"[^>]*>\s*ลืมรหัสผ่าน\?\s*<\/Link>/)
    expect(read2('../../pages/auth/login-page.tsx')).toMatch(/<Link to="\/forgot-password"[^>]*>\s*ลืมรหัสผ่าน\?\s*<\/Link>/)
  })

  it('the emailed link lands on <origin><audience reset path>', () => {
    expect(read2('./request-recovery-page.tsx')).toContain('await sendPasswordReset(email.trim(), routes.resetPath)')
    expect(auth).toContain('redirectTo: `${window.location.origin}${redirectPath}`,')
    expect(read2('../../pages/auth/forgot-password-page.tsx')).toContain('<RequestRecoveryPage audience="teacher" />')
    expect(read2('../../pages/student/forgot-password-page.tsx')).toContain('<RequestRecoveryPage audience="student" />')
    expect(read2('../../pages/auth/reset-password-page.tsx')).toContain('<ResetPasswordView audience="teacher" />')
    expect(read2('../../pages/student/reset-password-page.tsx')).toContain('<ResetPasswordView audience="student" />')
  })

  it('the recovery link is read before the Supabase client is created (it clears the hash)', () => {
    const client = read2('../../lib/supabase.ts')
    expect(client.indexOf('captureRecoveryLink()')).toBeGreaterThan(0)
    expect(client.indexOf('captureRecoveryLink()')).toBeLessThan(client.indexOf('createClient(supabaseUrl'))
  })

  it('the form requires a recovery link; after saving: signed out, login chosen from the verified profile role', () => {
    const page = read2('./reset-password-view.tsx')
    expect(page).toContain('if (linkError || !user || !isRecoveryInProgress()) {')
    expect(page).toContain("if (profile) setLoginPath(profile.role === 'student' ? RECOVERY_ROUTES.student.loginPath : RECOVERY_ROUTES.teacher.loginPath)")
    expect(page).toContain('await client.auth.signOut()')
    expect(page).toContain('scrubAuthParamsFromUrl()')
  })

  it('"/" sends a recovery session to the reset form for either role', () => {
    const root = read2('../../pages/root/root-page.tsx')
    expect(root).toContain('if (isRecoveryInProgress()) return <Navigate to="/student/reset-password" replace />')
    expect(root).toContain('if (isRecoveryInProgress()) return <Navigate to="/reset-password" replace />')
  })

  it('password fields have a labelled show/hide control', () => {
    const input = read2('./password-input.tsx')
    expect(input).toContain("aria-label={visible ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}")
    expect(input).toContain('aria-pressed={visible}')
  })

  it('no service-role key or token logging in the browser code', () => {
    for (const p of ['./reset-password-view.tsx', './request-recovery-page.tsx', '../../lib/password-recovery.ts', '../../lib/supabase.ts']) {
      const src = read2(p)
      expect(src).not.toMatch(/service_role|SERVICE_ROLE/)
      expect(src).not.toMatch(/console\.(log|info|debug)\(/)
    }
  })
})
