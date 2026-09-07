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
import { NativeSelect } from '@/components/ui/select'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { createStudent } from '@/services/student-service'
import type { Classroom } from '@/types/classroom'

interface AddStudentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  classrooms: Classroom[]
  defaultClassroomId: string
  onCreated: () => void
}

export function AddStudentDialog({
  open,
  onOpenChange,
  classrooms,
  defaultClassroomId,
  onCreated,
}: AddStudentDialogProps) {
  const [classroomId, setClassroomId] = useState(defaultClassroomId)
  const [studentCode, setStudentCode] = useState('')
  const [number, setNumber] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [nickname, setNickname] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function reset() {
    setClassroomId(defaultClassroomId)
    setStudentCode('')
    setNumber('')
    setFirstName('')
    setLastName('')
    setNickname('')
    setEmail('')
    setPhone('')
    setError(null)
    setSubmitting(false)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    if (!firstName.trim() || !lastName.trim()) {
      setError('กรุณากรอกชื่อและนามสกุล')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await createStudent({
        classroomId,
        studentCode: studentCode.trim() || null,
        number: number.trim() ? Number(number.trim()) : null,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        nickname: nickname.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
      })
      onCreated()
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(toFriendlyErrorMessage(err, 'ไม่สามารถเพิ่มนักเรียนได้'))
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
          <DialogTitle>เพิ่มนักเรียน</DialogTitle>
          <DialogDescription>เพิ่มนักเรียนใหม่เข้าห้องเรียนนี้</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <Label htmlFor="student-classroom">ห้องเรียน *</Label>
            <NativeSelect
              id="student-classroom"
              className="w-full"
              value={classroomId}
              onChange={(e) => setClassroomId(e.target.value)}
              required
            >
              {classrooms.map((classroom) => (
                <option key={classroom.id} value={classroom.id}>
                  {classroom.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="student-code">รหัสนักเรียน</Label>
              <Input id="student-code" value={studentCode} onChange={(e) => setStudentCode(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="student-number">เลขที่</Label>
              <Input
                id="student-number"
                type="number"
                inputMode="numeric"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="student-first-name">ชื่อ *</Label>
              <Input
                id="student-first-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="student-last-name">นามสกุล *</Label>
              <Input
                id="student-last-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="student-nickname">ชื่อเล่น</Label>
            <Input id="student-nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="student-email">อีเมล</Label>
              <Input id="student-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="student-phone">เบอร์โทร</Label>
              <Input id="student-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'กำลังบันทึก...' : 'เพิ่มนักเรียน'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
