import { AlertTriangle, BookOpen, School, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { QuickActions } from '@/components/dashboard/quick-actions'
import { StatCard } from '@/components/dashboard/stat-card'
import { AssignmentActionCard } from '@/features/dashboard-real/assignment-action-card'
import { DashboardFollowUpCard } from '@/features/dashboard-real/dashboard-followup-card'
import { RecentActivityCard } from '@/features/dashboard-real/recent-activity-card'
import { TodayAttendanceCard } from '@/features/dashboard-real/today-attendance-card'
import { UpcomingAssignmentsCard } from '@/features/dashboard-real/upcoming-assignments-card'
import { toFriendlyErrorMessage } from '@/lib/errors'
import {
  getAssignmentActionItems,
  getDashboardFollowUpSummary,
  getDashboardOverview,
  getRecentActivity,
  getTodaySubjectAttendanceStatus,
  selectAssignmentsNeedingAttention,
  selectUpcomingAssignments,
  type AssignmentActionItem,
  type DashboardOverview,
  type RecentActivityItem,
  type TodayAttendanceStatus,
} from '@/services/dashboard-service'
import type { FollowUpRow } from '@/types/report'

/**
 * /teacher/dashboard — the Control Center. Real Supabase data only, no
 * demo/mock fallback anywhere (see dashboard-service.ts). Every section
 * below loads and fails INDEPENDENTLY: the assignment action center and
 * upcoming list share one fetch (they're both derived views over the
 * exact same assignment data, by design — not an N+1 fallback), but a
 * failure there never blanks Today's Attendance, Follow-up, or Recent
 * Activity, and vice versa. No decorative/fabricated metric appears
 * anywhere on this page — a metric that cannot be reliably computed from
 * real data is simply not shown (see the Control Center report for what
 * was deliberately left out and why).
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

  const needingAttention = selectAssignmentsNeedingAttention(assignmentItems)
  const upcoming = selectUpcomingAssignments(assignmentItems)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">ภาพรวม</h1>
        <p className="mt-1 text-sm text-muted-foreground">ภาคเรียนที่ 1 / 2569</p>
      </div>

      {overviewError && <p className="text-sm text-destructive">{overviewError}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="นักเรียนทั้งหมด"
          value={overviewLoading ? '-' : `${overview?.studentCount ?? 0} คน`}
          icon={Users}
        />
        <StatCard
          label="ห้องเรียนทั้งหมด"
          value={overviewLoading ? '-' : `${overview?.activeClassroomCount ?? 0} ห้อง`}
          icon={School}
        />
        <StatCard
          label="รายวิชาที่สอน"
          value={overviewLoading ? '-' : `${overview?.subjectCount ?? 0} วิชา`}
          icon={BookOpen}
        />
        <StatCard
          label="นักเรียนที่ควรติดตาม"
          value={followUpLoading ? '-' : `${followUpRows.length} คน`}
          icon={AlertTriangle}
          tone={!followUpLoading && followUpRows.length > 0 ? 'warning' : 'default'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <QuickActions />
          <TodayAttendanceCard loading={attendanceLoading} error={attendanceError} items={attendanceItems} />
          <AssignmentActionCard loading={assignmentLoading} error={assignmentError} items={needingAttention} />
        </div>

        <div className="space-y-4">
          <DashboardFollowUpCard loading={followUpLoading} error={followUpError} rows={followUpRows} />
          <UpcomingAssignmentsCard loading={assignmentLoading} error={assignmentError} items={upcoming} />
          <RecentActivityCard loading={activityLoading} error={activityError} items={activityItems} />
        </div>
      </div>
    </div>
  )
}
