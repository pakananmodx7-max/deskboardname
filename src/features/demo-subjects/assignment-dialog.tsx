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
  const { addSubjectAssignment, updateSubjectAssignment } = useDemoClassroom()
  const { toast } = useToast()
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const isEditing = Boolean(assignment)

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
    }
  }, [open, assignment])

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
      addSubjectAssignment(subjectId, classroomId, {
        title: form.title.trim(),
        topicId: null,
        type: form.type,
        maxScore,
        dueDate: form.dueDate,
        description: form.description.trim(),
      })
      toast('เพิ่มงานใหม่แล้ว')
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

          <DialogFooter>
            <Button type="submit">{isEditing ? 'บันทึก' : 'เพิ่มงาน'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
