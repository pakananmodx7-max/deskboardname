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
import { toFriendlyErrorMessage } from '@/lib/errors'
import { updateClassroom } from '@/services/classroom-service'
import type { Classroom } from '@/types/classroom'

interface EditClassroomDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  classroom: Classroom
  onUpdated: (classroom: Classroom) => void
}

export function EditClassroomDialog({ open, onOpenChange, classroom, onUpdated }: EditClassroomDialogProps) {
  const [name, setName] = useState(classroom.name)
  const [gradeLevel, setGradeLevel] = useState(classroom.gradeLevel ?? '')
  const [section, setSection] = useState(classroom.section ?? '')
  const [academicYear, setAcademicYear] = useState(classroom.academicYear ?? '')
  const [semester, setSemester] = useState(classroom.semester ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setName(classroom.name)
      setGradeLevel(classroom.gradeLevel ?? '')
      setSection(classroom.section ?? '')
      setAcademicYear(classroom.academicYear ?? '')
      setSemester(classroom.semester ?? '')
      setError(null)
    }
  }, [open, classroom])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      setError('กรุณากรอกชื่อห้องเรียน')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const updated = await updateClassroom(classroom.id, {
        name: name.trim(),
        gradeLevel: gradeLevel.trim() || null,
        section: section.trim() || null,
        academicYear: academicYear.trim() || null,
        semester: semester.trim() || null,
      })
      onUpdated(updated)
      onOpenChange(false)
    } catch (err) {
      setError(toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกการแก้ไขได้'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>แก้ไขห้องเรียน</DialogTitle>
          <DialogDescription>แก้ไขข้อมูลห้องเรียนนี้</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <Label htmlFor="edit-classroom-name">ชื่อห้อง</Label>
            <Input id="edit-classroom-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-classroom-grade">ระดับชั้น</Label>
              <Input id="edit-classroom-grade" value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-classroom-section">ห้อง</Label>
              <Input id="edit-classroom-section" value={section} onChange={(e) => setSection(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-classroom-year">ปีการศึกษา</Label>
              <Input id="edit-classroom-year" value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-classroom-semester">ภาคเรียน</Label>
              <Input id="edit-classroom-semester" value={semester} onChange={(e) => setSemester(e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
