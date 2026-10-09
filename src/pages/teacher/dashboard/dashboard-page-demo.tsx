import { useMemo, useState } from 'react'

import { useDemoClassroom } from '@/demo/demo-context'
import { pickDefaultSemester, todayIso } from '@/features/classroom-analytics/analytics'
import { ClassroomAnalyticsDashboard } from '@/features/classroom-analytics/components/classroom-analytics-dashboard'
import { buildDemoAnalyticsDataset } from '@/features/classroom-analytics/demo-adapter'
import { success } from '@/features/classroom-analytics/resource'

const noop = () => {}

/**
 * Demo Mode counterpart: the same dashboard and calculations, fed from the
 * demo context through buildDemoAnalyticsDataset (no Supabase, nothing
 * fabricated). Student Analytics is real-data only, so names are not
 * linked here.
 */
export function DashboardPageDemo() {
  const { classroomName, classrooms, allStudents, subjects, subjectAssignments, subjectAttendance, attendance } = useDemoClassroom()
  const today = todayIso()
  const dataset = useMemo(
    () => buildDemoAnalyticsDataset({ classroomName, classrooms, allStudents, subjects, subjectAssignments, subjectAttendance, attendance }, today),
    [classroomName, classrooms, allStudents, subjects, subjectAssignments, subjectAttendance, attendance, today],
  )
  const resources = useMemo(
    () => ({
      context: success(dataset.context),
      roster: success(dataset.roster),
      attendance: success(dataset.attendance),
      assignments: success(dataset.assignments),
    }),
    [dataset],
  )
  const [selectedSemester, setSelectedSemester] = useState<string | null>(null)
  const semesterKey = selectedSemester ?? pickDefaultSemester(dataset.context)

  return (
    <ClassroomAnalyticsDashboard
      context={resources.context}
      onRetryContext={noop}
      semesterKey={semesterKey}
      onSemesterChange={setSelectedSemester}
      roster={resources.roster}
      onRetryRoster={noop}
      attendance={resources.attendance}
      onRetryAttendance={noop}
      assignments={resources.assignments}
      onRetryAssignments={noop}
      today={today}
    />
  )
}
