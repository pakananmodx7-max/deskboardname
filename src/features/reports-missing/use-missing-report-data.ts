import { useCallback, useMemo } from 'react'

import { useDemoClassroom } from '@/demo/demo-context'
import { todayIso, type AnalyticsAssignmentData, type AnalyticsRoster } from '@/features/classroom-analytics/analytics'
import { buildDemoAnalyticsDataset } from '@/features/classroom-analytics/demo-adapter'
import { combineResources, success, type Resource } from '@/features/classroom-analytics/resource'
import { classroomIdsKey, idsFromKey, supabaseAnalyticsLoaders, useKeyedResource } from '@/features/classroom-analytics/use-classroom-analytics'
import { useSemester } from '@/features/semester/semester-store'

export interface MissingReportData {
  data: Resource<[AnalyticsRoster, AnalyticsAssignmentData]>
  /** Reloads the semester's roster and assignments (and the classroom list). */
  refresh: () => void
}

const loadRoster = (key: string) => supabaseAnalyticsLoaders.roster(idsFromKey(key))
const loadAssignments = (key: string) => supabaseAnalyticsLoaders.assignments(idsFromKey(key))

/**
 * Real mode: the semester's roster + assignments/submissions through the
 * same batched, paged, timeout-protected and RLS-scoped loaders as the
 * dashboard (classroom-analytics-service.ts) — a fixed number of queries,
 * never one per assignment or classroom. Results are cached per classroom
 * set, so a late response for a previous semester is never shown for the
 * current one.
 */
export function useMissingReportDataReal(): MissingReportData {
  const { scope, refreshContext } = useSemester()
  const key = useMemo(() => (scope ? classroomIdsKey(scope.classroomIds) : null), [scope])
  const roster = useKeyedResource(key, loadRoster)
  const assignments = useKeyedResource(key, loadAssignments)
  const data = useMemo(() => combineResources(roster.resource, assignments.resource), [roster.resource, assignments.resource])
  const { retry: retryRoster } = roster
  const { retry: retryAssignments } = assignments
  const refresh = useCallback(() => {
    refreshContext()
    retryRoster()
    retryAssignments()
  }, [refreshContext, retryRoster, retryAssignments])
  return { data, refresh }
}

/** Demo Mode: the same dataset shape built from the demo store. */
export function useMissingReportDataDemo(): MissingReportData {
  const { classroomName, classrooms, allStudents, subjects, subjectAssignments, subjectAttendance, attendance } = useDemoClassroom()
  const data = useMemo(() => {
    const dataset = buildDemoAnalyticsDataset({ classroomName, classrooms, allStudents, subjects, subjectAssignments, subjectAttendance, attendance }, todayIso())
    return success([dataset.roster, dataset.assignments] as [AnalyticsRoster, AnalyticsAssignmentData])
  }, [classroomName, classrooms, allStudents, subjects, subjectAssignments, subjectAttendance, attendance])
  return { data, refresh: () => {} }
}
