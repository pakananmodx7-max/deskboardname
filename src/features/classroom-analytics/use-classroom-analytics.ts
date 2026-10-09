import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { toFriendlyErrorMessage } from '@/lib/errors'
import {
  getAnalyticsAssignments,
  getAnalyticsAttendance,
  getAnalyticsContext,
  getAnalyticsRoster,
} from '@/services/classroom-analytics-service'

import {
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
export function useKeyedResource<T>(
  key: string | null,
  load: (key: string) => Promise<T>,
): { resource: Resource<T>; retry: () => void; peek: (key: string) => Resource<T> | undefined } {
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

  const peek = useCallback((other: string) => results[other], [results])

  return { resource: key === null ? LOADING : (results[key] ?? LOADING), retry, peek }
}

/**
 * Roster, attendance and assignments for the selected semester's
 * classrooms (real mode) — each loaded and cached independently, keyed by
 * the classroom ids, so a response for a previously selected semester can
 * never be shown for the current one.
 */
export function useSemesterAnalyticsData(classroomIds: ReadonlySet<string> | null, loaders: ClassroomAnalyticsLoaders = supabaseAnalyticsLoaders) {
  const loadRoster = useCallback((key: string) => loaders.roster(idsFromKey(key)), [loaders])
  const loadAttendance = useCallback((key: string) => loaders.attendance(idsFromKey(key)), [loaders])
  const loadAssignments = useCallback((key: string) => loaders.assignments(idsFromKey(key)), [loaders])
  const idsKey = useMemo(() => (classroomIds ? classroomIdsKey(classroomIds) : null), [classroomIds])
  const roster = useKeyedResource(idsKey, loadRoster)
  const attendance = useKeyedResource(idsKey, loadAttendance)
  const assignments = useKeyedResource(idsKey, loadAssignments)
  /** Reload everything for the current semester (e.g. after a classroom
   * was created/edited/archived). */
  const reloadAll = useCallback(() => {
    roster.retry()
    attendance.retry()
    assignments.retry()
  }, [roster, attendance, assignments])
  return { roster, attendance, assignments, reloadAll }
}
