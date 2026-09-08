import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth-context'
import { toFriendlyErrorMessage } from '@/lib/errors'

const EMPTY_FORM = { displayName: '', email: '', password: '', confirmPassword: '' }

/**
 * Creates the STUDENT'S OWN auth account — a separate Supabase Auth user
 * from the `students` row a teacher already created for them. This does
 * NOT link the two; it only gets the student signed in so they can
 * submit a link request next, at /student/link-account. See
 * supabase/migrations/0008_student_account_links.sql.
 */
export function StudentSignupPage() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmationSent, setConfirmationSent] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    if (!form.displayName.trim()) {
      setError('กรุณากรอกชื่อที่แสดง')
      return
    }
    if (!form.email.trim()) {
      setError('กรุณากรอกอีเมล')
      return
    }
    if (form.password.length < 6) {
      setError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร')
      return
    }
    if (form.password !== form.confirmPassword) {
      setError('รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const { needsEmailConfirmation } = await signUp({
        email: form.email.trim(),
        password: form.password,
        displayName: form.displayName.trim(),
        intendedRole: 'student',
      })
      if (needsEmailConfirmation) {
        setConfirmationSent(true)
      } else {
        navigate('/student/link-account', { replace: true })
      }
    } catch (err) {
      setError(toFriendlyErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (confirmationSent) {
    return (
      <AuthShell title="ยืนยันอีเมลของคุณ" description="เกือบเสร็จแล้ว">
        <p className="text-sm text-muted-foreground">
          เราได้ส่งลิงก์ยืนยันไปที่ <span className="font-medium text-foreground">{form.email.trim()}</span> แล้ว
          กรุณาตรวจสอบอีเมลและคลิกลิงก์เพื่อยืนยันบัญชีก่อนเข้าสู่ระบบ
        </p>
        <Link to="/student/login" className="block text-sm font-medium text-primary hover:underline">
          กลับไปหน้าเข้าสู่ระบบ
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="สมัครใช้งาน"
      description="สำหรับนักเรียน"
      footer={
        <>
          มีบัญชีอยู่แล้ว?{' '}
          <Link to="/student/login" className="font-medium text-primary hover:underline">
            เข้าสู่ระบบ
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-1.5">
          <Label htmlFor="student-signup-display-name">ชื่อที่แสดง</Label>
          <Input
            id="student-signup-display-name"
            placeholder="เช่น สมชาย ใจดี"
            value={form.displayName}
            onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="student-signup-email">อีเมล</Label>
          <Input
            id="student-signup-email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="student-signup-password">รหัสผ่าน</Label>
          <Input
            id="student-signup-password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="student-signup-confirm-password">ยืนยันรหัสผ่าน</Label>
          <Input
            id="student-signup-confirm-password"
            type="password"
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
            required
          />
        </div>

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'กำลังสมัคร...' : 'สมัครใช้งาน'}
        </Button>
      </form>
    </AuthShell>
  )
}
