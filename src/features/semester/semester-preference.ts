import { ALL_SEMESTERS, pickDefaultSemester, type AnalyticsContext, type SemesterOption } from '@/features/classroom-analytics/analytics'

/**
 * The teacher's last selected semester — remembered per teacher, in two
 * places (no database migration needed):
 *   - localStorage, keyed by the teacher's user id (instant on refresh,
 *     never shared with another account on the same browser);
 *   - the teacher's own Supabase Auth user_metadata (follows them to
 *     another device / a later login).
 * Each entry carries `updatedAt`; the newest valid one wins. A stored key
 * that is not among the current options (e.g. the semester no longer
 * exists) is ignored and the default is used instead. Selecting a
 * semester is a read/filter choice only — it never writes any classroom,
 * student, subject or academic-term data.
 */

export const SEMESTER_METADATA_KEY = 'krunameclass_semester'

export interface SemesterPreference {
  key: string
  updatedAt: number
}

export function semesterStorageKey(ownerId: string): string {
  return `krunameclass:semester:${ownerId}`
}

export function parseSemesterPreference(raw: unknown): SemesterPreference | null {
  const value = typeof raw === 'string' ? safeJson(raw) : raw
  if (!value || typeof value !== 'object') return null
  const { key, updatedAt } = value as Record<string, unknown>
  if (typeof key !== 'string' || key.length > 200) return null
  return { key, updatedAt: typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? updatedAt : 0 }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

type ReadableStorage = Pick<Storage, 'getItem'>
type WritableStorage = Pick<Storage, 'setItem'>

export function readStoredSemester(storage: ReadableStorage | null, ownerId: string): SemesterPreference | null {
  if (!storage || !ownerId) return null
  try {
    return parseSemesterPreference(storage.getItem(semesterStorageKey(ownerId)))
  } catch {
    return null
  }
}

export function writeStoredSemester(storage: WritableStorage | null, ownerId: string, preference: SemesterPreference): void {
  if (!storage || !ownerId) return
  try {
    storage.setItem(semesterStorageKey(ownerId), JSON.stringify(preference))
  } catch {
    // Private mode / quota — the in-memory choice still applies.
  }
}

export function browserStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

/** Newest valid preference, else the data-derived default. */
export function resolveSemesterKey(
  context: AnalyticsContext,
  options: SemesterOption[],
  candidates: (SemesterPreference | null | undefined)[],
): string {
  const valid = new Set(options.map((o) => o.key))
  const best = candidates
    .filter((c): c is SemesterPreference => Boolean(c) && valid.has(c!.key))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
  return best?.key ?? pickDefaultSemester(context) ?? ALL_SEMESTERS
}
