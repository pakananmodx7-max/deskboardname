import { useCallback, useMemo, useState } from 'react'

import { listSemesterOptions, resolveSemesterScope, type AnalyticsContext } from '@/features/classroom-analytics/analytics'
import type { Resource } from '@/features/classroom-analytics/resource'

import {
  browserStorage,
  readStoredSemester,
  resolveSemesterKey,
  writeStoredSemester,
  type SemesterPreference,
} from './semester-preference'

/**
 * The selected semester for one teacher (`ownerId`): seeded from that
 * teacher's own localStorage entry and their auth metadata (`remote`),
 * newest wins; options/scope are derived from the loaded context, so a
 * stored key that no longer exists falls back to the default. Selecting
 * writes only the preference (localStorage + `persistRemote`) — never
 * classroom, student, subject or academic-term data.
 */
export function useSemesterSelection(
  ownerId: string,
  context: Resource<AnalyticsContext>,
  remote: SemesterPreference | null,
  persistRemote: ((preference: SemesterPreference) => void) | null,
) {
  // The in-session choice, seeded from this teacher's own localStorage
  // entry; tagged with the owner so another account never inherits it.
  const [local, setLocal] = useState<{ ownerId: string; preference: SemesterPreference | null }>(() => ({
    ownerId,
    preference: readStoredSemester(browserStorage(), ownerId),
  }))
  const localPreference = local.ownerId === ownerId ? local.preference : readStoredSemester(browserStorage(), ownerId)

  const options = useMemo(() => (context.status === 'success' ? listSemesterOptions(context.data) : []), [context])
  const semesterKey = context.status === 'success' ? resolveSemesterKey(context.data, options, [localPreference, remote]) : null
  const scope = useMemo(
    () => (context.status === 'success' && semesterKey !== null ? resolveSemesterScope(context.data, semesterKey) : null),
    [context, semesterKey],
  )

  const setSemester = useCallback(
    (key: string) => {
      const preference = { key, updatedAt: Date.now() }
      setLocal({ ownerId, preference })
      writeStoredSemester(browserStorage(), ownerId, preference)
      persistRemote?.(preference)
    },
    [ownerId, persistRemote],
  )

  return useMemo(() => ({ options, semesterKey, scope, setSemester }), [options, semesterKey, scope, setSemester])
}
