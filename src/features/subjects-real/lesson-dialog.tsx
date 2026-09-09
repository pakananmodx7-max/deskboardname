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
import { LessonResourcesSection } from '@/features/subjects-real/lesson-resources-section'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { createLesson, updateLesson } from '@/services/lesson-service'
import type { Lesson } from '@/types/lesson'

interface LessonDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  subjectId: string
  classroomId: string
  nextSortOrder: number
  /** Present = editing this lesson; absent = creating a new one. */
  lesson?: Lesson | null
  onSaved: () => void
}

function emptyForm() {
  return { title: '', description: '' }
}

/**
 * Real, Supabase-backed create/edit lesson dialog. Lessons are NOT
 * assignments — no due date, no max score, no submission status
 * anywhere in this dialog (see 0015_lessons.sql's scope note). A newly
 * created lesson always starts as a draft (is_published = false); the
 * teacher publishes it explicitly from LessonsTab once it's ready,
 * mirroring AssignmentDialog's "create then continue" flow for adding
 * resources before the teacher is done.
 */
export function LessonDialog({ open, onOpenChange, subjectId, classroomId, nextSortOrder, lesson, onSaved }: LessonDialogProps) {
  const { toast } = useToast()
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const isEditing = Boolean(lesson)

  // Present once a real lesson id exists to attach resources to — either
  // from the start (editing) or set the moment createLesson() succeeds
  // below ("create then continue": a lesson_resources row has a NOT NULL
  // FK to lessons.id).
  const [currentLessonId, setCurrentLessonId] = useState<string | null>(null)
  const isCreateFlowFinishStep = !isEditing && Boolean(currentLessonId)

  useEffect(() => {
    if (!open) return
    setForm(lesson ? { title: lesson.title, description: lesson.description ?? '' } : emptyForm())
    setCurrentLessonId(lesson?.id ?? null)
    setError(null)
  }, [open, lesson])

  /** Same "closing at all must refresh the caller's list once a NEW
   * lesson was actually created" reasoning as AssignmentDialog's
   * handleOpenChange. */
  function handleOpenChange(next: boolean) {
    if (!next && !isEditing && currentLessonId) {
      onSaved()
    }
    onOpenChange(next)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    if (isCreateFlowFinishStep) {
      handleOpenChange(false)
      return
    }

    if (!form.title.trim()) {
      setError('กรุณากรอกชื่อบทเรียน')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      if (isEditing && lesson) {
        await updateLesson(lesson.id, {
          title: form.title.trim(),
          description: form.description.trim() || null,
        })
        toast('บันทึกบทเรียนแล้ว')
        onOpenChange(false)
        onSaved()
      } else {
        const created = await createLesson(
          { subjectId, classroomId, title: form.title.trim(), description: form.description.trim() || null },
          nextSortOrder,
        )
        toast('เพิ่มบทเรียนใหม่แล้ว — เพิ่มสื่อการสอนได้เลย')
        setCurrentLessonId(created.id)
      }
    } catch (err) {
      setError(toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกบทเรียนได้'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'แก้ไขบทเรียน' : isCreateFlowFinishStep ? 'เพิ่มสื่อการสอน' : 'เพิ่มบทเรียน'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'แก้ไขรายละเอียดบทเรียนนี้'
              : isCreateFlowFinishStep
                ? 'เพิ่มสไลด์ วิดีโอ เอกสาร หรือลิงก์ แล้วกด "เสร็จสิ้น" เมื่อเรียบร้อย'
                : 'เพิ่มบทเรียนใหม่ในห้องเรียนนี้ — เผยแพร่ให้นักเรียนเห็นได้ภายหลัง'}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <Label htmlFor="lesson-title">ชื่อบทเรียน *</Label>
            <Input
              id="lesson-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="เช่น บทที่ 1 แรงและการเคลื่อนที่"
              disabled={isCreateFlowFinishStep}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lesson-description">รายละเอียด</Label>
            <Textarea
              id="lesson-description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              disabled={isCreateFlowFinishStep}
            />
          </div>

          {currentLessonId && <LessonResourcesSection lessonId={currentLessonId} subjectId={subjectId} classroomId={classroomId} />}

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'กำลังบันทึก...' : isCreateFlowFinishStep ? 'เสร็จสิ้น' : isEditing ? 'บันทึก' : 'เพิ่มบทเรียน'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
