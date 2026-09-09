import { useEffect, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { createMyCalendarEntry, updateMyCalendarEntry } from '@/services/student-portal-service'
import type { MyCalendarEntry } from '@/types/student-portal'

interface CalendarEntryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pass an existing entry to edit it in place; omit to create a new one. */
  entry?: MyCalendarEntry | null
  onSaved: (entry: MyCalendarEntry) => void
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Create/edit form for a student's own private calendar note — never
 * used for an assignment due date (those are read-only, pulled straight
 * from getMyAssignments, and never pass an `entry` here). */
export function CalendarEntryDialog({ open, onOpenChange, entry, onSaved }: CalendarEntryDialogProps) {
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [eventDate, setEventDate] = useState(todayIso())
  const [eventTime, setEventTime] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle(entry?.title ?? '')
    setNote(entry?.note ?? '')
    setEventDate(entry?.eventDate ?? todayIso())
    setEventTime(entry?.eventTime ?? '')
    setError(null)
  }, [open, entry])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) {
      setError('กรุณากรอกหัวข้อ')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const input = {
        title: title.trim(),
        note: note.trim() || null,
        eventDate,
        eventTime: eventTime || null,
      }
      const saved = entry ? await updateMyCalendarEntry(entry.id, input) : await createMyCalendarEntry(input)
      onSaved(saved)
      onOpenChange(false)
    } catch (err) {
      setError(toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกรายการได้'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entry ? 'แก้ไขบันทึก' : 'เพิ่มบันทึกในปฏิทิน'}</DialogTitle>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <Label htmlFor="calendar-entry-title">หัวข้อ *</Label>
            <Input id="calendar-entry-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="calendar-entry-date">วันที่ *</Label>
              <Input
                id="calendar-entry-date"
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="calendar-entry-time">เวลา</Label>
              <Input id="calendar-entry-time" type="time" value={eventTime} onChange={(e) => setEventTime(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="calendar-entry-note">รายละเอียด</Label>
            <Textarea id="calendar-entry-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
