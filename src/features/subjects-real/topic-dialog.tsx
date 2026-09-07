import { useEffect, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { createTopic, deleteTopic, updateTopic } from '@/services/topic-service'
import type { Topic } from '@/types/topic'

interface TopicDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  subjectId: string
  topic?: Topic | null
  nextPosition: number
  onSaved: () => void
}

function emptyForm(nextPosition: number) {
  return { title: '', description: '', position: String(nextPosition), taughtDate: '' }
}

export function TopicDialog({ open, onOpenChange, subjectId, topic, nextPosition, onSaved }: TopicDialogProps) {
  const { toast } = useToast()
  const [form, setForm] = useState(emptyForm(nextPosition))
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const isEditing = Boolean(topic)

  useEffect(() => {
    if (open) {
      setForm(
        topic
          ? {
              title: topic.title,
              description: topic.description ?? '',
              position: String(topic.position),
              taughtDate: topic.taughtDate ?? '',
            }
          : emptyForm(nextPosition),
      )
      setError(null)
    }
  }, [open, topic, nextPosition])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!form.title.trim()) {
      setError('กรุณากรอกชื่อหัวข้อ')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      if (isEditing && topic) {
        await updateTopic(topic.id, {
          title: form.title.trim(),
          description: form.description.trim() || null,
          position: Number(form.position) || topic.position,
          taughtDate: form.taughtDate || null,
        })
        toast('บันทึกหัวข้อแล้ว')
      } else {
        await createTopic({
          subjectId,
          title: form.title.trim(),
          description: form.description.trim() || null,
          position: Number(form.position) || nextPosition,
          taughtDate: form.taughtDate || null,
        })
        toast('เพิ่มหัวข้อแล้ว')
      }
      onSaved()
      onOpenChange(false)
    } catch (err) {
      setError(toFriendlyErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete() {
    if (!topic) return
    setSubmitting(true)
    setError(null)
    try {
      await deleteTopic(topic.id)
      toast('ลบหัวข้อแล้ว')
      onSaved()
      onOpenChange(false)
    } catch (err) {
      setError(toFriendlyErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'รายละเอียดหัวข้อ' : 'เพิ่มหัวข้อ'}</DialogTitle>
          <DialogDescription>{isEditing ? 'แก้ไขหรือลบหัวข้อนี้' : 'เพิ่มหัวข้อการสอนใหม่'}</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <Label htmlFor="topic-title-real">ชื่อหัวข้อ *</Label>
            <Input
              id="topic-title-real"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="topic-description-real">คำอธิบาย</Label>
            <Textarea
              id="topic-description-real"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="topic-position-real">ลำดับ</Label>
              <Input
                id="topic-position-real"
                type="number"
                min={1}
                value={form.position}
                onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="topic-date-real">วันที่สอน</Label>
              <Input
                id="topic-date-real"
                type="date"
                value={form.taughtDate}
                onChange={(e) => setForm((f) => ({ ...f, taughtDate: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter className="sm:justify-between">
            {isEditing ? (
              <Button type="button" variant="destructive" onClick={handleDelete} disabled={submitting}>
                ลบหัวข้อ
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={submitting}>
              {isEditing ? 'บันทึก' : 'เพิ่มหัวข้อ'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
