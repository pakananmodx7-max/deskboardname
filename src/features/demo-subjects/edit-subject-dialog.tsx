import { useEffect, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/toast'
import { useDemoClassroom } from '@/demo/demo-context'
import type { DemoSubject } from '@/demo/types'

interface EditSubjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  subject: DemoSubject
}

interface PendingRemoval {
  nextClassroomIds: string[]
  flaggedNames: string[]
}

/**
 * Demo mirror of subjects-real's EditSubjectDialog, scoped to the same
 * classroom link/unlink behavior that dialog adds ("link another
 * classroom, unlink a classroom, see student count per classroom").
 * Unlinking a classroom that already has subject attendance recorded
 * (hasSubjectClassroomAttendanceDemo) is confirmed first, mirroring the
 * real dialog's hasSubjectClassroomAttendance safeguard — in demo mode
 * this doesn't delete anything either (subjectAttendance keeps every
 * date's records regardless of the subject's current classroomIds), it
 * only stops that classroom from appearing as a choice going forward.
 */
export function EditSubjectDialog({ open, onOpenChange, subject }: EditSubjectDialogProps) {
  const { classrooms, hasSubjectClassroomAttendanceDemo, updateSubjectClassroomIdsDemo } = useDemoClassroom()
  const { toast } = useToast()

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null)

  useEffect(() => {
    if (open) {
      setSelectedIds(subject.classroomIds)
      setError(null)
      setPendingRemoval(null)
    }
  }, [open, subject])

  function toggleClassroom(classroomId: string) {
    setSelectedIds((prev) =>
      prev.includes(classroomId) ? prev.filter((id) => id !== classroomId) : [...prev, classroomId],
    )
  }

  function applyAndClose(nextClassroomIds: string[]) {
    updateSubjectClassroomIdsDemo(subject.id, nextClassroomIds)
    toast('บันทึกการแก้ไขรายวิชาแล้ว')
    onOpenChange(false)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (selectedIds.length === 0) {
      setError('กรุณาเลือกอย่างน้อย 1 ห้องเรียน')
      return
    }
    setError(null)

    const toRemove = subject.classroomIds.filter((id) => !selectedIds.includes(id))
    const flaggedIds = toRemove.filter((id) => hasSubjectClassroomAttendanceDemo(subject.id, id))
    if (flaggedIds.length > 0) {
      const flaggedNames = flaggedIds.map((id) => classrooms.find((c) => c.id === id)?.name ?? id)
      setPendingRemoval({ nextClassroomIds: selectedIds, flaggedNames })
      return
    }

    applyAndClose(selectedIds)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>แก้ไขรายวิชา</DialogTitle>
            <DialogDescription>แก้ไขห้องเรียนที่เชื่อมโยงกับ {subject.name}</DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={handleSubmit}>
            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="space-y-1.5">
              <Label>ห้องเรียน *</Label>
              <div className="space-y-2 rounded-md border border-border p-3">
                {classrooms.map((classroom) => (
                  <label key={classroom.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(classroom.id)}
                      onChange={() => toggleClassroom(classroom.id)}
                      className="size-4 rounded border-input"
                    />
                    {classroom.name} — {classroom.studentIds.length} คน
                  </label>
                ))}
              </div>
            </div>

            <DialogFooter>
              <Button type="submit">บันทึก</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {pendingRemoval && (
        <ConfirmDialog
          open={Boolean(pendingRemoval)}
          onOpenChange={(nextOpen) => !nextOpen && setPendingRemoval(null)}
          title="ยกเลิกการเชื่อมโยงห้องเรียน"
          description={`ห้องเรียนต่อไปนี้มีข้อมูลการเช็คชื่อของรายวิชานี้อยู่แล้ว: ${pendingRemoval.flaggedNames.join(
            ', ',
          )}\nข้อมูลจะยังคงอยู่ในระบบ แต่จะไม่สามารถเช็คชื่อห้องนี้ในรายวิชานี้ได้อีก ต้องการดำเนินการต่อหรือไม่?`}
          confirmLabel="ยกเลิกการเชื่อมโยง"
          onConfirm={() => applyAndClose(pendingRemoval.nextClassroomIds)}
        />
      )}
    </>
  )
}
