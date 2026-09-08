import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/lib/auth-context'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { deriveMyLinkStatus, getMyLinkRequests } from '@/services/student-link-service'
import type { StudentLinkRequestStatus } from '@/types/student-link-request'

/**
 * Status page for the student's own link request — derives everything
 * from student_account_link_requests (the caller's own rows, fully
 * visible to them via student_account_link_requests_select_own_or_teacher
 * in 0008), never from the students table directly (which stays
 * completely closed to a student account in this phase — see
 * deriveMyLinkStatus's doc comment). The 'approved' state is
 * deliberately a stub, not a real dashboard — Student Portal Phase 1
 * ends at "linked," Phase 2 is what actually reads classroom/attendance/
 * assignment data through students.linked_profile_id = auth.uid().
 */
export function StudentPendingPage() {
  const { signOut } = useAuth()
  const navigate = useNavigate()

  const [status, setStatus] = useState<StudentLinkRequestStatus | 'none' | null>(null)
  const [reviewNote, setReviewNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    getMyLinkRequests()
      .then((requests) => {
        if (!active) return
        const result = deriveMyLinkStatus(requests)
        if (result.status === 'none') {
          navigate('/student/link-account', { replace: true })
          return
        }
        setStatus(result.status)
        setReviewNote(result.status === 'rejected' ? result.request.reviewNote : null)
      })
      .catch((err: unknown) => {
        if (active) setError(toFriendlyErrorMessage(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [navigate])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        กำลังโหลด...
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>สถานะบัญชีนักเรียน</CardTitle>
            <CardDescription>สถานะการเชื่อมบัญชีของคุณ</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {error && <p className="text-destructive">{error}</p>}

            {status === 'pending' && (
              <p className="rounded-md border border-border bg-accent/40 p-3 text-center">
                คำขอเชื่อมบัญชีของคุณกำลังรอการอนุมัติจากครูผู้สอน กรุณารอสักครู่แล้วกลับมาตรวจสอบอีกครั้ง
              </p>
            )}

            {status === 'approved' && (
              <div className="space-y-2">
                <p className="rounded-md border border-success/40 bg-success/10 p-3 text-center text-success-foreground">
                  บัญชีของคุณเชื่อมกับข้อมูลนักเรียนเรียบร้อยแล้ว
                </p>
                <p className="text-center text-xs text-muted-foreground">แดชบอร์ดนักเรียนจะเปิดให้ใช้งานเร็วๆ นี้</p>
              </div>
            )}

            {status === 'rejected' && (
              <div className="space-y-3">
                <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-center text-destructive">
                  คำขอเชื่อมบัญชีของคุณถูกปฏิเสธ{reviewNote ? `: ${reviewNote}` : ''}
                </p>
                <Button type="button" className="w-full" onClick={() => navigate('/student/link-account')}>
                  ลองอีกครั้ง
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Button type="button" variant="ghost" className="w-full" onClick={() => signOut()}>
          ออกจากระบบ
        </Button>
      </div>
    </div>
  )
}
