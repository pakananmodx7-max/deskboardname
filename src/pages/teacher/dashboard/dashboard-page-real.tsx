import { ClassroomAnalyticsDashboard } from '@/features/classroom-analytics/components/classroom-analytics-dashboard'
import { todayIso } from '@/features/classroom-analytics/analytics'
import { useClassroomAnalyticsData } from '@/features/classroom-analytics/use-classroom-analytics'
import { buildStudentAnalyticsPath } from '@/features/subjects-shared/subject-classroom-nav'

/**
 * ระบบจัดการห้องเรียน → ภาพรวม (real Supabase data) — the Classroom
 * Analytics Dashboard. Every figure is computed by
 * features/classroom-analytics/analytics.ts from data loaded by
 * classroom-analytics-service.ts (RLS-scoped to this teacher, batched and
 * paged, each section loading and failing independently). The previous
 * worklist/recent-activity lists are gone from this page; classroom
 * management itself stays on its own pages.
 */
export function DashboardPageReal() {
  const data = useClassroomAnalyticsData()
  return (
    <ClassroomAnalyticsDashboard
      context={data.context.resource}
      onRetryContext={data.context.retry}
      semesterKey={data.semesterKey}
      onSemesterChange={data.setSemester}
      roster={data.roster.resource}
      onRetryRoster={data.roster.retry}
      attendance={data.attendance.resource}
      onRetryAttendance={data.attendance.retry}
      assignments={data.assignments.resource}
      onRetryAssignments={data.assignments.retry}
      studentLink={(stat) => (stat.analyticsSubjectId ? buildStudentAnalyticsPath(stat.analyticsSubjectId, stat.classroomId, stat.studentId) : null)}
      today={todayIso()}
    />
  )
}
