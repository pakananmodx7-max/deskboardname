import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'

import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth-context'
import { dataMode } from '@/lib/data-mode'
import { toFriendlyErrorMessage } from '@/lib/errors'

export function ForgotPasswordPage() {
  const { sendPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  if (dataMode === 'demo') {
    return <Navigate to="/teacher/dashboard" replace />
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await sendPasswordReset(email.trim())
      setSent(true)
    } catch (err) {
      setError(toFriendlyErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (sent) {
    return (
      <AuthShell title="ตรวจสอบอีเมลของคุณ">
        <p className="text-sm text-muted-foreground">
          หากมีบัญชีที่ใช้อีเมล <span className="font-medium text-foreground">{email.trim()}</span> อยู่ในระบบ
          เราได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปให้แล้ว
        </p>
        <Link to="/login" className="block text-sm font-medium text-primary hover:underline">
          กลับไปหน้าเข้าสู่ระบบ
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="ลืมรหัสผ่าน"
      description="กรอกอีเมลที่ใช้สมัครไว้ เราจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ให้"
      footer={
        <Link to="/login" className="font-medium text-primary hover:underline">
          กลับไปหน้าเข้าสู่ระบบ
        </Link>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-1.5">
          <Label htmlFor="forgot-email">อีเมล</Label>
          <Input
            id="forgot-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'กำลังส่ง...' : 'ส่งลิงก์ตั้งรหัสผ่านใหม่'}
        </Button>
      </form>
    </AuthShell>
  )
}
