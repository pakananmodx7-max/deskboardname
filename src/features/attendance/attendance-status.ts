import type { AttendanceStatus } from '@/types/attendance'

/**
 * Real-mode equivalent of demo/attendance.ts's label/order constants.
 * Kept as its own small module (rather than importing the demo one)
 * so the real Attendance page never depends on `src/demo/*` — matching
 * how every other real/demo pair in this app (classroom-management vs.
 * classroom-management-demo, subjects-real vs. demo-subjects) keeps its
 * own copy of anything this trivial instead of cross-importing.
 */
export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: 'มา',
  late: 'สาย',
  leave: 'ลา',
  absent: 'ขาด',
}

export const ATTENDANCE_STATUS_ORDER: AttendanceStatus[] = ['present', 'late', 'leave', 'absent']

export const ATTENDANCE_STATUS_BUTTON_STYLE: Record<AttendanceStatus, string> = {
  present: 'data-[active=true]:bg-success data-[active=true]:text-success-foreground',
  late: 'data-[active=true]:bg-warning data-[active=true]:text-warning-foreground',
  leave: 'data-[active=true]:bg-primary data-[active=true]:text-primary-foreground',
  absent: 'data-[active=true]:bg-destructive data-[active=true]:text-destructive-foreground',
}

export const ATTENDANCE_SUMMARY_DOT_STYLE: Record<AttendanceStatus, string> = {
  present: 'bg-success',
  late: 'bg-warning',
  leave: 'bg-primary',
  absent: 'bg-destructive',
}
