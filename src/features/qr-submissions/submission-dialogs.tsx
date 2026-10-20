import { Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import type { Assignment, LatePolicy, SubmissionStatus } from '@/types/assignment'

import { isoToSchoolLocalInput, schoolLocalInputToIso } from './scan-model'

const CORRECTION_OPTIONS: { status: SubmissionStatus; label: string; hint: string }[] = [
  { status: 'submitted', label: 'ส่งแล้ว', hint: 'ส่งงานแล้ว (ตรงเวลา)' },
  { status: 'late', label: 'ส่งช้า', hint: 'ส่งงานหลังกำหนด' },
  { status: 'not_submitted', label: 'ยังไม่ส่ง', hint: 'เช่น สแกนผิดคน — ล้างเวลาที่ส่ง' },
  { status: 'missing', label: 'ขาดส่ง', hint: 'ไม่ส่งงานชิ้นนี้' },
  { status: 'excused', label: 'ยกเว้น', hint: 'ได้รับการยกเว้น ไม่นับเป็นงานค้าง' },
]

/** Audited status correction — a reason is required and stored with the
 * previous values; the score is never changed here. */
export function CorrectionDialog({
  target,
  onSubmit,
  onClose,
}: {
  target: { studentName: string; assignmentTitle: string; currentStatus: SubmissionStatus } | null
  onSubmit: (status: SubmissionStatus, reason: string) => Promise<void>
  onClose: () => void
}) {
  const [status, setStatus] = useState<SubmissionStatus | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const chosen = status ?? target?.currentStatus ?? 'not_submitted'

  function reset() {
    setStatus(null)
    setReason('')
    setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (reason.trim().length < 3) {
      setError('กรุณาระบุเหตุผลในการแก้ไข (อย่างน้อย 3 ตัวอักษร)')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit(chosen, reason.trim())
      reset()
      onClose()
    } catch (err) {
      setError(toFriendlyErrorMessage(err, 'แก้ไขไม่สำเร็จ'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !busy) {
          reset()
          onClose()
        }
      }}
    >
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>แก้ไขสถานะการส่งงาน</DialogTitle>
            <DialogDescription>
              {target?.studentName} · {target?.assignmentTitle} — ระบบจะบันทึกประวัติการแก้ไขไว้ คะแนนไม่ถูกเปลี่ยน
            </DialogDescription>
          </DialogHeader>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">สถานะใหม่</legend>
            {CORRECTION_OPTIONS.map((option) => (
              <label
                key={option.status}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors',
                  chosen === option.status ? 'border-primary bg-primary/8' : 'border-border hover:bg-accent/50',
                )}
              >
                <input type="radio" name="correction-status" value={option.status} checked={chosen === option.status} onChange={() => setStatus(option.status)} className="mt-1 accent-primary" />
                <span>
                  <span className="block text-sm font-semibold">{option.label}</span>
                  <span className="block text-xs text-muted-foreground">{option.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="grid gap-1.5">
            <Label htmlFor="correction-reason">เหตุผล (จำเป็น)</Label>
            <Textarea id="correction-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} placeholder="เช่น สแกนผิดคน, มีใบลาป่วย" />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              ยกเลิก
            </Button>
            <Button type="submit" disabled={busy || chosen === target?.currentStatus}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              บันทึกการแก้ไข
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Deadline (school time), late policy and open/closed for one assignment. */
export function SubmissionSettingsDialog({
  assignment,
  onSubmit,
  onClose,
}: {
  assignment: Assignment | null
  onSubmit: (input: { submissionDeadline: string | null; latePolicy: LatePolicy; acceptingSubmissions: boolean }) => Promise<void>
  onClose: () => void
}) {
  return (
    <Dialog open={assignment !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        {assignment && <SettingsForm key={assignment.id} assignment={assignment} onSubmit={onSubmit} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function SettingsForm({
  assignment,
  onSubmit,
  onClose,
}: {
  assignment: Assignment
  onSubmit: (input: { submissionDeadline: string | null; latePolicy: LatePolicy; acceptingSubmissions: boolean }) => Promise<void>
  onClose: () => void
}) {
  const [deadline, setDeadline] = useState(isoToSchoolLocalInput(assignment.submissionDeadline))
  const [latePolicy, setLatePolicy] = useState<LatePolicy>(assignment.latePolicy)
  const [accepting, setAccepting] = useState(assignment.acceptingSubmissions)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const iso = deadline ? schoolLocalInputToIso(deadline) : null
    if (deadline && !iso) {
      setError('วันเวลากำหนดส่งไม่ถูกต้อง')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ submissionDeadline: iso, latePolicy, acceptingSubmissions: accepting })
      onClose()
    } catch (err) {
      setError(toFriendlyErrorMessage(err, 'บันทึกไม่สำเร็จ'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>ตั้งค่าการรับงาน</DialogTitle>
        <DialogDescription>{assignment.title} — ใช้กับการสแกน QR และการบันทึกจากรายชื่อ</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="submission-deadline">กำหนดส่ง (เวลาประเทศไทย)</Label>
        <div className="flex gap-2">
          <input
            id="submission-deadline"
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          {deadline && (
            <Button type="button" variant="outline" onClick={() => setDeadline('')}>
              ล้าง
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {deadline
            ? 'ส่งหลังเวลานี้จะถือว่าส่งช้า'
            : assignment.dueDate
              ? `ไม่ระบุเวลา — ใช้วันกำหนดส่งของงาน (${assignment.dueDate}) ถึง 23:59 น.`
              : 'ไม่มีกำหนดส่ง — จะไม่มีการบันทึกว่าส่งช้า'}
        </p>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">หลังกำหนดส่ง</legend>
        {(
          [
            { value: 'accept_late', label: 'รับงาน และบันทึกเป็น “ส่งช้า”' },
            { value: 'reject_late', label: 'ไม่รับงานหลังกำหนด' },
          ] as const
        ).map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-sm">
            <input type="radio" name="late-policy" checked={latePolicy === option.value} onChange={() => setLatePolicy(option.value)} className="accent-primary" />
            {option.label}
          </label>
        ))}
      </fieldset>
      <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5 text-sm">
        <span>
          <span className="block font-medium">เปิดรับงาน</span>
          <span className="block text-xs text-muted-foreground">ปิดเมื่อไม่ต้องการรับงานนี้อีก</span>
        </span>
        <input type="checkbox" role="switch" checked={accepting} onChange={(e) => setAccepting(e.target.checked)} className="size-5 accent-primary" />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          ยกเลิก
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          บันทึก
        </Button>
      </DialogFooter>
    </form>
  )
}
