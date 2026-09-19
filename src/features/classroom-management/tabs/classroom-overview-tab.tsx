import { Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Card, CardContent } from '@/components/ui/card'
import { WorklistCard } from '@/components/dashboard/worklist-card'
import { attendanceToWorklistItems, assignmentsToWorklistItems, followUpToWorklistItems } from '@/features/dashboard-shared/worklist'
import { toFriendlyErrorMessage } from '@/lib/errors'
import {
  getAssignmentActionItems,
  getDashboardFollowUpSummary,
  getTodaySubjectAttendanceStatus,
} from '@/services/dashboard-service'
import type { Classroom } from '@/types/classroom'

interface ClassroomOverviewTabProps {
  classroom: Classroom
  studentCount: number
}

/**
 * Requirement C1 (UX audit → implementation plan): the same unified
 * worklist shown on Home and Classroom Management's own ภาพรวม, scoped
 * to just this classroom via the optional classroomId param on the 3
 * dashboard-service functions — this tab used to be the least
 * actionable "overview" in the app (one stat + static metadata); it now
 * shows what actually needs a decision in this specific room today.
 */
export function ClassroomOverviewTab({ classroom, studentCount }: ClassroomOverviewTabProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [worklistItems, setWorklistItems] = useState<ReturnType<typeof attendanceToWorklistItems>>([])

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    return Promise.all([
      getTodaySubjectAttendanceStatus(classroom.id),
      getAssignmentActionItems(classroom.id),
      getDashboardFollowUpSummary(classroom.id),
    ])
      .then(([attendance, assignments, followUp]) => {
        setWorklistItems([
          ...attendanceToWorklistItems(attendance),
          ...assignmentsToWorklistItems(assignments),
          ...followUpToWorklistItems(followUp),
        ])
      })
      .catch((err: unknown) => setError(toFriendlyErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [classroom.id])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex items-center justify-between pt-5">
            <div>
              <p className="text-sm text-muted-foreground">นักเรียนทั้งหมด</p>
              <p className="mt-1.5 text-2xl font-semibold tracking-tight">{studentCount} คน</p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Users className="size-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      <WorklistCard
        title="สิ่งที่ต้องจัดการในห้องนี้"
        loading={loading}
        error={error}
        items={worklistItems}
        emptyMessage="ไม่มีสิ่งที่ต้องจัดการในห้องนี้ตอนนี้"
      />

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
