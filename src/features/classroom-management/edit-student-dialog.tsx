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
import { toFriendlyErrorMessage } from '@/lib/errors'
import { updateStudent } from '@/services/student-service'
import type { Student, StudentStatus } from '@/types/student'

interface EditStudentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  student: Student
  onUpdated: (student: Student) => void
}

export function EditStudentDialog({ open, onOpenChange, student, onUpdated }: EditStudentDialogProps) {
  const [number, setNumber] = useState('')
  const [studentCode, setStudentCode] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [nickname, setNickname] = useState('')
  const [status, setStatus] = useState<StudentStatus>('active')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setNumber(student.number !== null ? String(student.number) : '')
      setStudentCode(student.studentCode ?? '')
      setFirstName(student.firstName)
      setLastName(student.lastName)
      setNickname(student.nickname ?? '')
      setStatus(student.status)
      setError(null)
    }
  }, [open, student])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!firstName.trim() || !lastName.trim()) {
      setError('กรุณากรอกชื่อและนามสกุล')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      // student.id is passed straight through to updateStudent(id, ...) —
      // the row's id never changes, so this always updates the existing
      // record in place rather than creating a new one.
      const updated = await updateStudent(student.id, {
        number: number.trim() ? Number(number.trim()) : null,
        studentCode: studentCode.trim() || null,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        nickname: nickname.trim() || null,
        status,
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
          <DialogTitle>แก้ไขข้อมูลนักเรียน</DialogTitle>
          <DialogDescription>แก้ไขข้อมูลของ {student.firstName} {student.lastName}</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-student-number">เลขที่</Label>
              <Input
                id="edit-student-number"
                type="number"
                inputMode="numeric"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-student-code">รหัสนักเรียน</Label>
              <Input id="edit-student-code" value={studentCode} onChange={(e) => setStudentCode(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-student-first-name">ชื่อ *</Label>
              <Input
                id="edit-student-first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-student-last-name">นามสกุล *</Label>
              <Input
                id="edit-student-last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-student-nickname">ชื่อเล่น</Label>
              <Input id="edit-student-nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-student-status">สถานะ</Label>
              <NativeSelect
                id="edit-student-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as StudentStatus)}
              >
                <option value="active">กำลังเรียน</option>
                <option value="inactive">ไม่ได้ใช้งาน</option>
              </NativeSelect>
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
