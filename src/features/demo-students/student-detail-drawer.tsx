import { FileText } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ATTENDANCE_STATUS_LABEL } from '@/demo/attendance'
import { useDemoClassroom } from '@/demo/demo-context'
import { computeTotal } from '@/demo/grades'
import type { DemoStudent } from '@/demo/types'

interface StudentDetailDrawerProps {
  student: DemoStudent | null
  onOpenChange: (open: boolean) => void
}

export function StudentDetailDrawer({ student, onOpenChange }: StudentDetailDrawerProps) {
  const { attendance, grades, missingByStudent, activity } = useDemoClassroom()
  const navigate = useNavigate()

  if (!student) return null

  const status = attendance[student.id]
  const scores = grades[student.id]
  const total = scores ? computeTotal(scores) : 0
  const missing = missingByStudent[student.id] ?? 0
  const relatedActivity = activity.filter((item) => item.message.includes(student.firstName)).slice(0, 4)

  return (
    <Sheet open={Boolean(student)} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>ข้อมูลนักเรียน</SheetTitle>
          <SheetDescription>รายละเอียดและกิจกรรมล่าสุดของนักเรียนคนนี้</SheetDescription>
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
            <p className="text-xs text-muted-foreground">รหัสนักเรียน</p>
            <p className="mt-1 text-sm font-semibold">{student.studentCode}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">การเข้าเรียนวันนี้</p>
            <p className="mt-1 text-sm font-semibold">{status ? ATTENDANCE_STATUS_LABEL[status] : '-'}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">คะแนนเฉลี่ย</p>
            <p className="mt-1 text-sm font-semibold">{total}/100</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">งานค้าง</p>
            <p className="mt-1 text-sm font-semibold">
              {missing > 0 ? <Badge variant="warning">{missing} งาน</Badge> : <Badge variant="success">ครบ</Badge>}
            </p>
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">กิจกรรมล่าสุดที่เกี่ยวข้อง</p>
          {relatedActivity.length > 0 ? (
            <ul className="space-y-2">
              {relatedActivity.map((item) => (
                <li key={item.id} className="flex gap-3 text-sm">
                  <span className="w-14 shrink-0 text-xs text-muted-foreground">{item.timeLabel}</span>
                  <span>{item.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">ไม่มีกิจกรรมล่าสุดที่เกี่ยวข้องกับนักเรียนคนนี้</p>
          )}
        </div>

        <Button
          variant="outline"
          onClick={() => navigate(`/teacher/reports?student=${student.id}`)}
        >
          <FileText className="size-4" />
          ดูรายงานนักเรียน
        </Button>
      </SheetContent>
    </Sheet>
  )
}
