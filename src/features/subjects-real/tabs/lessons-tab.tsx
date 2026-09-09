import { BookOpen, ChevronDown, ChevronUp, Eye, EyeOff, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { RowActionsMenu } from '@/components/ui/row-actions-menu'
import { useToast } from '@/components/ui/toast'
import { LessonDialog } from '@/features/subjects-real/lesson-dialog'
import { toFriendlyErrorMessage } from '@/lib/errors'
import {
  archiveLesson,
  computeNextLessonSortOrder,
  getLessons,
  publishLesson,
  reorderLessons,
  reorderLessonsLocally,
  unpublishLesson,
} from '@/services/lesson-service'
import type { Lesson } from '@/types/lesson'
import type { Subject } from '@/types/subject'

interface LessonsTabProps {
  subject: Subject
  classroomId: string
}

/**
 * "บทเรียน" — teacher-organized learning materials (slides, videos,
 * documents, external links), completely separate from the assignment
 * workflow (see 0015_lessons.sql's scope note). A lesson starts as a
 * draft; publishing it is what makes it (and its resources) visible to
 * enrolled students — see LessonDialog/LessonResourcesSection for
 * managing an individual lesson's own resources.
 *
 * Archived lessons are hidden from this list by default (never
 * hard-deleted — see the migration's "No delete policy" note), matching
 * the same no-hard-delete convention as assignments/subjects/classrooms.
 */
export function LessonsTab({ subject, classroomId }: LessonsTabProps) {
  const { toast } = useToast()

  const [lessons, setLessons] = useState<Lesson[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null)
  const [archivingLesson, setArchivingLesson] = useState<Lesson | null>(null)
  const [publishBusyId, setPublishBusyId] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    return getLessons(subject.id, classroomId)
      .then(setLessons)
      .catch((err: unknown) => setError(toFriendlyErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [subject.id, classroomId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const visibleLessons = lessons.filter((l) => !l.isArchived)

  async function handleTogglePublish(lesson: Lesson) {
    setPublishBusyId(lesson.id)
    try {
      const updated = lesson.isPublished ? await unpublishLesson(lesson.id) : await publishLesson(lesson.id)
      setLessons((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))
      toast(updated.isPublished ? `เผยแพร่ "${updated.title}" แล้ว` : `ยกเลิกเผยแพร่ "${updated.title}" แล้ว`)
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถเปลี่ยนสถานะเผยแพร่ได้'))
    } finally {
      setPublishBusyId(null)
    }
  }

  async function handleArchive() {
    if (!archivingLesson) return
    try {
      await archiveLesson(archivingLesson.id)
      toast(`เก็บถาวรบทเรียน "${archivingLesson.title}" แล้ว`)
      setArchivingLesson(null)
      refresh()
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถเก็บถาวรบทเรียนได้'))
    }
  }

  async function handleMove(index: number, direction: -1 | 1) {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= visibleLessons.length) return

    const reordered = reorderLessonsLocally(visibleLessons, index, targetIndex)
    setLessons((prev) => {
      const archived = prev.filter((l) => l.isArchived)
      return [...reordered, ...archived]
    })
    try {
      await reorderLessons(reordered.map((l) => ({ id: l.id, sortOrder: l.sortOrder })))
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถจัดลำดับบทเรียนใหม่ได้'))
      refresh()
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{loading ? 'กำลังโหลด...' : `${visibleLessons.length} บทเรียน`}</p>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          เพิ่มบทเรียน
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && visibleLessons.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <BookOpen className="size-6" />
            </div>
            <p className="text-sm font-medium">ยังไม่มีบทเรียนในห้องเรียนนี้</p>
            <Button onClick={() => setCreateOpen(true)}>เพิ่มบทเรียน</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {visibleLessons.map((lesson, index) => (
            <Card key={lesson.id}>
              <CardContent className="flex items-start justify-between gap-3 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold">{lesson.title}</p>
                    <Badge variant={lesson.isPublished ? 'success' : 'outline'}>
                      {lesson.isPublished ? 'เผยแพร่แล้ว' : 'ฉบับร่าง'}
                    </Badge>
                  </div>
                  {lesson.description && <p className="mt-1 truncate text-xs text-muted-foreground">{lesson.description}</p>}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={index === 0}
                    onClick={() => handleMove(index, -1)}
                    aria-label="เลื่อนขึ้น"
                  >
                    <ChevronUp className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={index === visibleLessons.length - 1}
                    onClick={() => handleMove(index, 1)}
                    aria-label="เลื่อนลง"
                  >
                    <ChevronDown className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={publishBusyId === lesson.id}
                    onClick={() => handleTogglePublish(lesson)}
                  >
                    {lesson.isPublished ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    {lesson.isPublished ? 'ยกเลิกเผยแพร่' : 'เผยแพร่'}
                  </Button>
                  <RowActionsMenu
                    actions={[
                      { key: 'edit', label: 'แก้ไข/เพิ่มสื่อการสอน', onSelect: () => setEditingLesson(lesson) },
                      { key: 'archive', label: 'เก็บถาวร', onSelect: () => setArchivingLesson(lesson) },
                    ]}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <LessonDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        subjectId={subject.id}
        classroomId={classroomId}
        nextSortOrder={computeNextLessonSortOrder(lessons)}
        onSaved={refresh}
      />

      {editingLesson && (
        <LessonDialog
          open={Boolean(editingLesson)}
          onOpenChange={(open) => !open && setEditingLesson(null)}
          subjectId={subject.id}
          classroomId={classroomId}
          nextSortOrder={computeNextLessonSortOrder(lessons)}
          lesson={editingLesson}
          onSaved={() => {
            setEditingLesson(null)
            refresh()
          }}
        />
      )}

      {archivingLesson && (
        <ConfirmDialog
          open={Boolean(archivingLesson)}
          onOpenChange={(open) => !open && setArchivingLesson(null)}
          title="เก็บถาวรบทเรียน"
          description={`เก็บถาวร "${archivingLesson.title}"?\nบทเรียนนี้จะไม่แสดงในรายการอีกต่อไป และนักเรียนจะไม่เห็นบทเรียนนี้ (สื่อการสอนยังคงอยู่ในระบบ)`}
          confirmLabel="เก็บถาวร"
          onConfirm={handleArchive}
        />
      )}
    </div>
  )
}
