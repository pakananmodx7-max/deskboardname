import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { toFriendlyErrorMessage } from '@/lib/errors'
import {
  getAnalyticsAssignments,
  getAnalyticsAttendance,
  getAnalyticsContext,
  getAnalyticsRoster,
} from '@/services/classroom-analytics-service'

import {
  pickDefaultSemester,
  resolveSemesterScope,
  type AnalyticsAssignmentData,
  type AnalyticsAttendanceRecord,
  type AnalyticsContext,
  type AnalyticsRoster,
} from './analytics'
import { LOADING, success, type Resource } from './resource'

export interface ClassroomAnalyticsLoaders {
  context: () => Promise<AnalyticsContext>
  roster: (classroomIds: string[]) => Promise<AnalyticsRoster>
  attendance: (classroomIds: string[]) => Promise<AnalyticsAttendanceRecord[]>
  assignments: (classroomIds: string[]) => Promise<AnalyticsAssignmentData>
}

export const supabaseAnalyticsLoaders: ClassroomAnalyticsLoaders = {
  context: getAnalyticsContext,
  roster: getAnalyticsRoster,
  attendance: getAnalyticsAttendance,
  assignments: getAnalyticsAssignments,
}

/** Cache key for a set of classrooms — order-independent. */
export function classroomIdsKey(ids: Iterable<string>): string {
  return `ids:${[...ids].sort().join(',')}`
}

export function idsFromKey(key: string): string[] {
  const list = key.slice('ids:'.length)
  return list ? list.split(',') : []
}

/**
 * One cached result per key. A key starts loading the first time it is
 * needed; switching back to a key already loaded reuses its result (no
 * repeat request); a late response for an old key is cached under that
 * key and never shown for the current one. `retry` drops the cached error
 * so the load runs again.
 */
export function useKeyedResource<T>(key: string | null, load: (key: string) => Promise<T>): { resource: Resource<T>; retry: () => void } {
  const [results, setResults] = useState<Record<string, Resource<T>>>({})
  const inFlight = useRef(new Set<string>())

  useEffect(() => {
    if (key === null || results[key] || inFlight.current.has(key)) return
    inFlight.current.add(key)
    load(key)
      .then(
        (data) => setResults((prev) => ({ ...prev, [key]: success(data) })),
        (err: unknown) => setResults((prev) => ({ ...prev, [key]: { status: 'error', error: toFriendlyErrorMessage(err, 'โหลดข้อมูลไม่สำเร็จ') } })),
      )
      .finally(() => inFlight.current.delete(key))
  }, [key, results, load])

  const retry = useCallback(() => {
    if (key === null) return
    setResults((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [key])

  return { resource: key === null ? LOADING : (results[key] ?? LOADING), retry }
}

/** All data for the real (Supabase) dashboard, each part independent. */
export function useClassroomAnalyticsData(loaders: ClassroomAnalyticsLoaders = supabaseAnalyticsLoaders) {
  const loadContext = useCallback(() => loaders.context(), [loaders])
  const loadRoster = useCallback((key: string) => loaders.roster(idsFromKey(key)), [loaders])
  const loadAttendance = useCallback((key: string) => loaders.attendance(idsFromKey(key)), [loaders])
  const loadAssignments = useCallback((key: string) => loaders.assignments(idsFromKey(key)), [loaders])

  const context = useKeyedResource('context', loadContext)
  const [selectedSemester, setSelectedSemester] = useState<string | null>(null)
  const semesterKey = selectedSemester ?? (context.resource.status === 'success' ? pickDefaultSemester(context.resource.data) : null)

  const idsKey = useMemo(() => {
    if (context.resource.status !== 'success' || semesterKey === null) return null
    return classroomIdsKey(resolveSemesterScope(context.resource.data, semesterKey).classroomIds)
  }, [context.resource, semesterKey])

  const roster = useKeyedResource(idsKey, loadRoster)
  const attendance = useKeyedResource(idsKey, loadAttendance)
  const assignments = useKeyedResource(idsKey, loadAssignments)

  return { context, semesterKey, setSemester: setSelectedSemester, roster, attendance, assignments }
}
