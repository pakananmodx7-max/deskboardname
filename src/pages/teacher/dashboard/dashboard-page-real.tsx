import { AlertTriangle, BookOpen, School, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { StatStrip } from '@/components/dashboard/stat-strip'
import { WorklistCard } from '@/components/dashboard/worklist-card'
import { attendanceToWorklistItems, assignmentsToWorklistItems, followUpToWorklistItems } from '@/features/dashboard-shared/worklist'
import { RecentActivityCard } from '@/features/dashboard-real/recent-activity-card'
import { toFriendlyErrorMessage } from '@/lib/errors'
import {
  getAssignmentActionItems,
  getDashboardFollowUpSummary,
  getDashboardOverview,
  getRecentActivity,
  getTodaySubjectAttendanceStatus,
  type AssignmentActionItem,
  type DashboardOverview,
  type RecentActivityItem,
  type TodayAttendanceStatus,
} from '@/services/dashboard-service'
import type { FollowUpRow } from '@/types/report'

/**
 * /teacher/dashboard's real content, now reused at /teacher/classroom-
 * management as "ภาพรวม" (see classroom-overview-page.tsx). Real
 * Supabase data only, no demo/mock fallback anywhere (see
 * dashboard-service.ts).
 *
 * Requirement C1 (UX audit → implementation plan): the old page stacked
 * six independently-loading cards (Quick Actions, Today's Attendance,
 * Assignment Action Center, Follow-up, Upcoming, Recent Activity) —
 * four of Quick Actions' six buttons pointed at the identical URL
 * regardless of label, and Assignment Action + Upcoming both read the
 * same underlying assignment data split two ways. Quick Actions and
 * Upcoming are retired; Today's Attendance, Assignment Action, and
 * Follow-up are merged into ONE WorklistCard ("what needs a decision
 * right now"), reusing the exact same deep-link targets each separate
 * card already used (see worklist.ts) — nothing about where a click
 * lands changed, only that the three lists now render as one. Recent
 * Activity is kept (it's a log of the past, not an overlapping to-do
 * list, and nothing in the audit found it redundant) but demoted to a
 * secondary position under the worklist.
 */
export function DashboardPageReal() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(true)
  const [overviewError, setOverviewError] = useState<string | null>(null)

  const [attendanceItems, setAttendanceItems] = useState<TodayAttendanceStatus[]>([])
  const [attendanceLoading, setAttendanceLoading] = useState(true)
  const [attendanceError, setAttendanceError] = useState<string | null>(null)

  const [assignmentItems, setAssignmentItems] = useState<AssignmentActionItem[]>([])
  const [assignmentLoading, setAssignmentLoading] = useState(true)
  const [assignmentError, setAssignmentError] = useState<string | null>(null)

  const [followUpRows, setFollowUpRows] = useState<FollowUpRow[]>([])
  const [followUpLoading, setFollowUpLoading] = useState(true)
  const [followUpError, setFollowUpError] = useState<string | null>(null)

  const [activityItems, setActivityItems] = useState<RecentActivityItem[]>([])
  const [activityLoading, setActivityLoading] = useState(true)
  const [activityError, setActivityError] = useState<string | null>(null)

  const loadOverview = useCallback(() => {
    setOverviewLoading(true)
    setOverviewError(null)
    return getDashboardOverview()
      .then(setOverview)
      .catch((err: unknown) => setOverviewError(toFriendlyErrorMessage(err)))
      .finally(() => setOverviewLoading(false))
  }, [])

  const loadAttendance = useCallback(() => {
    setAttendanceLoading(true)
    setAttendanceError(null)
    return getTodaySubjectAttendanceStatus()
      .then(setAttendanceItems)
      .catch((err: unknown) => setAttendanceError(toFriendlyErrorMessage(err)))
      .finally(() => setAttendanceLoading(false))
  }, [])

  const loadAssignments = useCallback(() => {
    setAssignmentLoading(true)
    setAssignmentError(null)
    return getAssignmentActionItems()
      .then(setAssignmentItems)
      .catch((err: unknown) => setAssignmentError(toFriendlyErrorMessage(err)))
      .finally(() => setAssignmentLoading(false))
  }, [])

  const loadFollowUp = useCallback(() => {
    setFollowUpLoading(true)
    setFollowUpError(null)
    return getDashboardFollowUpSummary()
      .then(setFollowUpRows)
      .catch((err: unknown) => setFollowUpError(toFriendlyErrorMessage(err)))
      .finally(() => setFollowUpLoading(false))
  }, [])

  const loadActivity = useCallback(() => {
    setActivityLoading(true)
    setActivityError(null)
    return getRecentActivity()
      .then(setActivityItems)
      .catch((err: unknown) => setActivityError(toFriendlyErrorMessage(err)))
      .finally(() => setActivityLoading(false))
  }, [])

  useEffect(() => {
    loadOverview()
    loadAttendance()
    loadAssignments()
    loadFollowUp()
    loadActivity()
  }, [loadOverview, loadAttendance, loadAssignments, loadFollowUp, loadActivity])

  const worklistLoading = attendanceLoading || assignmentLoading || followUpLoading
  const worklistError = attendanceError || assignmentError || followUpError
  const worklistItems = [
    ...attendanceToWorklistItems(attendanceItems),
    ...assignmentsToWorklistItems(assignmentItems),
    ...followUpToWorklistItems(followUpRows),
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">ภาพรวม</h1>
        <p className="mt-1 text-sm text-muted-foreground">ภาคเรียนที่ 1 / 2569</p>
      </div>

      {overviewError && <p className="text-sm text-destructive">{overviewError}</p>}

      <StatStrip
        items={[
          { label: 'นักเรียนทั้งหมด', value: overviewLoading ? '-' : `${overview?.studentCount ?? 0} คน`, icon: Users },
          { label: 'ห้องเรียนทั้งหมด', value: overviewLoading ? '-' : `${overview?.activeClassroomCount ?? 0} ห้อง`, icon: School },
          { label: 'รายวิชาที่สอน', value: overviewLoading ? '-' : `${overview?.subjectCount ?? 0} วิชา`, icon: BookOpen },
          {
            label: 'นักเรียนที่ควรติดตาม',
            value: followUpLoading ? '-' : `${followUpRows.length} คน`,
            icon: AlertTriangle,
            tone: !followUpLoading && followUpRows.length > 0 ? 'warning' : 'default',
          },
        ]}
      />

      <WorklistCard
        title="สิ่งที่ต้องจัดการ"
        loading={worklistLoading}
        error={worklistError}
        items={worklistItems}
        emptyMessage="ไม่มีสิ่งที่ต้องจัดการในตอนนี้"
      />

      <RecentActivityCard loading={activityLoading} error={activityError} items={activityItems} />
    </div>
  )
}
