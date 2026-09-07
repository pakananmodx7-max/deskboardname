import { DEMO_STUDENTS } from '@/demo/students'
import type { DemoAttendanceStatus } from '@/demo/types'

export const ATTENDANCE_STATUS_LABEL: Record<DemoAttendanceStatus, string> = {
  present: 'มา',
  late: 'สาย',
  leave: 'ลา',
  absent: 'ขาด',
}

export const ATTENDANCE_STATUS_ORDER: DemoAttendanceStatus[] = ['present', 'late', 'leave', 'absent']

/**
 * Seed for "today" — mostly present, with a handful of realistic
 * exceptions so the Dashboard shows a believable snapshot immediately
 * rather than a uniform 38/38. The Attendance page edits this exact
 * shared state, so changes there are reflected on the Dashboard live.
 */
export function buildInitialAttendance(): Record<string, DemoAttendanceStatus> {
  const absentIds = new Set([DEMO_STUDENTS[0].id, DEMO_STUDENTS[6].id])
  const lateIds = new Set([DEMO_STUDENTS[1].id])
  const leaveIds = new Set([DEMO_STUDENTS[27].id])

  const attendance: Record<string, DemoAttendanceStatus> = {}
  for (const student of DEMO_STUDENTS) {
    if (absentIds.has(student.id)) attendance[student.id] = 'absent'
    else if (lateIds.has(student.id)) attendance[student.id] = 'late'
    else if (leaveIds.has(student.id)) attendance[student.id] = 'leave'
    else attendance[student.id] = 'present'
  }
  return attendance
}
