import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth-context'
import { toFriendlyErrorMessage } from '@/lib/errors'
import {
  deriveMyLinkStatus,
  findStudentForLink,
  getMyLinkRequests,
  submitLinkRequest,
} from '@/services/student-link-service'
import type { StudentLinkCandidate } from '@/types/student-link-request'

/**
 * Entering a student_code here never links anything by itself — it only
 * calls the secure find_student_for_link RPC to confirm a match exists,
 * then (after the student explicitly confirms it's them) submits a
 * PENDING request via submitLinkRequest. The actual link
 * (students.linked_profile_id) is only ever set by a teacher approving
 * that request elsewhere — see 0008_student_account_links.sql.
 */
export function StudentLinkAccountPage() {
  const { signOut } = useAuth()
  const navigate = useNavigate()

  const [checkingExisting, setCheckingExisting] = useState(true)
  const [rejectedNote, setRejectedNote] = useState<string | null>(null)

  const [studentCode, setStudentCode] = useState('')
  const [candidate, setCandidate] = useState<StudentLinkCandidate | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [looking, setLooking] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const checkExisting = useCallback(() => {
    setCheckingExisting(true)
    getMyLinkRequests()
      .then((requests) => {
        const result = deriveMyLinkStatus(requests)
        if (result.status === 'pending' || result.status === 'approved') {
          navigate('/student/pending', { replace: true })
          return
        }
        if (result.status === 'rejected') {
          setRejectedNote(result.request.reviewNote)
        }
      })
      .catch(() => {
        // Not fatal — worst case the student just sees the blank form.
      })
      .finally(() => setCheckingExisting(false))
  }, [navigate])

  useEffect(() => {
    checkExisting()
  }, [checkExisting])

  async function handleLookup(event: FormEvent) {
    event.preventDefault()
    setLookupError(null)
    setCandidate(null)
    setLooking(true)
    try {
      const result = await findStudentForLink(studentCode.trim())
      if (!result) {
        setLookupError('ไม่พบรหัสนักเรียนนี้ หรือรหัสนี้เชื่อมบัญชีไปแล้ว กรุณาตรวจสอบอีกครั้งหรือติดต่อครูผู้สอน')
        return
      }
      setCandidate(result)
    } catch (err) {
      setLookupError(toFriendlyErrorMessage(err))
    } finally {
      setLooking(false)
    }
  }

  async function handleConfirm() {
    if (!candidate) return
    setSubmitError(null)
    setSubmitting(true)
    try {
      await submitLinkRequest(candidate.studentId)
      navigate('/student/pending', { replace: true })
    } catch (err) {
      setSubmitError(toFriendlyErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (checkingExisting) {
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
            <CardTitle>เชื่อมบัญชีนักเรียน</CardTitle>
            <CardDescription>กรอกรหัสนักเรียนที่ครูผู้สอนให้ไว้ เพื่อส่งคำขอเชื่อมบัญชี</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {rejectedNote !== null && (
              <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
                คำขอก่อนหน้าของคุณถูกปฏิเสธ{rejectedNote ? `: ${rejectedNote}` : ''} กรุณาตรวจสอบรหัสนักเรียนแล้วลองใหม่อีกครั้ง
              </p>
            )}

            {!candidate ? (
              <form className="space-y-4" onSubmit={handleLookup}>
                {lookupError && <p className="text-sm text-destructive">{lookupError}</p>}
                <div className="space-y-1.5">
                  <Label htmlFor="link-student-code">รหัสนักเรียน</Label>
                  <Input
                    id="link-student-code"
                    value={studentCode}
                    onChange={(e) => setStudentCode(e.target.value)}
                    placeholder="เช่น 12345"
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={looking || !studentCode.trim()}>
                  {looking ? 'กำลังค้นหา...' : 'ค้นหา'}
                </Button>
              </form>
            ) : (
              <div className="space-y-4">
                {submitError && <p className="text-sm text-destructive">{submitError}</p>}
                <p className="text-sm text-muted-foreground">ใช่นักเรียนคนนี้หรือไม่?</p>
                <p className="rounded-md border border-border bg-accent/40 p-3 text-center text-base font-medium">
                  {candidate.firstName} {candidate.lastName}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    disabled={submitting}
                    onClick={() => {
                      setCandidate(null)
                      setStudentCode('')
                    }}
                  >
                    ไม่ใช่
                  </Button>
                  <Button type="button" className="flex-1" disabled={submitting} onClick={handleConfirm}>
                    {submitting ? 'กำลังส่งคำขอ...' : 'ใช่ ส่งคำขอ'}
                  </Button>
                </div>
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
