import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ATTENDANCE_STATUS_LABEL, ATTENDANCE_STATUS_ORDER } from '@/demo/attendance'
import { useDemoClassroom } from '@/demo/demo-context'
import { SUBMISSION_STATUS_LABEL } from '@/demo/types'
import type { DemoAttendanceStatus, DemoStudent, DemoSubject } from '@/demo/types'

interface SubjectStudentDrawerProps {
  subject: DemoSubject
  student: DemoStudent | null
  onOpenChange: (open: boolean) => void
}

export function SubjectStudentDrawer({ subject, student, onOpenChange }: SubjectStudentDrawerProps) {
  const { subjectAssignments, subjectAttendance } = useDemoClassroom()

  if (!student) return null

  const assignments = subjectAssignments.filter((a) => a.subjectId === subject.id)
  const missingCount = assignments.filter((a) => {
    const status = a.submissions[student.id]?.status
    return status === 'not_submitted' || status === 'late' || status === 'missing'
  }).length

  const gradedAssignments = assignments.filter((a) => a.submissions[student.id]?.score !== null)
  const averagePercent =
    gradedAssignments.length > 0
      ? gradedAssignments.reduce((sum, a) => sum + ((a.submissions[student.id]?.score ?? 0) / a.maxScore) * 100, 0) /
        gradedAssignments.length
      : null

  const attendanceCounts: Record<DemoAttendanceStatus, number> = { present: 0, late: 0, leave: 0, absent: 0 }
  const bySubject = subjectAttendance[subject.id] ?? {}
  let recordedDays = 0
  for (const byDate of Object.values(bySubject)) {
    const status = byDate[student.id]
    if (status) {
      attendanceCounts[status] += 1
      recordedDays += 1
    }
  }

  return (
    <Sheet open={Boolean(student)} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>ข้อมูลนักเรียนในรายวิชา</SheetTitle>
          <SheetDescription>{subject.name}</SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-3">
          <Avatar className="size-12 text-base">{student.firstName.slice(0, 1)}</Avatar>
          <div>
            <p className="text-base font-semibold">
              {student.firstName} {student.lastName}
            </p>
            <p className="text-sm text-muted-foreground">
              {student.nickname} · เลขที่ {student.number} · {student.classroom}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">คะแนนเฉลี่ย</p>
            <p className="mt-1 text-sm font-semibold">{averagePercent !== null ? `${averagePercent.toFixed(1)}%` : '-'}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">งานค้าง</p>
            <p className="mt-1 text-sm font-semibold">
              {missingCount > 0 ? <Badge variant="warning">{missingCount} งาน</Badge> : <Badge variant="success">ครบ</Badge>}
            </p>
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">สรุปการเข้าเรียน{recordedDays > 0 ? ` (${recordedDays} วัน)` : ''}</p>
          {recordedDays === 0 ? (
            <p className="text-sm text-muted-foreground">ยังไม่มีข้อมูลการเช็คชื่อในรายวิชานี้</p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {ATTENDANCE_STATUS_ORDER.map((status) => (
                <span key={status} className="text-muted-foreground">
                  {ATTENDANCE_STATUS_LABEL[status]}: <span className="font-medium text-foreground">{attendanceCounts[status]}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">งานล่าสุด</p>
          {assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">ยังไม่มีงานในรายวิชานี้</p>
          ) : (
            <ul className="space-y-2">
              {assignments.slice(0, 6).map((assignment) => {
                const submission = assignment.submissions[student.id]
                return (
                  <li key={assignment.id} className="flex items-center justify-between text-sm">
                    <span className="truncate">{assignment.title}</span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      {submission?.score !== null && submission?.score !== undefined
                        ? `${submission.score}/${assignment.maxScore}`
                        : '-'}
                      <Badge variant={submission?.status === 'submitted' ? 'success' : 'warning'}>
                        {submission ? SUBMISSION_STATUS_LABEL[submission.status] : '-'}
                      </Badge>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
