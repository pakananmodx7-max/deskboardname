import { BookOpen, ChevronDown, ChevronUp, Eye, EyeOff, Plus } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
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
import { RowActionsMenu } from '@/components/ui/row-actions-menu'
import { Textarea } from '@/components/ui/textarea'
import { useDemoClassroom } from '@/demo/demo-context'
import type { DemoLesson, DemoSubject } from '@/demo/types'

interface LessonsTabProps {
  subject: DemoSubject
  classroomId: string
}

function emptyForm() {
  return { title: '', description: '' }
}

/**
 * Demo mirror of subjects-real's LessonsTab — identical scope and
 * publish/archive/reorder rules, backed by demo-context state instead of
 * Supabase. Deliberately has NO per-resource (slide/video/document/link)
 * attachment management — demo mode has no real Storage to attach a
 * file to, matching the same precedent already set by assignment
 * resources (0013), which also has no demo-mode equivalent. See
 * DemoLesson's own comment in demo/types.ts.
 */
export function LessonsTab({ subject, classroomId }: LessonsTabProps) {
  const { lessons, addLesson, updateLesson, setLessonPublished, archiveLesson, reorderLessonsDemo } = useDemoClassroom()

  const [createOpen, setCreateOpen] = useState(false)
  const [editingLesson, setEditingLesson] = useState<DemoLesson | null>(null)
  const [archivingLesson, setArchivingLesson] = useState<DemoLesson | null>(null)
  const [form, setForm] = useState(emptyForm)

  const visibleLessons = lessons
    .filter((l) => l.subjectId === subject.id && l.classroomId === classroomId && !l.isArchived)
    .sort((a, b) => a.order - b.order)

  function openCreate() {
    setForm(emptyForm())
    setCreateOpen(true)
  }

  function openEdit(lesson: DemoLesson) {
    setForm({ title: lesson.title, description: lesson.description })
    setEditingLesson(lesson)
  }

  function handleCreateSubmit() {
    if (!form.title.trim()) return
    addLesson(subject.id, classroomId, { title: form.title.trim(), description: form.description.trim() })
    setCreateOpen(false)
  }

  function handleEditSubmit() {
    if (!editingLesson || !form.title.trim()) return
    updateLesson(editingLesson.id, { title: form.title.trim(), description: form.description.trim() })
    setEditingLesson(null)
  }

  function handleArchive() {
    if (!archivingLesson) return
    archiveLesson(archivingLesson.id)
    setArchivingLesson(null)
  }

  function handleMove(index: number, direction: -1 | 1) {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= visibleLessons.length) return
    const ids = visibleLessons.map((l) => l.id)
    const [moved] = ids.splice(index, 1)
    ids.splice(targetIndex, 0, moved)
    reorderLessonsDemo(subject.id, classroomId, ids)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{visibleLessons.length} บทเรียน</p>
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          เพิ่มบทเรียน
        </Button>
      </div>

      {visibleLessons.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <BookOpen className="size-6" />
            </div>
            <p className="text-sm font-medium">ยังไม่มีบทเรียนในห้องเรียนนี้</p>
            <Button onClick={openCreate}>เพิ่มบทเรียน</Button>
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
                    onClick={() => setLessonPublished(lesson.id, !lesson.isPublished)}
                  >
                    {lesson.isPublished ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    {lesson.isPublished ? 'ยกเลิกเผยแพร่' : 'เผยแพร่'}
                  </Button>
                  <RowActionsMenu
                    actions={[
                      { key: 'edit', label: 'แก้ไข', onSelect: () => openEdit(lesson) },
                      { key: 'archive', label: 'เก็บถาวร', onSelect: () => setArchivingLesson(lesson) },
                    ]}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>เพิ่มบทเรียน</DialogTitle>
            <DialogDescription>เพิ่มบทเรียนใหม่ในห้องเรียนนี้ — เผยแพร่ให้นักเรียนเห็นได้ภายหลัง</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="demo-lesson-title">ชื่อบทเรียน *</Label>
              <Input
                id="demo-lesson-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="เช่น บทที่ 1 แรงและการเคลื่อนที่"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="demo-lesson-description">รายละเอียด</Label>
              <Textarea
                id="demo-lesson-description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleCreateSubmit} disabled={!form.title.trim()}>
              เพิ่มบทเรียน
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingLesson)} onOpenChange={(open) => !open && setEditingLesson(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>แก้ไขบทเรียน</DialogTitle>
            <DialogDescription>แก้ไขรายละเอียดบทเรียนนี้</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="demo-lesson-edit-title">ชื่อบทเรียน *</Label>
              <Input
                id="demo-lesson-edit-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="demo-lesson-edit-description">รายละเอียด</Label>
              <Textarea
                id="demo-lesson-edit-description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleEditSubmit} disabled={!form.title.trim()}>
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {archivingLesson && (
        <ConfirmDialog
          open={Boolean(archivingLesson)}
          onOpenChange={(open) => !open && setArchivingLesson(null)}
          title="เก็บถาวรบทเรียน"
          description={`เก็บถาวร "${archivingLesson.title}"? บทเรียนนี้จะไม่แสดงในรายการอีกต่อไป`}
          confirmLabel="เก็บถาวร"
          onConfirm={handleArchive}
        />
      )}
    </div>
  )
}
