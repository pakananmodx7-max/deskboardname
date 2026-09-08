import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { ClassroomStudent } from '@/types/student'

interface SubjectStudentDrawerProps {
  subjectName: string
  classroomName: string
  student: ClassroomStudent | null
  onOpenChange: (open: boolean) => void
}

/** Classroom-scoped equivalent of the earlier cross-classroom
 * SubjectStudentDrawer — now that the subject workspace itself is
 * classroom-scoped (see subject-classroom-workspace-page-real.tsx), the
 * viewed student is always a plain ClassroomStudent from the selected
 * classroom, not a merged SubjectStudentView. */
export function SubjectStudentDrawer({ subjectName, classroomName, student, onOpenChange }: SubjectStudentDrawerProps) {
  if (!student) return null

  return (
    <Sheet open={Boolean(student)} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>ข้อมูลนักเรียนในรายวิชา</SheetTitle>
          <SheetDescription>
            {subjectName} · {classroomName}
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-3">
          <Avatar className="size-12 text-base">{student.firstName.slice(0, 1)}</Avatar>
          <div>
            <p className="text-base font-semibold">
              {student.firstName} {student.lastName}
            </p>
            <p className="text-sm text-muted-foreground">
              {student.nickname ? `${student.nickname} · ` : ''}
              {student.number !== null ? `เลขที่ ${student.number}` : ''}
            </p>
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="text-muted-foreground">รหัสนักเรียน</span>
            <span>{student.studentCode ?? '-'}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="text-muted-foreground">อีเมล</span>
            <span>{student.email ?? '-'}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="text-muted-foreground">เบอร์โทร</span>
            <span>{student.phone ?? '-'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">สถานะ</span>
            <Badge variant={student.status === 'active' ? 'success' : 'outline'}>
              {student.status === 'active' ? 'กำลังเรียน' : 'ไม่ได้ใช้งาน'}
            </Badge>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          ข้อมูลงานค้างและคะแนนยังใช้งานได้เฉพาะในโหมดสาธิต — ยังไม่เชื่อมต่อกับฐานข้อมูลจริงในเฟสนี้
        </p>
      </SheetContent>
    </Sheet>
  )
}
