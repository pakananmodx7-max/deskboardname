import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth-context'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { deriveMyLinkStatus, getMyLinkRequests, getMyRole } from '@/services/student-link-service'

/**
 * Separate from /login on purpose — a teacher and a student sign in
 * against the exact same Supabase Auth (email+password), but this page
 * routes them somewhere completely different afterward. Right after
 * signIn() resolves, this checks the account's role directly (rather
 * than waiting on AuthProvider's own async profile fetch, which could
 * still be in flight) so a non-student account is rejected and signed
 * back out immediately, before ever reaching a student-only page.
 */
export function StudentLoginPage() {
  const { signIn, signOut } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await signIn(email.trim(), password)

      const role = await getMyRole()
      if (role !== 'student') {
        await signOut()
        setError('บัญชีนี้ไม่ใช่บัญชีนักเรียน กรุณาเข้าสู่ระบบที่หน้าสำหรับคุณครูแทน')
        return
      }

      const requests = await getMyLinkRequests()
      const linkStatus = deriveMyLinkStatus(requests)
      navigate(linkStatus.status === 'none' ? '/student/link-account' : '/student/pending', { replace: true })
    } catch (err) {
      setError(toFriendlyErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      title="เข้าสู่ระบบ"
      description="สำหรับนักเรียน"
      footer={
        <div className="space-y-1">
          <p>
            ยังไม่มีบัญชี?{' '}
            <Link to="/student/signup" className="font-medium text-primary hover:underline">
              สมัครใช้งาน
            </Link>
          </p>
          <p>
            เป็นคุณครู?{' '}
            <Link to="/login" className="font-medium text-primary hover:underline">
              เข้าสู่ระบบสำหรับคุณครู
            </Link>
          </p>
        </div>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-1.5">
          <Label htmlFor="student-login-email">อีเมล</Label>
          <Input
            id="student-login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="student-login-password">รหัสผ่าน</Label>
          <Input
            id="student-login-password"
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
