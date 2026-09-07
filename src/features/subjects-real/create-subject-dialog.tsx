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
import { getClassrooms } from '@/services/classroom-service'
import { createSubject } from '@/services/subject-service'
import type { Classroom } from '@/types/classroom'

interface CreateSubjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (subjectId: string) => void
}

const EMPTY_FORM = {
  name: '',
  code: '',
  academicYear: '',
  semester: '',
  description: '',
}

export function CreateSubjectDialog({ open, onOpenChange, onCreated }: CreateSubjectDialogProps) {
  const { toast } = useToast()
  const [form, setForm] = useState(EMPTY_FORM)
  const [selectedClassroomIds, setSelectedClassroomIds] = useState<string[]>([])
  const [classrooms, setClassrooms] = useState<Classroom[]>([])
  const [classroomsLoading, setClassroomsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    let active = true
    setClassroomsLoading(true)
    getClassrooms()
      .then((rows) => {
        if (active) setClassrooms(rows)
      })
      .catch((err: unknown) => {
        if (active) setError(toFriendlyErrorMessage(err))
      })
      .finally(() => {
        if (active) setClassroomsLoading(false)
      })
    return () => {
      active = false
    }
  }, [open])

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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!form.name.trim()) {
      setError('กรุณากรอกชื่อรายวิชา')
      return
    }
    if (selectedClassroomIds.length === 0) {
      setError('กรุณาเลือกอย่างน้อย 1 ห้องเรียน')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const subject = await createSubject({
        name: form.name.trim(),
        subjectCode: form.code.trim() || null,
        academicYear: form.academicYear.trim() || null,
        semester: form.semester.trim() || null,
        description: form.description.trim() || null,
        classroomIds: selectedClassroomIds,
      })
      toast(`สร้างรายวิชา "${subject.name}" แล้ว`)
      reset()
      onOpenChange(false)
      onCreated?.(subject.id)
    } catch (err) {
      setError(toFriendlyErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
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
              <Label htmlFor="subject-name-real">ชื่อรายวิชา *</Label>
              <Input
                id="subject-name-real"
                placeholder="เช่น วิทยาศาสตร์"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="subject-code-real">รหัสวิชา</Label>
              <Input
                id="subject-code-real"
                placeholder="เช่น ว32101"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="subject-year-real">ปีการศึกษา</Label>
              <Input
                id="subject-year-real"
                value={form.academicYear}
                onChange={(e) => setForm((f) => ({ ...f, academicYear: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="subject-semester-real">ภาคเรียน</Label>
              <Input
                id="subject-semester-real"
                value={form.semester}
                onChange={(e) => setForm((f) => ({ ...f, semester: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="subject-description-real">รายละเอียด</Label>
            <Textarea
              id="subject-description-real"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label>ห้องเรียน *</Label>
            <div className="space-y-2 rounded-md border border-border p-3">
              {classroomsLoading ? (
                <p className="text-sm text-muted-foreground">กำลังโหลดห้องเรียน...</p>
              ) : classrooms.length === 0 ? (
                <p className="text-sm text-muted-foreground">ยังไม่มีห้องเรียน กรุณาสร้างห้องเรียนก่อนสร้างรายวิชา</p>
              ) : (
                classrooms.map((classroom) => (
                  <label key={classroom.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedClassroomIds.includes(classroom.id)}
                      onChange={() => toggleClassroom(classroom.id)}
                      className="size-4 rounded border-input"
                    />
                    {classroom.name}
                  </label>
                ))
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={submitting || classrooms.length === 0}>
              {submitting ? 'กำลังสร้าง...' : 'สร้างรายวิชา'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
