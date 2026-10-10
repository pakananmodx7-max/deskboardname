import {
  DEFAULT_ATTENDANCE_FILTERS,
  type AttendanceReportFilters,
  type AttendanceSortKey,
  type AttendanceView,
  type BandFilter,
  type DatePreset,
  type SortDirection,
} from './attendance-report-model'

/**
 * The attendance report's filters live in the URL (prefixed "a…" so they
 * never clash with other report tabs), so they survive a refresh and the
 * trip to the print preview and back. The semester is the shared header
 * selection, not part of the URL.
 */
const VIEWS: AttendanceView[] = ['overview', 'classroom', 'subject', 'student']
const PRESETS: DatePreset[] = ['today', '7d', '30d', 'semester', 'custom']
const BANDS: BandFilter[] = ['all', 'excellent', 'good', 'attention', 'no_data', 'follow_up']
const SORTS: AttendanceSortKey[] = ['number', 'name', 'classroom', 'present', 'late', 'leave', 'absent', 'total', 'rate']
const ISO = /^\d{4}-\d{2}-\d{2}$/

export const ATTENDANCE_PRINT_PATH = '/teacher/reports/attendance/print'

function pick<T extends string>(value: string | null, allowed: T[], fallback: T): T {
  return value && (allowed as string[]).includes(value) ? (value as T) : fallback
}

export function attendanceFiltersFromParams(params: URLSearchParams): AttendanceReportFilters {
  const date = (key: string) => {
    const v = params.get(key)
    return v && ISO.test(v) ? v : null
  }
  const d = DEFAULT_ATTENDANCE_FILTERS
  return {
    view: pick(params.get('av'), VIEWS, d.view),
    classroomId: params.get('ac') || null,
    subjectId: params.get('as') || null,
    preset: pick(params.get('ap'), PRESETS, d.preset),
    from: date('afrom'),
    to: date('ato'),
    band: pick(params.get('ab'), BANDS, d.band),
    search: (params.get('aq') ?? '').slice(0, 100),
    sort: pick(params.get('asort'), SORTS, d.sort),
    direction: pick<SortDirection>(params.get('adir'), ['asc', 'desc'], d.direction),
    studentId: params.get('astu') || null,
  }
}

export function attendanceFiltersToParams(filters: AttendanceReportFilters, base: URLSearchParams = new URLSearchParams()): URLSearchParams {
  const next = new URLSearchParams(base)
  const d = DEFAULT_ATTENDANCE_FILTERS
  const set = (key: string, value: string | null, fallback: string | null = null) => {
    if (value && value !== fallback) next.set(key, value)
    else next.delete(key)
  }
  set('av', filters.view, d.view)
  set('ac', filters.classroomId)
  set('as', filters.subjectId)
  set('ap', filters.preset, d.preset)
  set('afrom', filters.preset === 'custom' ? filters.from : null)
  set('ato', filters.preset === 'custom' ? filters.to : null)
  set('ab', filters.band, d.band)
  set('aq', filters.search.trim() || null)
  set('asort', filters.sort, d.sort)
  set('adir', filters.direction, d.direction)
  set('astu', filters.studentId)
  return next
}

export function attendancePrintHref(filters: AttendanceReportFilters): string {
  const query = attendanceFiltersToParams(filters).toString()
  return query ? `${ATTENDANCE_PRINT_PATH}?${query}` : ATTENDANCE_PRINT_PATH
}

export function attendanceBackHref(filters: AttendanceReportFilters): string {
  return `/teacher/reports?${attendanceFiltersToParams(filters, new URLSearchParams({ tab: 'attendance' })).toString()}`
}
