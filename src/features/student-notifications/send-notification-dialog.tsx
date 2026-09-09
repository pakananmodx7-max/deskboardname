import { useEffect, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/lib/auth-context'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { sendStudentNotification } from '@/services/notification-service'

interface SendNotificationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  studentId: string
  studentName: string
  onSent?: () => void
}

/**
 * The ONE "ส่งข้อความ" UI — both teacher entry points (Students page row
 * action, Subject -> Classroom -> นักเรียน drawer) render this same
 * component and call the same sendStudentNotification, so there is
 * exactly one mutation implementation regardless of which surface opened
 * it. Individual-recipient only for this phase (ผู้รับ is fixed to the
 * one student passed in — no multi-select, no classroom broadcast).
 */
export function SendNotificationDialog({ open, onOpenChange, studentId, studentName, onSent }: SendNotificationDialogProps) {
  const { profile } = useAuth()
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setTitle('')
      setMessage('')
      setError(null)
    }
  }, [open])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!message.trim()) {
      setError('กรุณากรอกข้อความ')
      return
    }
    if (!profile) {
      setError('ไม่พบข้อมูลผู้ใช้งาน กรุณาเข้าสู่ระบบใหม่')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await sendStudentNotification(studentId, profile.id, message.trim(), title)
      onOpenChange(false)
      onSent?.()
    } catch (err) {
      setError(toFriendlyErrorMessage(err, 'ไม่สามารถส่งข้อความได้'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ส่งข้อความถึงนักเรียน</DialogTitle>
          <DialogDescription>ข้อความจะแสดงในพอร์ทัลของนักเรียนทันที</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <Label>ผู้รับ</Label>
            <p className="rounded-md border border-input bg-muted/40 px-3 py-2 text-sm">{studentName}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notification-title">หัวข้อ</Label>
            <Input
              id="notification-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="ไม่บังคับ"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notification-message">ข้อความ *</Label>
            <Textarea
              id="notification-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              required
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'กำลังส่ง...' : 'ส่งข้อความ'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
