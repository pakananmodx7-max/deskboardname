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
import { copyLessonToClassrooms, createLesson, updateLesson } from '@/services/lesson-service'
import { getSubjectById, getSubjectClassrooms } from '@/services/subject-service'
import type { Lesson, LessonCopyTarget } from '@/types/lesson'
import type { SubjectClassroom } from '@/types/subject'

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
  // The full just-created record — needed (not just its id) to pass as
  // `source` to copyLessonToClassrooms on the finish step below.
  const [createdLesson, setCreatedLesson] = useState<Lesson | null>(null)
  const isCreateFlowFinishStep = !isEditing && Boolean(currentLessonId)

  // "เผยแพร่ไปยังห้อง" — every OTHER classroom this same subject is linked
  // to, fetched via the exact same getSubjectClassrooms already used by
  // getLessonCopyTargets (lesson-service.ts) — never a second,
  // differently-scoped classroom query. subjectName is fetched here too
  // (via the existing getSubjectById) purely to label targets — deliberately
  // NOT a required prop, so every existing call site's exact JSX stays
  // untouched. Only ever loaded for the CREATE flow (never editing — an
  // already-created lesson's own copy is "คัดลอกไปห้องอื่น" on its row
  // menu, a fully separate, explicit action).
  const [subjectName, setSubjectName] = useState<string | null>(null)
  const [classroomTargets, setClassroomTargets] = useState<SubjectClassroom[]>([])
  const [selectedExtraClassroomIds, setSelectedExtraClassroomIds] = useState<Set<string>>(new Set())
  const otherClassroomTargets = classroomTargets.filter((c) => c.classroomId !== classroomId)
  const showClassroomPicker = !isEditing && Boolean(subjectName) && otherClassroomTargets.length > 0

  useEffect(() => {
    if (!open) return
    setForm(lesson ? { title: lesson.title, description: lesson.description ?? '' } : emptyForm())
    setCurrentLessonId(lesson?.id ?? null)
    setCreatedLesson(null)
    setSelectedExtraClassroomIds(new Set())
    setError(null)

    if (!lesson) {
      getSubjectById(subjectId)
        .then((subject) => setSubjectName(subject?.name ?? null))
        .catch(() => setSubjectName(null))
      getSubjectClassrooms(subjectId)
        .then(setClassroomTargets)
        .catch(() => setClassroomTargets([]))
    } else {
      setSubjectName(null)
      setClassroomTargets([])
    }
  }, [open, lesson, subjectId])

  function toggleExtraClassroom(classroomIdToToggle: string) {
    setSelectedExtraClassroomIds((prev) => {
      const next = new Set(prev)
      if (next.has(classroomIdToToggle)) next.delete(classroomIdToToggle)
      else next.add(classroomIdToToggle)
      return next
    })
  }

  function selectAllExtraClassrooms() {
    setSelectedExtraClassroomIds(new Set(otherClassroomTargets.map((c) => c.classroomId)))
  }

  /** Same "closing at all must refresh the caller's list once a NEW
   * lesson was actually created" reasoning as AssignmentDialog's
   * handleOpenChange. */
  function handleOpenChange(next: boolean) {
    if (!next && !isEditing && currentLessonId) {
      onSaved()
    }
    onOpenChange(next)
  }

  /**
   * Runs on the explicit "เสร็จสิ้น" click only (not on Escape/backdrop-
   * close) — by then the teacher has had the chance to attach materials
   * to the source lesson first, so copyLessonToClassrooms (via
   * getLessonResources at call time) carries those materials over to
   * every selected extra classroom too. Never a new copy implementation —
   * the exact same production function this dialog's own row-menu
   * "คัดลอกไปห้องอื่น" action uses.
   */
  async function copyToExtraClassroomsThenClose() {
    if (createdLesson && selectedExtraClassroomIds.size > 0 && subjectName) {
      const targets: LessonCopyTarget[] = otherClassroomTargets
        .filter((c) => selectedExtraClassroomIds.has(c.classroomId))
        .map((c) => ({
          subjectId,
          subjectName,
          classroomId: c.classroomId,
          classroomName: c.classroomName ?? '',
        }))
      setSubmitting(true)
      try {
        const outcomes = await copyLessonToClassrooms(createdLesson, targets)
        const failed = outcomes.filter((o) => !o.ok).length
        if (failed === 0) toast(`เพิ่มบทเรียนไปยังอีก ${outcomes.length} ห้องแล้ว`)
        else toast(`เพิ่มบทเรียนสำเร็จ ${outcomes.length - failed}/${outcomes.length} ห้อง — ไม่สำเร็จ ${failed} ห้อง`)
      } catch (err) {
        toast(toFriendlyErrorMessage(err, 'ไม่สามารถเพิ่มบทเรียนไปยังห้องอื่นได้'))
      } finally {
        setSubmitting(false)
      }
    }
    handleOpenChange(false)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    if (isCreateFlowFinishStep) {
      await copyToExtraClassroomsThenClose()
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
        setCreatedLesson(created)
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

          {showClassroomPicker && !isCreateFlowFinishStep && (
            <div className="space-y-1.5 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <Label>เผยแพร่ไปยังห้อง</Label>
                <Button type="button" variant="ghost" size="sm" onClick={selectAllExtraClassrooms} disabled={submitting}>
                  เลือกทั้งหมด
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                ใช้บทเรียนนี้กับห้องอื่นในรายวิชา "{subjectName}" ด้วย — แต่ละห้องจะได้บทเรียนที่เป็นอิสระต่อกัน (เผยแพร่แยกกัน)
              </p>
              <div className="max-h-40 space-y-1 overflow-y-auto">
                <label className="flex cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-sm opacity-70">
                  <input type="checkbox" checked disabled className="size-4 rounded border-input" />
                  ห้องปัจจุบัน{' '}
                  {classroomTargets.find((c) => c.classroomId === classroomId)?.classroomName ?? ''}
                </label>
                {otherClassroomTargets.map((c) => (
                  <label
                    key={c.classroomId}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <input
                      type="checkbox"
                      checked={selectedExtraClassroomIds.has(c.classroomId)}
                      onChange={() => toggleExtraClassroom(c.classroomId)}
                      disabled={submitting}
                      className="size-4 rounded border-input"
                    />
                    {c.classroomName}
                  </label>
                ))}
              </div>
            </div>
          )}

          {isCreateFlowFinishStep && selectedExtraClassroomIds.size > 0 && (
            <p className="text-xs text-muted-foreground">
              กด "เสร็จสิ้น" เพื่อเพิ่มบทเรียนนี้ไปยังอีก {selectedExtraClassroomIds.size} ห้องที่เลือกไว้ด้วย
            </p>
          )}

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
