import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'

import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoginBackground, LoginCredit } from '@/features/login-decoration/login-decoration'
import { useAuth } from '@/lib/auth-context'
import { dataMode } from '@/lib/data-mode'

import { RESEND_COOLDOWN_SECONDS, studentRecoveryErrorMessage } from './password-recovery-form'

/**
 * /student/forgot-password — asks Supabase Auth to email a recovery link
 * that lands on /student/reset-password (this origin; it must be in the
 * project's allowed Redirect URLs). The confirmation is the same whether
 * or not the email has an account, so the page cannot be used to find out
 * who is registered.
 */
export function StudentForgotPasswordPage() {
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
    return <Navigate to="/student/login" replace />
  }

  async function send() {
    setSubmitting(true)
    setError(null)
    try {
      await sendPasswordReset(email.trim(), '/student/reset-password')
      setSent(true)
      setCooldown(RESEND_COOLDOWN_SECONDS)
    } catch (err) {
      setError(studentRecoveryErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void send()
  }

  const backToLogin = (
    <Link to="/student/login" className="font-medium text-primary hover:underline">
      กลับไปหน้าเข้าสู่ระบบ
    </Link>
  )

  if (sent) {
    return (
      <AuthShell title="ตรวจสอบอีเมลของคุณ" background={<LoginBackground />} footer={<div>{backToLogin}<LoginCredit /></div>}>
        <div className="space-y-4">
          <p role="status" className="text-sm text-foreground">
            หากอีเมลนี้มีบัญชีในระบบ เราจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้
          </p>
          <p className="text-sm text-muted-foreground">ตรวจสอบกล่องจดหมายและโฟลเดอร์สแปม ลิงก์ใช้ได้ครั้งเดียวและมีอายุจำกัด</p>
          {error && <p className="text-sm text-destructive">{error}</p>}
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
      footer={<div>{backToLogin}<LoginCredit /></div>}
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-1.5">
          <Label htmlFor="student-forgot-email">อีเมลนักเรียน</Label>
          <Input id="student-forgot-email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'กำลังส่ง...' : 'ส่งลิงก์ตั้งรหัสผ่านใหม่'}
        </Button>
      </form>
    </AuthShell>
  )
}
