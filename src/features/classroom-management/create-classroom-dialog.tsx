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
import { createClassroom } from '@/services/classroom-service'
import { toFriendlyErrorMessage } from '@/lib/errors'
import type { Classroom } from '@/types/classroom'

interface CreateClassroomDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (classroom: Classroom) => void
}

export function CreateClassroomDialog({ open, onOpenChange, onCreated }: CreateClassroomDialogProps) {
  const [name, setName] = useState('')
  const [gradeLevel, setGradeLevel] = useState('')
  const [section, setSection] = useState('')
  const [academicYear, setAcademicYear] = useState('')
  const [semester, setSemester] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function reset() {
    setName('')
    setGradeLevel('')
    setSection('')
    setAcademicYear('')
    setSemester('')
    setError(null)
    setSubmitting(false)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      setError('กรุณากรอกชื่อห้องเรียน')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const classroom = await createClassroom({
        name: name.trim(),
        gradeLevel: gradeLevel.trim() || null,
        section: section.trim() || null,
        academicYear: academicYear.trim() || null,
        semester: semester.trim() || null,
      })
      onCreated(classroom)
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(toFriendlyErrorMessage(err, 'ไม่สามารถสร้างห้องเรียนได้'))
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
          <DialogTitle>สร้างห้องเรียน</DialogTitle>
          <DialogDescription>เพิ่มห้องเรียนใหม่สำหรับปีการศึกษา/ภาคเรียนนี้</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <Label htmlFor="classroom-name">ชื่อห้อง</Label>
            <Input
              id="classroom-name"
              placeholder="เช่น ม.5/1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="classroom-grade">ระดับชั้น</Label>
              <Input
                id="classroom-grade"
                placeholder="เช่น ม.5"
                value={gradeLevel}
                onChange={(e) => setGradeLevel(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="classroom-section">ห้อง</Label>
              <Input
                id="classroom-section"
                placeholder="เช่น 1"
                value={section}
                onChange={(e) => setSection(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="classroom-year">ปีการศึกษา</Label>
              <Input
                id="classroom-year"
                placeholder="เช่น 2569"
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="classroom-semester">ภาคเรียน</Label>
              <Input
                id="classroom-semester"
                placeholder="เช่น 1"
                value={semester}
                onChange={(e) => setSemester(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'กำลังบันทึก...' : 'สร้างห้องเรียน'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
