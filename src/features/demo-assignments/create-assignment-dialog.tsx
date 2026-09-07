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
import { useToast } from '@/components/ui/toast'
import { useDemoClassroom } from '@/demo/demo-context'

interface CreateAssignmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateAssignmentDialog({ open, onOpenChange }: CreateAssignmentDialogProps) {
  const { addAssignment } = useDemoClassroom()
  const { toast } = useToast()
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim() || !dueDate.trim()) {
      setError('กรุณากรอกชื่องานและวันครบกำหนด')
      return
    }
    addAssignment(title.trim(), dueDate.trim())
    toast('สร้างงานใหม่แล้ว')
    setTitle('')
    setDueDate('')
    setError(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>สร้างงานใหม่</DialogTitle>
          <DialogDescription>เพิ่มงานหรือแบบทดสอบใหม่ให้ห้องเรียนนี้</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <Label htmlFor="assignment-title">ชื่องาน *</Label>
            <Input
              id="assignment-title"
              placeholder="เช่น Homework 8"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="assignment-due">กำหนดส่ง *</Label>
            <Input
              id="assignment-due"
              placeholder="เช่น 20 Sep"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              required
            />
          </div>

          <DialogFooter>
            <Button type="submit">สร้างงาน</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
