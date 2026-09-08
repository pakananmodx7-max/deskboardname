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
import { buildMoveClassroomMessage } from '@/features/classroom-management/student-confirm-messages'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { moveStudentToClassroom } from '@/services/student-service'
import type { Classroom } from '@/types/classroom'
import type { Student } from '@/types/student'

interface MoveClassroomDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  student: Student
  currentClassroom: Classroom
  /** All of the teacher's classrooms, including the current one — this
   * dialog filters out the current classroom itself for the target list. */
  classrooms: Classroom[]
  onMoved: () => void
}

export function MoveClassroomDialog({
  open,
  onOpenChange,
  student,
  currentClassroom,
  classrooms,
  onMoved,
}: MoveClassroomDialogProps) {
  const targetClassrooms = classrooms.filter((c) => c.id !== currentClassroom.id)
  const [targetClassroomId, setTargetClassroomId] = useState(targetClassrooms[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Only re-seed the selected target when the dialog opens, not on every
  // render — targetClassrooms is recomputed fresh from props each time.
  useEffect(() => {
    if (open) {
      setTargetClassroomId(targetClassrooms[0]?.id ?? '')
      setError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const targetClassroom = targetClassrooms.find((c) => c.id === targetClassroomId)
  const studentName = `${student.firstName} ${student.lastName}`

  async function handleConfirm() {
    if (!targetClassroom) return
    setSubmitting(true)
    setError(null)
    try {
      await moveStudentToClassroom(student.id, currentClassroom.id, targetClassroom.id)
      onOpenChange(false)
      onMoved()
    } catch (err) {
      setError(toFriendlyErrorMessage(err, 'ไม่สามารถย้ายห้องเรียนได้'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ย้ายห้องเรียน</DialogTitle>
          <DialogDescription>ย้าย {studentName} ไปยังห้องเรียนอื่น</DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {targetClassrooms.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            คุณมีห้องเรียนเดียว ({currentClassroom.name}) ยังไม่มีห้องเรียนอื่นให้ย้ายไป
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="move-target-classroom">ย้ายไปที่ห้องเรียน</Label>
              <NativeSelect
                id="move-target-classroom"
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
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={submitting || !targetClassroom}
          >
            {submitting ? 'กำลังย้าย...' : 'ย้ายห้องเรียน'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
