export type AttendanceStatus = 'present' | 'late' | 'leave' | 'absent'

export interface AttendanceSummary {
  present: number
  late: number
  leave: number
  absent: number
  total: number
}

/** One student's saved (or not-yet-saved, client-side default) status for a session. */
export interface AttendanceRecord {
  studentId: string
  status: AttendanceStatus
  note: string | null
}

/** A homeroom roll call for one classroom on one date. subjectId is always
 * null in this phase — see supabase/migrations/0004_attendance.sql for why
 * the column exists and is nullable. */
export interface AttendanceSession {
  id: string
  classroomId: string
  subjectId: string | null
  attendanceDate: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
}
