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
import { useDemoClassroom } from '@/demo/demo-context'
import type { DemoStudent } from '@/demo/types'

interface EditStudentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  student: DemoStudent
  onUpdated: () => void
}

export function EditStudentDialog({ open, onOpenChange, student, onUpdated }: EditStudentDialogProps) {
  const { updateStudentInfoDemo } = useDemoClassroom()
  const [number, setNumber] = useState('')
  const [studentCode, setStudentCode] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [nickname, setNickname] = useState('')
  const [status, setStatus] = useState<DemoStudent['status']>('active')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setNumber(String(student.number))
      setStudentCode(student.studentCode)
      setFirstName(student.firstName)
      setLastName(student.lastName)
      setNickname(student.nickname)
      setStatus(student.status)
      setError(null)
    }
  }, [open, student])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!firstName.trim() || !lastName.trim()) {
      setError('กรุณากรอกชื่อและนามสกุล')
      return
    }

    updateStudentInfoDemo(student.id, {
      number: number.trim() ? Number(number.trim()) : student.number,
      studentCode: studentCode.trim(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      nickname: nickname.trim(),
      status,
    })
    onUpdated()
    onOpenChange(false)
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
              <Label htmlFor="demo-edit-student-number">เลขที่</Label>
              <Input
                id="demo-edit-student-number"
                type="number"
                inputMode="numeric"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="demo-edit-student-code">รหัสนักเรียน</Label>
              <Input id="demo-edit-student-code" value={studentCode} onChange={(e) => setStudentCode(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="demo-edit-student-first-name">ชื่อ *</Label>
              <Input
                id="demo-edit-student-first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="demo-edit-student-last-name">นามสกุล *</Label>
              <Input
                id="demo-edit-student-last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="demo-edit-student-nickname">ชื่อเล่น</Label>
              <Input id="demo-edit-student-nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="demo-edit-student-status">สถานะ</Label>
              <NativeSelect
                id="demo-edit-student-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as DemoStudent['status'])}
              >
                <option value="active">กำลังเรียน</option>
                <option value="inactive">ไม่ได้ใช้งาน</option>
              </NativeSelect>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit">บันทึก</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
