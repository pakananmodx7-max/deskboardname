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
import { useToast } from '@/components/ui/toast'
import { useDemoClassroom } from '@/demo/demo-context'
import type { DemoStudent } from '@/demo/types'

interface AddEditStudentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, the dialog edits this student instead of creating a new one. */
  student?: DemoStudent | null
}

const EMPTY_FORM = { studentCode: '', number: '', firstName: '', lastName: '', nickname: '' }

export function AddEditStudentDialog({ open, onOpenChange, student }: AddEditStudentDialogProps) {
  const { addStudent, updateStudent } = useDemoClassroom()
  const { toast } = useToast()
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const isEditing = Boolean(student)

  useEffect(() => {
    if (open) {
      setForm(
        student
          ? {
              studentCode: student.studentCode,
              number: String(student.number),
              firstName: student.firstName,
              lastName: student.lastName,
              nickname: student.nickname,
            }
          : EMPTY_FORM,
      )
      setError(null)
    }
  }, [open, student])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError('กรุณากรอกชื่อและนามสกุล')
      return
    }

    if (isEditing && student) {
      updateStudent(student.id, {
        studentCode: form.studentCode.trim(),
        number: form.number ? Number(form.number) : student.number,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        nickname: form.nickname.trim(),
      })
      toast('บันทึกข้อมูลนักเรียนแล้ว')
    } else {
      addStudent({
        studentCode: form.studentCode.trim() || undefined,
        number: form.number ? Number(form.number) : undefined,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        nickname: form.nickname.trim(),
      })
      toast('เพิ่มนักเรียนใหม่แล้ว')
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'แก้ไขข้อมูลนักเรียน' : 'เพิ่มนักเรียน'}</DialogTitle>
          <DialogDescription>
            {isEditing ? 'แก้ไขข้อมูลในเดโม — การเปลี่ยนแปลงจะไม่ถูกบันทึกถาวร' : 'เพิ่มนักเรียนใหม่ในเดโม'}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="demo-student-code">รหัสนักเรียน</Label>
              <Input
                id="demo-student-code"
                value={form.studentCode}
                onChange={(e) => setForm((f) => ({ ...f, studentCode: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="demo-student-number">เลขที่</Label>
              <Input
                id="demo-student-number"
                type="number"
                inputMode="numeric"
                value={form.number}
                onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="demo-student-first-name">ชื่อ *</Label>
              <Input
                id="demo-student-first-name"
                value={form.firstName}
                onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="demo-student-last-name">นามสกุล *</Label>
              <Input
                id="demo-student-last-name"
                value={form.lastName}
                onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="demo-student-nickname">ชื่อเล่น</Label>
            <Input
              id="demo-student-nickname"
              value={form.nickname}
              onChange={(e) => setForm((f) => ({ ...f, nickname: e.target.value }))}
            />
          </div>

          <DialogFooter>
            <Button type="submit">{isEditing ? 'บันทึกการแก้ไข' : 'เพิ่มนักเรียน'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
