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

/** A roll call for one classroom on one date — either classroom-level
 * homeroom (subjectId/periodNumber both null) or scoped to a subject and
 * optionally a คาบ (period). See
 * supabase/migrations/0004_attendance.sql and 0005_subject_attendance.sql
 * for why subjectId/periodNumber are nullable. */
export interface AttendanceSession {
  id: string
  classroomId: string
  subjectId: string | null
  periodNumber: number | null
  attendanceDate: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
}
