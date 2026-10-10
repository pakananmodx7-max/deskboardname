import { Navigate, useLocation } from 'react-router-dom'

import { resolveAttendanceRedirect } from './attendance-redirect'

/**
 * /teacher/attendance (and anything under it) — the standalone attendance
 * page was removed; attendance is taken only in each subject's เช็คชื่อ tab
 * (รายวิชา → subject → classroom → เช็คชื่อ), which runs on the same
 * attendance-service.ts / save_attendance_session data layer. This route
 * only redirects, so old bookmarks keep working.
 */
export function AttendanceRedirectPage() {
  const { search } = useLocation()
  return <Navigate to={resolveAttendanceRedirect(search)} replace />
}
