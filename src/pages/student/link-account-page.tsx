import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/select'
import { useAuth } from '@/lib/auth-context'
import { toFriendlyErrorMessage } from '@/lib/errors'
import {
  deriveMyLinkStatus,
  findStudentForLink,
  getMyLinkRequests,
  listClassroomsForStudentCode,
  submitLinkRequest,
} from '@/services/student-link-service'
import type { StudentLinkCandidate, StudentLinkClassroomOption } from '@/types/student-link-request'

/** When exactly one classroom contains an unlinked student with the
 * entered code, pre-select it — the student still has to confirm the
 * match on the next screen, so pre-selecting the only option removes a
 * pointless extra click without skipping the confirmation step itself.
 * With zero or multiple options there is nothing safe to default to. */
export function pickDefaultClassroom(options: StudentLinkClassroomOption[]): string | null {
  return options.length === 1 ? options[0].classroomId : null
}

type Step = 'code' | 'classroom' | 'confirm'

/**
 * Entering a student_code here never links anything by itself. Identity
 * is now confirmed by student_code + classroom together (not
 * student_code alone — it is not unique across the whole students
 * table, see 0009_student_link_classroom_lookup.sql), so the flow is:
 * 1. enter the code, look up which classroom(s) contain an unlinked
 *    student with that code (list_classrooms_for_student_code);
 * 2. pick the classroom;
 * 3. confirm the exact match within that classroom
 *    (find_student_for_link_in_classroom) and, once the student
 *    confirms it's them, submit a PENDING request via submitLinkRequest.
 * The actual link (students.linked_profile_id) is only ever set by a
 * teacher approving that request elsewhere.
 */
export function StudentLinkAccountPage() {
  const { signOut } = useAuth()
  const navigate = useNavigate()

  const [checkingExisting, setCheckingExisting] = useState(true)
  const [rejectedNote, setRejectedNote] = useState<string | null>(null)

  const [step, setStep] = useState<Step>('code')
  const [studentCode, setStudentCode] = useState('')
  const [classroomOptions, setClassroomOptions] = useState<StudentLinkClassroomOption[]>([])
  const [classroomId, setClassroomId] = useState('')
  const [candidate, setCandidate] = useState<StudentLinkCandidate | null>(null)

  const [lookupError, setLookupError] = useState<string | null>(null)
  const [matchError, setMatchError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [looking, setLooking] = useState(false)
  const [matching, setMatching] = useState(false)
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

  async function handleLookupClassrooms(event: FormEvent) {
    event.preventDefault()
    setLookupError(null)
    setLooking(true)
    try {
      const options = await listClassroomsForStudentCode(studentCode.trim())
      if (options.length === 0) {
        setLookupError('ไม่พบรหัสนักเรียนนี้ หรือรหัสนี้เชื่อมบัญชีไปแล้ว กรุณาตรวจสอบอีกครั้งหรือติดต่อครูผู้สอน')
        return
      }
      setClassroomOptions(options)
      setClassroomId(pickDefaultClassroom(options) ?? '')
      setStep('classroom')
    } catch (err) {
      setLookupError(toFriendlyErrorMessage(err))
    } finally {
      setLooking(false)
    }
  }

  async function handleMatchInClassroom(event: FormEvent) {
    event.preventDefault()
    setMatchError(null)
    setMatching(true)
    try {
      const result = await findStudentForLink(studentCode.trim(), classroomId)
      if (!result) {
        setMatchError('ไม่พบข้อมูลนักเรียนในห้องเรียนนี้ กรุณาตรวจสอบอีกครั้งหรือติดต่อครูผู้สอน')
        return
      }
      setCandidate(result)
      setStep('confirm')
    } catch (err) {
      setMatchError(toFriendlyErrorMessage(err))
    } finally {
      setMatching(false)
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

  function resetToCode() {
    setStep('code')
    setClassroomOptions([])
    setClassroomId('')
    setCandidate(null)
    setLookupError(null)
    setMatchError(null)
  }

  function backToClassroom() {
    setStep('classroom')
    setCandidate(null)
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
            <CardDescription>กรอกรหัสนักเรียนและเลือกห้องเรียนที่ครูผู้สอนให้ไว้ เพื่อส่งคำขอเชื่อมบัญชี</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {rejectedNote !== null && (
              <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
                คำขอก่อนหน้าของคุณถูกปฏิเสธ{rejectedNote ? `: ${rejectedNote}` : ''} กรุณาตรวจสอบรหัสนักเรียนแล้วลองใหม่อีกครั้ง
              </p>
            )}

            {step === 'code' && (
              <form className="space-y-4" onSubmit={handleLookupClassrooms}>
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
                  {looking ? 'กำลังค้นหา...' : 'ค้นหาห้องเรียน'}
                </Button>
              </form>
            )}

            {step === 'classroom' && (
              <form className="space-y-4" onSubmit={handleMatchInClassroom}>
                {matchError && <p className="text-sm text-destructive">{matchError}</p>}
                <div className="space-y-1.5">
                  <Label>รหัสนักเรียน</Label>
                  <p className="rounded-md border border-border bg-accent/40 px-3 py-2 text-sm">{studentCode}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="link-classroom">ห้องเรียน</Label>
                  <NativeSelect
                    id="link-classroom"
                    className="w-full"
                    value={classroomId}
                    onChange={(e) => setClassroomId(e.target.value)}
                    required
                  >
                    <option value="" disabled>
                      เลือกห้องเรียน
                    </option>
                    {classroomOptions.map((option) => (
                      <option key={option.classroomId} value={option.classroomId}>
                        {option.classroomName}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1" disabled={matching} onClick={resetToCode}>
                    แก้ไขรหัส
                  </Button>
                  <Button type="submit" className="flex-1" disabled={matching || !classroomId}>
                    {matching ? 'กำลังค้นหา...' : 'ค้นหา'}
                  </Button>
                </div>
              </form>
            )}

            {step === 'confirm' && candidate && (
              <div className="space-y-4">
                {submitError && <p className="text-sm text-destructive">{submitError}</p>}
                <p className="text-sm text-muted-foreground">ใช่นักเรียนคนนี้หรือไม่?</p>
                <div className="space-y-2 rounded-md border border-border bg-accent/40 p-3 text-center">
                  <p className="text-base font-medium">
                    {candidate.firstName} {candidate.lastName}
                  </p>
                  <p className="text-sm text-muted-foreground">{candidate.classroomName}</p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1" disabled={submitting} onClick={backToClassroom}>
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
