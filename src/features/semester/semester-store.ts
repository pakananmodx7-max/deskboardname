import { createContext, useContext } from 'react'

import type { AnalyticsContext, SemesterOption, SemesterScope } from '@/features/classroom-analytics/analytics'
import type { Resource } from '@/features/classroom-analytics/resource'

/**
 * One semester choice for the whole teacher area — the header selector
 * and every dashboard widget read the same value. The classroom/subject
 * context the options are derived from is loaded once here and shared
 * (no duplicate request per widget).
 */
export interface SemesterContextValue {
  context: Resource<AnalyticsContext>
  retryContext: () => void
  /** Reload classrooms/subjects (after create/edit/archive) while keeping
   * the current data on screen until the new data arrives. */
  refreshContext: () => void
  options: SemesterOption[]
  semesterKey: string | null
  scope: SemesterScope | null
  setSemester: (key: string) => void
}

export const SemesterContext = createContext<SemesterContextValue | null>(null)

export function useSemester(): SemesterContextValue {
  const value = useContext(SemesterContext)
  if (!value) throw new Error('useSemester must be used inside <SemesterProvider>')
  return value
}

/** Same as useSemester, but null outside a provider (e.g. student pages). */
export function useOptionalSemester(): SemesterContextValue | null {
  return useContext(SemesterContext)
}

