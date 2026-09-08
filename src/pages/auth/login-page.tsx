import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'

import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth-context'
import { dataMode } from '@/lib/data-mode'
import { toFriendlyErrorMessage } from '@/lib/errors'

export function LoginPage() {
  const { user, signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (dataMode === 'demo' || user) {
    return <Navigate to="/teacher/dashboard" replace />
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await signIn(email.trim(), password)
      navigate('/teacher/dashboard', { replace: true })
    } catch (err) {
      setError(toFriendlyErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      title="เข้าสู่ระบบ"
      description="สำหรับคุณครู"
      footer={
        <div className="space-y-1">
          <p>
            ยังไม่มีบัญชี?{' '}
            <Link to="/signup" className="font-medium text-primary hover:underline">
              สมัครใช้งาน
            </Link>
          </p>
          <p>
            เป็นนักเรียน?{' '}
            <Link to="/student/login" className="font-medium text-primary hover:underline">
              เข้าสู่ระบบสำหรับนักเรียน
            </Link>
          </p>
        </div>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-1.5">
          <Label htmlFor="login-email">อีเมล</Label>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="login-password">รหัสผ่าน</Label>
            <Link to="/forgot-password" className="text-xs text-primary hover:underline">
              ลืมรหัสผ่าน?
            </Link>
          </div>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
        </Button>
      </form>
    </AuthShell>
  )
}
