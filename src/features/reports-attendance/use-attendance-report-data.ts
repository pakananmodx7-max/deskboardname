import { useCallback, useMemo } from 'react'

import { useDemoClassroom } from '@/demo/demo-context'
import { todayIso, type AnalyticsAttendanceRecord, type AnalyticsRoster } from '@/features/classroom-analytics/analytics'
import { buildDemoAnalyticsDataset } from '@/features/classroom-analytics/demo-adapter'
import { combineResources, success, type Resource } from '@/features/classroom-analytics/resource'
import { classroomIdsKey, idsFromKey, supabaseAnalyticsLoaders, useKeyedResource } from '@/features/classroom-analytics/use-classroom-analytics'
import { useSemester } from '@/features/semester/semester-store'
import { dataMode } from '@/lib/data-mode'

export interface AttendanceReportData {
  data: Resource<[AnalyticsRoster, AnalyticsAttendanceRecord[]]>
  refresh: () => void
}

const loadRoster = (key: string) => supabaseAnalyticsLoaders.roster(idsFromKey(key))
const loadAttendance = (key: string) => supabaseAnalyticsLoaders.attendance(idsFromKey(key))

/**
 * Real mode: the semester's roster + every attendance record (with its
 * session) through the dashboard's batched, paged, timeout-protected,
 * RLS-scoped loaders — one embedded query per id chunk, never one per
 * session, classroom or student. Cached per classroom set, so a late
 * response for a previous semester never replaces the current one.
 */
export function useAttendanceReportDataReal(): AttendanceReportData {
  const { scope, refreshContext } = useSemester()
  const key = useMemo(() => (scope ? classroomIdsKey(scope.classroomIds) : null), [scope])
  const roster = useKeyedResource(key, loadRoster)
  const attendance = useKeyedResource(key, loadAttendance)
  const data = useMemo(() => combineResources(roster.resource, attendance.resource), [roster.resource, attendance.resource])
  const { retry: retryRoster } = roster
  const { retry: retryAttendance } = attendance
  const refresh = useCallback(() => {
    refreshContext()
    retryRoster()
    retryAttendance()
  }, [refreshContext, retryRoster, retryAttendance])
  return { data, refresh }
}

/** Demo Mode: the same dataset shape built from the demo store. */
export function useAttendanceReportDataDemo(): AttendanceReportData {
  const { classroomName, classrooms, allStudents, subjects, subjectAssignments, subjectAttendance, attendance } = useDemoClassroom()
  const data = useMemo(() => {
    const dataset = buildDemoAnalyticsDataset({ classroomName, classrooms, allStudents, subjects, subjectAssignments, subjectAttendance, attendance }, todayIso())
    return success([dataset.roster, dataset.attendance] as [AnalyticsRoster, AnalyticsAttendanceRecord[]])
  }, [classroomName, classrooms, allStudents, subjects, subjectAssignments, subjectAttendance, attendance])
  return { data, refresh: () => {} }
}

/** Decided once per app load (dataMode is constant), so hook order never changes. */
export const useAttendanceReportData: () => AttendanceReportData = dataMode === 'supabase' ? useAttendanceReportDataReal : useAttendanceReportDataDemo
