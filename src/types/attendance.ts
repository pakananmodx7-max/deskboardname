export type AttendanceStatus = 'present' | 'late' | 'leave' | 'absent'

export interface AttendanceSummary {
  present: number
  late: number
  leave: number
  absent: number
  total: number
}
