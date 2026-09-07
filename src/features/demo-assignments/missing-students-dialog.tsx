import { Check } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { useDemoClassroom } from '@/demo/demo-context'
import type { DemoAssignment } from '@/demo/types'

interface MissingStudentsDialogProps {
  assignment: DemoAssignment | null
  onOpenChange: (open: boolean) => void
}

export function MissingStudentsDialog({ assignment, onOpenChange }: MissingStudentsDialogProps) {
  const { students, setSubmission } = useDemoClassroom()
  const { toast } = useToast()

  if (!assignment) return null

  const missingStudents = students.filter((s) => !assignment.submissions[s.id])

  function handleMarkSubmitted(studentId: string, name: string) {
    if (!assignment) return
    setSubmission(assignment.id, studentId, true)
    toast(`ทำเครื่องหมายว่า ${name} ส่งงานแล้ว`)
  }

  return (
    <Dialog open={Boolean(assignment)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>นักเรียนที่ยังไม่ส่ง — {assignment.title}</DialogTitle>
          <DialogDescription>
            {missingStudents.length > 0
              ? `ยังไม่ส่งทั้งหมด ${missingStudents.length} คน`
              : 'ทุกคนส่งงานนี้ครบแล้ว 🎉'}
          </DialogDescription>
        </DialogHeader>

        {missingStudents.length > 0 && (
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {missingStudents.map((student) => (
              <div
                key={student.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium">
                    {student.firstName} {student.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground">เลขที่ {student.number}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleMarkSubmitted(student.id, `${student.firstName} ${student.lastName}`)}
                >
                  <Check className="size-3.5" />
                  ทำเครื่องหมายว่าส่งแล้ว
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
