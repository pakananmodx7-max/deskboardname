import { DEFAULT_MISSING_FILTERS, type MissingReportFilters, type SortKey, type StatusFilter } from './missing-report-model'

/**
 * The missing-assignment report's filters live in the URL, so they
 * survive the trip to the print preview and back (and a refresh). The
 * semester is NOT here — it is the shared header selection.
 */
const KEYS = { classroomId: 'mc', subjectId: 'ms', from: 'from', to: 'to', status: 'st', search: 'q', sort: 'sort' } as const

const STATUS_VALUES: StatusFilter[] = ['all', 'pending', 'overdue', 'no_due']
const SORT_VALUES: SortKey[] = ['total', 'overdue', 'number', 'name', 'classroom']
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export const MISSING_REPORT_PATH = '/teacher/reports'
export const MISSING_PRINT_PATH = '/teacher/reports/missing/print'

export function filtersFromParams(params: URLSearchParams): MissingReportFilters {
  const date = (key: string) => {
    const value = params.get(key)
    return value && ISO_DATE.test(value) ? value : null
  }
  const status = params.get(KEYS.status) as StatusFilter | null
  const sort = params.get(KEYS.sort) as SortKey | null
  return {
    classroomId: params.get(KEYS.classroomId) || null,
    subjectId: params.get(KEYS.subjectId) || null,
    from: date(KEYS.from),
    to: date(KEYS.to),
    status: status && STATUS_VALUES.includes(status) ? status : DEFAULT_MISSING_FILTERS.status,
    search: (params.get(KEYS.search) ?? '').slice(0, 100),
    sort: sort && SORT_VALUES.includes(sort) ? sort : DEFAULT_MISSING_FILTERS.sort,
  }
}

/** Writes the filters into `base` (other params, e.g. ?tab=, are kept). */
export function filtersToParams(filters: MissingReportFilters, base: URLSearchParams = new URLSearchParams()): URLSearchParams {
  const next = new URLSearchParams(base)
  const set = (key: string, value: string | null, fallback: string | null = null) => {
    if (value && value !== fallback) next.set(key, value)
    else next.delete(key)
  }
  set(KEYS.classroomId, filters.classroomId)
  set(KEYS.subjectId, filters.subjectId)
  set(KEYS.from, filters.from)
  set(KEYS.to, filters.to)
  set(KEYS.status, filters.status, DEFAULT_MISSING_FILTERS.status)
  set(KEYS.search, filters.search.trim() || null)
  set(KEYS.sort, filters.sort, DEFAULT_MISSING_FILTERS.sort)
  return next
}

export function printPreviewHref(filters: MissingReportFilters): string {
  const query = filtersToParams(filters).toString()
  return query ? `${MISSING_PRINT_PATH}?${query}` : MISSING_PRINT_PATH
}

export function backToReportHref(filters: MissingReportFilters): string {
  return `${MISSING_REPORT_PATH}?${filtersToParams(filters, new URLSearchParams({ tab: 'missing' })).toString()}`
}
