import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'

import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoginBackground, LoginCredit } from '@/features/login-decoration/login-decoration'
import { useAuth } from '@/lib/auth-context'
import { dataMode } from '@/lib/data-mode'

import { RECOVERY_ROUTES, RESEND_COOLDOWN_SECONDS, recoveryErrorMessage, type RecoveryAudience } from './recovery-form'

/**
 * "ลืมรหัสผ่าน?" — /forgot-password (teacher) and /student/forgot-password.
 * Asks Supabase Auth (resetPasswordForEmail) to email a recovery link that
 * lands on this audience's reset page on this origin. The confirmation is
 * the same whether or not the email has an account; the button is locked
 * while sending and for a cooldown afterwards.
 */
export function RequestRecoveryPage({ audience }: { audience: RecoveryAudience }) {
  const routes = RECOVERY_ROUTES[audience]
  const { sendPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  if (dataMode === 'demo') {
    return <Navigate to={audience === 'teacher' ? '/teacher/dashboard' : '/student/login'} replace />
  }

  async function send() {
    if (submitting || cooldown > 0) return
    setSubmitting(true)
    setError(null)
    try {
      await sendPasswordReset(email.trim(), routes.resetPath)
      setSent(true)
      setCooldown(RESEND_COOLDOWN_SECONDS)
    } catch (err) {
      setError(recoveryErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void send()
  }

  const footer = (
    <div>
      <Link to={routes.loginPath} className="font-medium text-primary hover:underline">
        กลับไปหน้าเข้าสู่ระบบ
      </Link>
      <LoginCredit />
    </div>
  )

  if (sent) {
    return (
      <AuthShell title="ตรวจสอบอีเมลของคุณ" background={<LoginBackground />} footer={footer}>
        <div className="space-y-4">
          <p role="status" className="text-sm text-foreground">
            หากอีเมลนี้มีบัญชีในระบบ เราจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้
          </p>
          <p className="text-sm text-muted-foreground">ตรวจสอบกล่องจดหมายและโฟลเดอร์สแปม ลิงก์ใช้ได้ครั้งเดียวและมีอายุจำกัด</p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="button" variant="secondary" className="w-full" disabled={submitting || cooldown > 0} onClick={() => void send()}>
            {submitting ? 'กำลังส่ง...' : cooldown > 0 ? `ส่งอีกครั้งได้ใน ${cooldown} วินาที` : 'ส่งลิงก์อีกครั้ง'}
          </Button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="ลืมรหัสผ่าน?"
      description="กรอกอีเมลที่ใช้สมัคร เพื่อรับลิงก์ตั้งรหัสผ่านใหม่"
      background={<LoginBackground />}
      footer={footer}
    >
      <form className="space-y-4" onSubmit={handleSubmit} noValidate={false}>
        {error && <p role="alert" id={`${audience}-forgot-error`} className="text-sm text-destructive">{error}</p>}

        <div className="space-y-1.5">
          <Label htmlFor={`${audience}-forgot-email`}>{routes.emailLabel}</Label>
          <Input
            id={`${audience}-forgot-email`}
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${audience}-forgot-error` : undefined}
            required
          />
        </div>

        <Button type="submit" className="w-full" disabled={submitting} aria-busy={submitting}>
          {submitting ? 'กำลังส่ง...' : 'ส่งลิงก์ตั้งรหัสผ่านใหม่'}
        </Button>
      </form>
    </AuthShell>
  )
}
