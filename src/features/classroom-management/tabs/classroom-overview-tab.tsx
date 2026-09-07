import { Users } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import type { Classroom } from '@/types/classroom'

interface ClassroomOverviewTabProps {
  classroom: Classroom
  studentCount: number
}

export function ClassroomOverviewTab({ classroom, studentCount }: ClassroomOverviewTabProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex items-center justify-between pt-5">
            <div>
              <p className="text-sm text-muted-foreground">นักเรียนทั้งหมด</p>
              <p className="mt-1.5 text-2xl font-semibold tracking-tight">{studentCount} คน</p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Users className="size-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-3 pt-5 text-sm sm:grid-cols-2">
          <div className="flex items-center justify-between border-b border-border pb-2 sm:border-b-0 sm:pb-0">
            <span className="text-muted-foreground">ระดับชั้น</span>
            <span>{classroom.gradeLevel ?? '-'}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2 sm:border-b-0 sm:pb-0">
            <span className="text-muted-foreground">ห้อง</span>
            <span>{classroom.section ?? '-'}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2 sm:border-b-0 sm:pb-0">
            <span className="text-muted-foreground">ปีการศึกษา</span>
            <span>{classroom.academicYear ?? '-'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">ภาคเรียน</span>
            <span>{classroom.semester ?? '-'}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
