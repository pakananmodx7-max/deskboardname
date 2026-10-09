import { useCallback } from 'react'

import { todayIso } from '@/features/classroom-analytics/analytics'
import { ClassroomAnalyticsDashboard } from '@/features/classroom-analytics/components/classroom-analytics-dashboard'
import { useSemesterAnalyticsData } from '@/features/classroom-analytics/use-classroom-analytics'
import { useSemester } from '@/features/semester/semester-store'
import { buildStudentAnalyticsPath } from '@/features/subjects-shared/subject-classroom-nav'
import { useAuth } from '@/lib/auth-context'

import { useScrollToHashSection } from './use-scroll-to-hash'

/**
 * หน้าภาพรวม (real Supabase data) — the unified teacher dashboard that
 * replaces the former home, classroom overview and classroom list pages.
 * The semester comes from the shared SemesterProvider (the header's
 * selector); classrooms/subjects are loaded once there, and the
 * semester's roster/attendance/assignments here (RLS-scoped to this
 * teacher, batched and paged, cached per semester, each section loading
 * and failing independently).
 */
export function DashboardPageReal() {
  const { profile } = useAuth()
  const semester = useSemester()
  const data = useSemesterAnalyticsData(semester.scope?.classroomIds ?? null)
  const { refreshContext } = semester
  const { reloadAll } = data
  useScrollToHashSection(semester.context.status === 'success')

  const handleClassroomsChanged = useCallback(() => {
    refreshContext()
    reloadAll()
  }, [refreshContext, reloadAll])

  return (
    <ClassroomAnalyticsDashboard
      context={semester.context}
      onRetryContext={semester.retryContext}
      scope={semester.scope}
      roster={data.roster.resource}
      onRetryRoster={data.roster.retry}
      attendance={data.attendance.resource}
      onRetryAttendance={data.attendance.retry}
      assignments={data.assignments.resource}
      onRetryAssignments={data.assignments.retry}
      teacherName={profile?.displayName?.trim() || 'คุณครู'}
      classroomsEditable
      onClassroomsChanged={handleClassroomsChanged}
      studentLink={(stat) => (stat.analyticsSubjectId ? buildStudentAnalyticsPath(stat.analyticsSubjectId, stat.classroomId, stat.studentId) : null)}
      today={todayIso()}
    />
  )
}
