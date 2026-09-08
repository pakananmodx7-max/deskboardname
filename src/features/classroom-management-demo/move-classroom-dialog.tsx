import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/select'
import { useDemoClassroom } from '@/demo/demo-context'
import { buildMoveClassroomMessage } from '@/features/classroom-management/student-confirm-messages'
import type { DemoClassroomInfo, DemoStudent } from '@/demo/types'

interface MoveClassroomDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  student: DemoStudent
  currentClassroom: DemoClassroomInfo
  onMoved: () => void
}

export function MoveClassroomDialog({
  open,
  onOpenChange,
  student,
  currentClassroom,
  onMoved,
}: MoveClassroomDialogProps) {
  const { classrooms, moveStudentToClassroomDemo } = useDemoClassroom()
  const targetClassrooms = classrooms.filter((c) => c.id !== currentClassroom.id)
  const [targetClassroomId, setTargetClassroomId] = useState(targetClassrooms[0]?.id ?? '')

  useEffect(() => {
    if (open) {
      setTargetClassroomId(targetClassrooms[0]?.id ?? '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const targetClassroom = targetClassrooms.find((c) => c.id === targetClassroomId)
  const studentName = `${student.firstName} ${student.lastName}`

  function handleConfirm() {
    if (!targetClassroom) return
    moveStudentToClassroomDemo(student.id, currentClassroom.id, targetClassroom.id)
    onOpenChange(false)
    onMoved()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ย้ายห้องเรียน</DialogTitle>
          <DialogDescription>ย้าย {studentName} ไปยังห้องเรียนอื่น</DialogDescription>
        </DialogHeader>

        {targetClassrooms.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            คุณมีห้องเรียนเดียว ({currentClassroom.name}) ยังไม่มีห้องเรียนอื่นให้ย้ายไป
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="demo-move-target-classroom">ย้ายไปที่ห้องเรียน</Label>
              <NativeSelect
                id="demo-move-target-classroom"
                className="w-full"
                value={targetClassroomId}
                onChange={(e) => setTargetClassroomId(e.target.value)}
              >
                {targetClassrooms.map((classroom) => (
                  <option key={classroom.id} value={classroom.id}>
                    {classroom.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {targetClassroom && (
              <p className="whitespace-pre-line text-sm text-muted-foreground">
                {buildMoveClassroomMessage(studentName, currentClassroom.name, targetClassroom.name)}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" onClick={handleConfirm} disabled={!targetClassroom}>
            ย้ายห้องเรียน
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
