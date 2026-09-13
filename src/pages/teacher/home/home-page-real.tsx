import { AlertTriangle, BookOpen, School, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { BarChart, type BarChartDatum } from '@/components/dashboard/bar-chart'
import { DashboardSection } from '@/components/dashboard/dashboard-section'
import { DonutChart, type DonutSegment } from '@/components/dashboard/donut-chart'
import { EmptyState } from '@/components/dashboard/empty-state'
import { StatCard } from '@/components/dashboard/stat-card'
import { RecentActivityCard } from '@/features/dashboard-real/recent-activity-card'
import { UpcomingAssignmentsCard } from '@/features/dashboard-real/upcoming-assignments-card'
import { ClassroomListCard } from '@/features/home/classroom-list-card'
import { HermesSummaryCard } from '@/features/home/hermes-summary-card'
import { useAuth } from '@/lib/auth-context'
import { toFriendlyErrorMessage } from '@/lib/errors'
import {
  getAssignmentActionItems,
  getClassroomListItems,
  getClassroomsWithStudentCounts,
  getDashboardFollowUpSummary,
  getDashboardOverview,
  getRecentActivity,
  getTodayAttendanceSummary,
  selectUpcomingAssignments,
  type AssignmentActionItem,
  type ClassroomListItem,
  type ClassroomWithStudentCount,
  type DashboardOverview,
  type RecentActivityItem,
} from '@/services/dashboard-service'
import type { AttendanceSummary } from '@/types/attendance'
import type { FollowUpRow } from '@/types/report'

/**
 * Which AttendanceSummary field backs each donut slice, and its color —
 * the only 4 statuses the real attendance data model supports (see
 * types/attendance.ts), never an invented category.
 */
const ATTENDANCE_SEGMENT_META: { key: keyof Omit<AttendanceSummary, 'total'>; label: string; stroke: string; dot: string }[] = [
  { key: 'present', label: 'มาเรียน', stroke: 'stroke-success', dot: 'bg-success' },
  { key: 'late', label: 'มาสาย', stroke: 'stroke-warning', dot: 'bg-warning' },
  { key: 'leave', label: 'ลาป่วย/ลา', stroke: 'stroke-primary', dot: 'bg-primary' },
  { key: 'absent', label: 'ขาดเรียน', stroke: 'stroke-destructive', dot: 'bg-destructive' },
]

function buildAttendanceDonutSegments(summary: AttendanceSummary): DonutSegment[] {
  return ATTENDANCE_SEGMENT_META.map((meta) => ({ label: meta.label, value: summary[meta.key], stroke: meta.stroke, dot: meta.dot }))
}

function buildClassroomBarData(classrooms: ClassroomWithStudentCount[]): BarChartDatum[] {
  return classrooms.map((c) => ({ label: c.name, value: c.studentCount }))
}

/**
 * /teacher/dashboard — the global "หน้าหลัก" command center (Requirement
 * 6: a personal command center, not a classroom-specific one). This is a
 * DIFFERENT page from the old /teacher/dashboard content, which moved,
 * unchanged, to /teacher/classroom-management (see
 * classroom-overview-page.tsx) and is now "ระบบจัดการชั้นเรียน → ภาพรวม" —
 * that page keeps its own full "สิ่งที่ต้องจัดการวันนี้" WorklistCard, so
 * removing it from here (see the KrunameClass visual redesign below)
 * loses no functionality; it stays one click away.
 *
 * Every widget here reads through an existing dashboard-service.ts query
 * (nothing new invented for this redesign except getClassroomListItems
 * and getTodayAttendanceSummary, both additive reads over already-used
 * tables) — no mock/demo data, no hardcoded teacher/student numbers. A
 * data source that doesn't exist (system/storage status, a global
 * current-semester value) is simply omitted rather than fabricated.
 *
 * Layout matches the approved KrunameClass dashboard reference: hero,
 * then 4 stat cards, bar chart, donut chart, recent activity, and the
 * classroom list all lead the main column — the old long
 * "สิ่งที่ต้องจัดการ" list and the "coming soon" module teaser cards were
 * deliberately dropped from THIS page so they no longer dominate/clutter
 * it (the worklist survives on Classroom Management → ภาพรวม above; the
 * module teasers carried no real data to begin with).
 */
export function HomePageReal() {
  const { profile } = useAuth()

  const [overview, setOverview] = useState<DashboardOverview | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(true)
  const [overviewError, setOverviewError] = useState<string | null>(null)

  const [assignmentItems, setAssignmentItems] = useState<AssignmentActionItem[]>([])
  const [followUpRows, setFollowUpRows] = useState<FollowUpRow[]>([])
  const [assignmentsLoading, setAssignmentsLoading] = useState(true)
  const [assignmentsError, setAssignmentsError] = useState<string | null>(null)

  const [classroomsWithCounts, setClassroomsWithCounts] = useState<ClassroomWithStudentCount[]>([])
  const [classroomsLoading, setClassroomsLoading] = useState(true)
  const [classroomsError, setClassroomsError] = useState<string | null>(null)

  const [classroomListItems, setClassroomListItems] = useState<ClassroomListItem[]>([])
  const [classroomListLoading, setClassroomListLoading] = useState(true)
  const [classroomListError, setClassroomListError] = useState<string | null>(null)

  const [attendanceSummary, setAttendanceSummary] = useState<AttendanceSummary | null>(null)
  const [attendanceSummaryLoading, setAttendanceSummaryLoading] = useState(true)
  const [attendanceSummaryError, setAttendanceSummaryError] = useState<string | null>(null)

  const [activityItems, setActivityItems] = useState<RecentActivityItem[]>([])
  const [activityLoading, setActivityLoading] = useState(true)
  const [activityError, setActivityError] = useState<string | null>(null)

  const loadAssignmentsAndFollowUp = useCallback(() => {
    setAssignmentsLoading(true)
    setAssignmentsError(null)
    return Promise.all([getAssignmentActionItems(), getDashboardFollowUpSummary()])
      .then(([assignments, followUp]) => {
        setAssignmentItems(assignments)
        setFollowUpRows(followUp)
      })
      .catch((err: unknown) => setAssignmentsError(toFriendlyErrorMessage(err)))
      .finally(() => setAssignmentsLoading(false))
  }, [])

  useEffect(() => {
    let active = true

    getDashboardOverview()
      .then((result) => active && setOverview(result))
      .catch((err: unknown) => active && setOverviewError(toFriendlyErrorMessage(err)))
      .finally(() => active && setOverviewLoading(false))

    loadAssignmentsAndFollowUp()

    getClassroomsWithStudentCounts()
      .then((result) => active && setClassroomsWithCounts(result))
      .catch((err: unknown) => active && setClassroomsError(toFriendlyErrorMessage(err)))
      .finally(() => active && setClassroomsLoading(false))

    getClassroomListItems()
      .then((result) => active && setClassroomListItems(result))
      .catch((err: unknown) => active && setClassroomListError(toFriendlyErrorMessage(err)))
      .finally(() => active && setClassroomListLoading(false))

    getTodayAttendanceSummary()
      .then((result) => active && setAttendanceSummary(result))
      .catch((err: unknown) => active && setAttendanceSummaryError(toFriendlyErrorMessage(err)))
      .finally(() => active && setAttendanceSummaryLoading(false))

    getRecentActivity()
      .then((result) => active && setActivityItems(result))
      .catch((err: unknown) => active && setActivityError(toFriendlyErrorMessage(err)))
      .finally(() => active && setActivityLoading(false))

    return () => {
      active = false
    }
  }, [loadAssignmentsAndFollowUp])

  const greetingName = profile?.displayName || profile?.email || 'ครู'
  const followUpCount = followUpRows.length
  const upcomingAssignments = selectUpcomingAssignments(assignmentItems)

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-primary/5 to-transparent px-6 py-6 sm:px-8 sm:py-8">
        <p className="text-sm font-medium text-primary">ยินดีต้อนรับ ครูผู้สอน</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">สวัสดี, {greetingName}</h1>
        <p className="mt-2 text-sm text-muted-foreground">ภาพรวมการจัดการชั้นเรียนของคุณในวันนี้</p>
        <p className="mt-3 text-sm italic text-muted-foreground">&ldquo;นักเรียนที่ดี เริ่มจากครูที่ใส่ใจ&rdquo;</p>
      </div>

      {overviewError && <p className="text-sm text-destructive">{overviewError}</p>}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="นักเรียนทั้งหมด" value={overviewLoading ? '-' : `${overview?.studentCount ?? 0}`} icon={Users} />
            <StatCard
              label="ห้องเรียนทั้งหมด"
              value={overviewLoading ? '-' : `${overview?.activeClassroomCount ?? 0}`}
              icon={School}
            />
            <StatCard label="รายวิชาที่สอน" value={overviewLoading ? '-' : `${overview?.subjectCount ?? 0}`} icon={BookOpen} />
            <StatCard
              label="นักเรียนที่ควรติดตาม"
              value={assignmentsLoading ? '-' : `${followUpCount}`}
              icon={AlertTriangle}
              tone={followUpCount > 0 ? 'warning' : 'default'}
            />
          </div>

          <DashboardSection title="จำนวนนักเรียนแยกตามห้องเรียน">
            {classroomsLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
            ) : classroomsError ? (
              <p className="py-6 text-center text-sm text-destructive">{classroomsError}</p>
            ) : classroomsWithCounts.length === 0 ? (
              <EmptyState message="ยังไม่มีห้องเรียน" />
            ) : (
              <BarChart data={buildClassroomBarData(classroomsWithCounts)} unit=" คน" />
            )}
          </DashboardSection>

          <DashboardSection title="สถานะการเข้าเรียนวันนี้">
            {attendanceSummaryLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
            ) : attendanceSummaryError ? (
              <p className="py-6 text-center text-sm text-destructive">{attendanceSummaryError}</p>
            ) : !attendanceSummary || attendanceSummary.total === 0 ? (
              <EmptyState message="วันนี้ยังไม่มีการบันทึกการเช็กชื่อ" />
            ) : (
              <DonutChart segments={buildAttendanceDonutSegments(attendanceSummary)} centerLabel="คน" />
            )}
          </DashboardSection>

          <RecentActivityCard loading={activityLoading} error={activityError} items={activityItems} />

          <ClassroomListCard loading={classroomListLoading} error={classroomListError} items={classroomListItems} />
        </div>

        <div className="space-y-6">
          <UpcomingAssignmentsCard loading={assignmentsLoading} error={assignmentsError} items={upcomingAssignments} />

          <HermesSummaryCard />
        </div>
      </div>
    </div>
  )
}
