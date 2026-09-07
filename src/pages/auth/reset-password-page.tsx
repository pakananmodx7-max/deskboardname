import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'

import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth-context'
import { dataMode } from '@/lib/data-mode'
import { toFriendlyErrorMessage } from '@/lib/errors'

export function ResetPasswordPage() {
  const { user, updatePassword } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  if (dataMode === 'demo') {
    return <Navigate to="/teacher/dashboard" replace />
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (password.length < 6) {
      setError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร')
      return
    }
    if (password !== confirmPassword) {
      setError('รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await updatePassword(password)
      setDone(true)
    } catch (err) {
      setError(toFriendlyErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <AuthShell title="ตั้งรหัสผ่านใหม่สำเร็จ">
        <p className="text-sm text-muted-foreground">คุณสามารถเข้าสู่ระบบด้วยรหัสผ่านใหม่ได้ทันที</p>
        <Button className="w-full" onClick={() => navigate('/teacher/dashboard', { replace: true })}>
          ไปที่แดชบอร์ด
        </Button>
      </AuthShell>
    )
  }

  // supabase-js auto-detects the recovery token from the URL when the
  // teacher clicks the emailed link, establishing a temporary session — if
  // there's no user by the time this page renders, the link was invalid,
  // expired, or opened without going through email at all.
  if (!user) {
    return (
      <AuthShell title="ลิงก์ไม่ถูกต้องหรือหมดอายุ">
        <p className="text-sm text-muted-foreground">กรุณาขอลิงก์สำหรับตั้งรหัสผ่านใหม่อีกครั้ง</p>
        <Link to="/forgot-password" className="block text-sm font-medium text-primary hover:underline">
          ขอลิงก์ใหม่
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="ตั้งรหัสผ่านใหม่">
      <form className="space-y-4" onSubmit={handleSubmit}>
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-1.5">
          <Label htmlFor="reset-password">รหัสผ่านใหม่</Label>
          <Input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reset-confirm-password">ยืนยันรหัสผ่านใหม่</Label>
          <Input
            id="reset-confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'กำลังบันทึก...' : 'ตั้งรหัสผ่านใหม่'}
        </Button>
      </form>
    </AuthShell>
  )
}
