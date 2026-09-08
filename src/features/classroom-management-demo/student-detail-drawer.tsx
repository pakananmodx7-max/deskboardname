import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { DemoStudent } from '@/demo/types'

interface StudentDetailDrawerProps {
  classroomName: string
  student: DemoStudent | null
  onOpenChange: (open: boolean) => void
}

export function StudentDetailDrawer({ classroomName, student, onOpenChange }: StudentDetailDrawerProps) {
  if (!student) return null

  return (
    <Sheet open={Boolean(student)} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>ข้อมูลนักเรียน</SheetTitle>
          <SheetDescription>{classroomName}</SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-3">
          <Avatar className="size-12 text-base">{student.firstName.slice(0, 1)}</Avatar>
          <div>
            <p className="text-base font-semibold">
              {student.firstName} {student.lastName}
            </p>
            <p className="text-sm text-muted-foreground">
              {student.nickname ? `${student.nickname} · ` : ''}เลขที่ {student.number}
            </p>
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="text-muted-foreground">รหัสนักเรียน</span>
            <span>{student.studentCode}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">สถานะ</span>
            <Badge variant={student.status === 'active' ? 'success' : 'outline'}>
              {student.status === 'active' ? 'กำลังเรียน' : 'ไม่ได้ใช้งาน'}
            </Badge>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
