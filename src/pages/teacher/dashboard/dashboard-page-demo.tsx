import { useMemo } from 'react'

import { useDemoClassroom } from '@/demo/demo-context'
import { todayIso } from '@/features/classroom-analytics/analytics'
import { ClassroomAnalyticsDashboard } from '@/features/classroom-analytics/components/classroom-analytics-dashboard'
import { buildDemoAnalyticsDataset } from '@/features/classroom-analytics/demo-adapter'
import { success } from '@/features/classroom-analytics/resource'
import { useSemester } from '@/features/semester/semester-store'

import { useScrollToHashSection } from './use-scroll-to-hash'

const noop = () => {}

/**
 * Demo Mode counterpart: the same dashboard and calculations, fed from the
 * demo context through buildDemoAnalyticsDataset (no Supabase, nothing
 * fabricated); the semester comes from the same shared provider as the
 * header. Classrooms are read-only in the demo (as on the former demo
 * classroom list) and Student Analytics is real-data only, so names are
 * not linked here.
 */
export function DashboardPageDemo() {
  const { classroomName, classrooms, allStudents, subjects, subjectAssignments, subjectAttendance, attendance } = useDemoClassroom()
  const semester = useSemester()
  const today = todayIso()
  const dataset = useMemo(
    () => buildDemoAnalyticsDataset({ classroomName, classrooms, allStudents, subjects, subjectAssignments, subjectAttendance, attendance }, today),
    [classroomName, classrooms, allStudents, subjects, subjectAssignments, subjectAttendance, attendance, today],
  )
  const resources = useMemo(
    () => ({ roster: success(dataset.roster), attendance: success(dataset.attendance), assignments: success(dataset.assignments) }),
    [dataset],
  )
  useScrollToHashSection(true)

  return (
    <ClassroomAnalyticsDashboard
      context={semester.context}
      onRetryContext={semester.retryContext}
      scope={semester.scope}
      roster={resources.roster}
      onRetryRoster={noop}
      attendance={resources.attendance}
      onRetryAttendance={noop}
      assignments={resources.assignments}
      onRetryAssignments={noop}
      teacherName="คุณครูสมศรี"
      classroomsEditable={false}
      onClassroomsChanged={noop}
      today={today}
    />
  )
}
