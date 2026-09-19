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
import { useDemoClassroom } from '@/demo/demo-context'
import { SUBJECT_ASSIGNMENT_TYPE_LABEL, type DemoSubjectAssignment, type SubjectAssignmentType } from '@/demo/types'

interface AssignmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  subjectId: string
  classroomId: string
  assignment?: DemoSubjectAssignment | null
}

const ASSIGNMENT_TYPES: SubjectAssignmentType[] = ['homework', 'worksheet', 'exercise', 'quiz', 'project']

function emptyForm() {
  return {
    title: '',
    type: 'homework' as SubjectAssignmentType,
    maxScore: '10',
    dueDate: new Date().toISOString().slice(0, 10),
    description: '',
  }
}

/** No topic field here on purpose — the Topics tab was removed from the
 * workspace to simplify the UI (see subject-classroom-workspace-page-demo.tsx).
 * An existing assignment's topicId is preserved as-is on edit; a newly
 * created assignment simply has no topic. */
export function AssignmentDialog({ open, onOpenChange, subjectId, classroomId, assignment }: AssignmentDialogProps) {
  const { addSubjectAssignment, updateSubjectAssignment, subjects, classrooms } = useDemoClassroom()
  const { toast } = useToast()
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const isEditing = Boolean(assignment)

  // "ห้องที่ใช้" — every OTHER classroom this same subject is linked to,
  // from the SAME demo state addSubjectAssignment itself reads (subject.
  // classroomIds + classrooms) — never fabricated/mocked data, and never
  // a second, differently-scoped source of truth. Only relevant for the
  // CREATE flow; editing an existing assignment never touches this.
  const subject = subjects.find((s) => s.id === subjectId)
  const currentClassroomName = classrooms.find((c) => c.id === classroomId)?.name ?? ''
  const otherClassrooms = (subject?.classroomIds ?? [])
    .filter((id) => id !== classroomId)
    .map((id) => classrooms.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))

  const [useOtherClassrooms, setUseOtherClassrooms] = useState(false)
  const [selectedExtraClassroomIds, setSelectedExtraClassroomIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open) {
      setForm(
        assignment
          ? {
              title: assignment.title,
              type: assignment.type,
              maxScore: String(assignment.maxScore),
              dueDate: assignment.dueDate,
              description: assignment.description,
            }
          : emptyForm(),
      )
      setError(null)
      setUseOtherClassrooms(false)
      setSelectedExtraClassroomIds(new Set())
    }
  }, [open, assignment])

  function toggleExtraClassroom(id: string) {
    setSelectedExtraClassroomIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllExtraClassrooms() {
    setSelectedExtraClassroomIds(new Set(otherClassrooms.map((c) => c.id)))
  }

  function handleSubmit(event: FormEvent) {
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

    if (isEditing && assignment) {
      updateSubjectAssignment(assignment.id, {
        title: form.title.trim(),
        type: form.type,
        maxScore,
        dueDate: form.dueDate,
        description: form.description.trim(),
      })
      toast('บันทึกงานแล้ว')
    } else {
      const input = {
        title: form.title.trim(),
        topicId: null,
        type: form.type,
        maxScore,
        dueDate: form.dueDate,
        description: form.description.trim(),
      }
      addSubjectAssignment(subjectId, classroomId, input)

      // Reuses the EXACT SAME addSubjectAssignment — once per additionally
      // selected classroom — never a separate demo "copy" implementation.
      // Each call seeds its own submissions fresh from THAT classroom's
      // own roster (see addSubjectAssignment's own doc comment), so no
      // submission/score/status ever carries over between classrooms.
      const extraTargets = useOtherClassrooms ? otherClassrooms.filter((c) => selectedExtraClassroomIds.has(c.id)) : []
      for (const target of extraTargets) {
        addSubjectAssignment(subjectId, target.id, input)
      }

      toast(extraTargets.length > 0 ? `เพิ่มงานใหม่แล้วใน ${1 + extraTargets.length} ห้อง` : 'เพิ่มงานใหม่แล้ว')
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'แก้ไขงาน' : 'เพิ่มงาน'}</DialogTitle>
          <DialogDescription>{isEditing ? 'แก้ไขรายละเอียดงานนี้' : 'เพิ่มงานหรือแบบทดสอบใหม่'}</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <Label htmlFor="assignment-title">ชื่อเรื่อง *</Label>
            <Input
              id="assignment-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="assignment-type">ประเภท</Label>
              <NativeSelect
                id="assignment-type"
                className="w-full"
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as SubjectAssignmentType }))}
              >
                {ASSIGNMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {SUBJECT_ASSIGNMENT_TYPE_LABEL[type]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assignment-max-score">คะแนนเต็ม *</Label>
              <Input
                id="assignment-max-score"
                type="number"
                min={1}
                value={form.maxScore}
                onChange={(e) => setForm((f) => ({ ...f, maxScore: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="assignment-due">กำหนดส่ง</Label>
            <Input
              id="assignment-due"
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="assignment-description">รายละเอียด</Label>
            <Textarea
              id="assignment-description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          {/* "ห้องที่ใช้" — ALWAYS shown for the create flow (never
              editing), even with zero other classrooms, so a teacher can
              tell "feature exists but no eligible classroom" apart from
              "feature is missing." Current classroom is always locked
              checked — this is always where the assignment is created —
              and every other same-subject classroom only copies in once
              the teacher explicitly opts in via "เพิ่มงานนี้ไปยังห้องอื่นด้วย". */}
          {!isEditing && (
            <div className="space-y-1.5 rounded-lg border border-border p-3">
              <Label>ห้องที่ใช้</Label>
              <label className="flex cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-sm opacity-70">
                <input type="checkbox" checked disabled className="size-4 rounded border-input" />
                ห้องปัจจุบัน {currentClassroomName}
              </label>

              {otherClassrooms.length === 0 ? (
                <p className="px-2 text-xs text-muted-foreground">ไม่มีห้องอื่นในรายวิชานี้</p>
              ) : (
                <>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                    <input
                      type="checkbox"
                      checked={useOtherClassrooms}
                      onChange={(e) => setUseOtherClassrooms(e.target.checked)}
                      className="size-4 rounded border-input"
                    />
                    เพิ่มงานนี้ไปยังห้องอื่นด้วย
                  </label>

                  {useOtherClassrooms && (
                    <div className="ml-2 space-y-1 border-l border-border pl-3">
                      <div className="flex justify-end">
                        <Button type="button" variant="ghost" size="sm" onClick={selectAllExtraClassrooms}>
                          เลือกทั้งหมด
                        </Button>
                      </div>
                      {otherClassrooms.map((c) => (
                        <label
                          key={c.id}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                        >
                          <input
                            type="checkbox"
                            checked={selectedExtraClassroomIds.has(c.id)}
                            onChange={() => toggleExtraClassroom(c.id)}
                            className="size-4 rounded border-input"
                          />
                          {c.name}
                        </label>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="submit">{isEditing ? 'บันทึก' : 'เพิ่มงาน'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
