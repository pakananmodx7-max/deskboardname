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
import { NativeSelect } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { createAssignment, updateAssignment } from '@/services/assignment-service'
import type { Assignment } from '@/types/assignment'
import type { Topic } from '@/types/topic'

interface AssignmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  subjectId: string
  classroomId: string
  topics: Topic[]
  /** Present = editing this assignment; absent = creating a new one. */
  assignment?: Assignment | null
  onSaved: () => void
}

const NO_TOPIC = '__no_topic__'

function emptyForm() {
  return { title: '', topicId: NO_TOPIC, maxScore: '100', dueDate: '', description: '' }
}

/**
 * Real, Supabase-backed create/edit assignment dialog — subjectId and
 * classroomId are fixed by the workspace this dialog is opened from
 * (never user-editable fields here), so every assignment it creates is
 * scoped to exactly that subject+classroom pair. See
 * subjects-real/tabs/assignments-tab.tsx for where this is opened.
 */
export function AssignmentDialog({
  open,
  onOpenChange,
  subjectId,
  classroomId,
  topics,
  assignment,
  onSaved,
}: AssignmentDialogProps) {
  const { toast } = useToast()
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const isEditing = Boolean(assignment)

  useEffect(() => {
    if (!open) return
    setForm(
      assignment
        ? {
            title: assignment.title,
            topicId: assignment.topicId ?? NO_TOPIC,
            maxScore: String(assignment.maxScore),
            dueDate: assignment.dueDate ?? '',
            description: assignment.description ?? '',
          }
        : emptyForm(),
    )
    setError(null)
  }, [open, assignment])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const maxScore = Number(form.maxScore)
    if (!form.title.trim()) {
      setError('กรุณากรอกชื่อเรื่อง')
      return
    }
    if (!Number.isFinite(maxScore) || maxScore <= 0) {
      setError('กรุณากรอกคะแนนเต็มให้ถูกต้อง')
      return
    }

    const topicId = form.topicId === NO_TOPIC ? null : form.topicId

    setSubmitting(true)
    setError(null)
    try {
      if (isEditing && assignment) {
        await updateAssignment(assignment.id, {
          title: form.title.trim(),
          topicId,
          maxScore,
          dueDate: form.dueDate || null,
          description: form.description.trim() || null,
        })
        toast('บันทึกงานแล้ว')
      } else {
        await createAssignment({
          subjectId,
          classroomId,
          title: form.title.trim(),
          topicId,
          maxScore,
          dueDate: form.dueDate || null,
          description: form.description.trim() || null,
        })
        toast('เพิ่มงานใหม่แล้ว')
      }
      onOpenChange(false)
      onSaved()
    } catch (err) {
      setError(toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกงานได้'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'แก้ไขงาน' : 'เพิ่มงาน'}</DialogTitle>
          <DialogDescription>{isEditing ? 'แก้ไขรายละเอียดงานนี้' : 'เพิ่มงานหรือแบบทดสอบใหม่ในห้องเรียนนี้'}</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <Label htmlFor="real-assignment-title">ชื่อเรื่อง *</Label>
            <Input
              id="real-assignment-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="real-assignment-topic">หัวข้อที่เกี่ยวข้อง</Label>
            <NativeSelect
              id="real-assignment-topic"
              className="w-full"
              value={form.topicId}
              onChange={(e) => setForm((f) => ({ ...f, topicId: e.target.value }))}
            >
              <option value={NO_TOPIC}>ไม่ระบุหัวข้อ</option>
              {topics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.title}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="real-assignment-max-score">คะแนนเต็ม *</Label>
              <Input
                id="real-assignment-max-score"
                type="number"
                min={1}
                value={form.maxScore}
                onChange={(e) => setForm((f) => ({ ...f, maxScore: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="real-assignment-due">กำหนดส่ง</Label>
              <Input
                id="real-assignment-due"
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="real-assignment-description">รายละเอียด</Label>
            <Textarea
              id="real-assignment-description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'กำลังบันทึก...' : isEditing ? 'บันทึก' : 'เพิ่มงาน'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
