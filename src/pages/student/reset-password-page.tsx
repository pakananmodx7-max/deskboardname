import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'

import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoginBackground, LoginCredit } from '@/features/login-decoration/login-decoration'
import { useAuth } from '@/lib/auth-context'
import { dataMode } from '@/lib/data-mode'
import {
  clearRecoveryState,
  isRecoveryInProgress,
  markRecoveryInProgress,
  recoveryLinkError,
  recoveryLinkErrorMessage,
  recoveryTokenHash,
  scrubAuthParamsFromUrl,
} from '@/lib/password-recovery'
import { getSupabaseClient } from '@/lib/supabase'

import { isRecoverySessionError, MIN_PASSWORD_LENGTH, studentRecoveryErrorMessage, validateNewPassword } from './password-recovery-form'

/**
 * /student/reset-password — where the recovery email's link lands. A public
 * route (no guard redirects away from it). The form appears only when the
 * page was opened from a recovery link (supabase-js has signed in with the
 * link's one-time session, or a token_hash link was verified here); any
 * other visit, and expired / used / invalid links, get a clear message and
 * a way to ask for a new link. Tokens are removed from the address bar.
 * After saving, the recovery session is signed out everywhere and the
 * student goes back to the student login.
 */
export function StudentResetPasswordPage() {
  const { status, user, updatePassword } = useAuth()
  const [linkError, setLinkError] = useState(() => (recoveryLinkError() ? recoveryLinkErrorMessage(recoveryLinkError()) : null))
  const [tokenHash] = useState(recoveryTokenHash)
  const [verifying, setVerifying] = useState(() => Boolean(tokenHash))
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  // A token_hash link: verify it here (the default email link is handled by
  // supabase-js itself before this page renders).
  useEffect(() => {
    if (!verifying || status !== 'ready' || !tokenHash) return
    let active = true
    getSupabaseClient()
      .auth.verifyOtp({ type: 'recovery', token_hash: tokenHash })
      .then(({ error: verifyError }) => {
        if (!active) return
        if (verifyError) setLinkError(recoveryLinkErrorMessage({ code: verifyError.code ?? '', description: verifyError.message }))
        else markRecoveryInProgress()
      })
      .finally(() => active && setVerifying(false))
    return () => {
      active = false
    }
  }, [verifying, status, tokenHash])

  // Once supabase-js has read the link, take tokens/errors out of the URL.
  useEffect(() => {
    if (status === 'ready' && !verifying) scrubAuthParamsFromUrl()
  }, [status, verifying])

  if (dataMode === 'demo') {
    return <Navigate to="/student/login" replace />
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const invalid = validateNewPassword(password, confirmPassword)
    if (invalid) {
      setError(invalid)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await updatePassword(password)
    } catch (err) {
      setSubmitting(false)
      if (isRecoverySessionError(err)) {
        clearRecoveryState()
        setLinkError('ลิงก์ตั้งรหัสผ่านใหม่หมดอายุแล้ว')
      } else {
        setError(studentRecoveryErrorMessage(err))
      }
      return
    }
    // Saved. End the recovery session (all devices); fall back to this
    // device only if the server cannot be reached.
    clearRecoveryState()
    setPassword('')
    setConfirmPassword('')
    setDone(true)
    setSubmitting(false)
    const client = getSupabaseClient()
    const { error: signOutError } = await client.auth.signOut()
    if (signOutError) await client.auth.signOut({ scope: 'local' })
  }

  const shell = (title: string, children: ReactNode, description?: string) => (
    <AuthShell title={title} description={description} background={<LoginBackground />} footer={<div><LoginCredit /></div>}>
      {children}
    </AuthShell>
  )

  if (done) {
    return shell(
      'ตั้งรหัสผ่านใหม่สำเร็จ',
      <div className="space-y-4">
        <p role="status" className="text-sm text-muted-foreground">เข้าสู่ระบบด้วยรหัสผ่านใหม่ได้ทันที</p>
        <Button asChild className="w-full">
          <Link to="/student/login" replace>
            ไปหน้าเข้าสู่ระบบนักเรียน
          </Link>
        </Button>
      </div>,
    )
  }

  if (status === 'loading' || verifying) {
    return shell('ตั้งรหัสผ่านใหม่', <p role="status" className="text-sm text-muted-foreground">กำลังตรวจสอบลิงก์...</p>)
  }

  if (linkError || !user || !isRecoveryInProgress()) {
    return shell(
      'ลิงก์ใช้งานไม่ได้',
      <div className="space-y-4">
        <p role="alert" className="text-sm text-foreground">
          {linkError ?? 'ลิงก์ตั้งรหัสผ่านใหม่ไม่ถูกต้องหรือหมดอายุ'} กรุณาขอลิงก์ใหม่อีกครั้ง
        </p>
        <Button asChild className="w-full">
          <Link to="/student/forgot-password" replace>
            ขอลิงก์ตั้งรหัสผ่านใหม่
          </Link>
        </Button>
        <Link to="/student/login" className="block text-center text-sm font-medium text-primary hover:underline">
          กลับไปหน้าเข้าสู่ระบบ
        </Link>
      </div>,
    )
  }

  return shell(
    'ตั้งรหัสผ่านใหม่',
    <form className="space-y-4" onSubmit={handleSubmit}>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {user.email && <p className="text-sm text-muted-foreground">บัญชี {user.email}</p>}

      <div className="space-y-1.5">
        <Label htmlFor="student-new-password">รหัสผ่านใหม่</Label>
        <Input id="student-new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required aria-describedby="student-new-password-hint" />
        <p id="student-new-password-hint" className="text-xs text-muted-foreground">อย่างน้อย {MIN_PASSWORD_LENGTH} ตัวอักษร</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="student-confirm-password">ยืนยันรหัสผ่านใหม่</Label>
        <Input id="student-confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
      </div>

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? 'กำลังบันทึก...' : 'บันทึกรหัสผ่านใหม่'}
      </Button>
    </form>,
  )
}
