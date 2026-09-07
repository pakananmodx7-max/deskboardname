import { useState, type FormEvent } from 'react'

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
import { useDemoClassroom } from '@/demo/demo-context'

interface CreateSubjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (subjectId: string) => void
}

const EMPTY_FORM = {
  name: '',
  code: '',
  academicYear: '2569',
  semester: '1',
  description: '',
}

export function CreateSubjectDialog({ open, onOpenChange, onCreated }: CreateSubjectDialogProps) {
  const { classrooms, addSubject } = useDemoClassroom()
  const { toast } = useToast()
  const [form, setForm] = useState(EMPTY_FORM)
  const [selectedClassroomIds, setSelectedClassroomIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setForm(EMPTY_FORM)
    setSelectedClassroomIds([])
    setError(null)
  }

  function toggleClassroom(classroomId: string) {
    setSelectedClassroomIds((prev) =>
      prev.includes(classroomId) ? prev.filter((id) => id !== classroomId) : [...prev, classroomId],
    )
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!form.name.trim() || !form.code.trim()) {
      setError('กรุณากรอกชื่อรายวิชาและรหัสวิชา')
      return
    }
    if (selectedClassroomIds.length === 0) {
      setError('กรุณาเลือกอย่างน้อย 1 ห้องเรียน')
      return
    }

    const subject = addSubject({
      name: form.name.trim(),
      code: form.code.trim(),
      academicYear: form.academicYear.trim(),
      semester: form.semester.trim(),
      description: form.description.trim(),
      classroomIds: selectedClassroomIds,
    })

    toast(`สร้างรายวิชา "${subject.name}" แล้ว`)
    reset()
    onOpenChange(false)
    onCreated?.(subject.id)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>สร้างรายวิชา</DialogTitle>
          <DialogDescription>เพิ่มรายวิชาใหม่และเชื่อมโยงกับห้องเรียน</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="subject-name">ชื่อรายวิชา *</Label>
              <Input
                id="subject-name"
                placeholder="เช่น วิทยาศาสตร์"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="subject-code">รหัสวิชา *</Label>
              <Input
                id="subject-code"
                placeholder="เช่น ว32101"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="subject-year">ปีการศึกษา</Label>
              <Input
                id="subject-year"
                value={form.academicYear}
                onChange={(e) => setForm((f) => ({ ...f, academicYear: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="subject-semester">ภาคเรียน</Label>
              <Input
                id="subject-semester"
                value={form.semester}
                onChange={(e) => setForm((f) => ({ ...f, semester: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="subject-description">รายละเอียด</Label>
            <Textarea
              id="subject-description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label>ห้องเรียน *</Label>
            <div className="space-y-2 rounded-md border border-border p-3">
              {classrooms.map((classroom) => (
                <label key={classroom.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedClassroomIds.includes(classroom.id)}
                    onChange={() => toggleClassroom(classroom.id)}
                    className="size-4 rounded border-input"
                  />
                  {classroom.name} — {classroom.studentIds.length} คน
                </label>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="submit">สร้างรายวิชา</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
