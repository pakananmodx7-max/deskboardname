import { getSupabaseClient } from '@/lib/supabase'
import type { AttendanceRecord, AttendanceSession, AttendanceStatus, AttendanceSummary } from '@/types/attendance'

interface AttendanceSessionRow {
  id: string
  classroom_id: string
  subject_id: string | null
  attendance_date: string
  created_by: string | null
  created_at: string
  updated_at: string
}

interface AttendanceRecordRow {
  student_id: string
  status: AttendanceStatus
  note: string | null
}

function mapSession(row: AttendanceSessionRow): AttendanceSession {
  return {
    id: row.id,
    classroomId: row.classroom_id,
    subjectId: row.subject_id,
    attendanceDate: row.attendance_date,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export interface AttendanceForDate {
  session: AttendanceSession | null
  /** Saved records keyed by student_id for O(1) lookup while rendering the roster. */
  records: Record<string, AttendanceRecord>
}

/**
 * Looks up the homeroom (subject_id is null — see 0004_attendance.sql)
 * session for this classroom+date, plus every record saved on it. Returns
 * `session: null` and an empty records map when nothing has been saved
 * for that date yet — the UI is responsible for defaulting every student
 * to "present" itself (see buildDefaultRecords below) rather than this
 * service inventing rows that were never actually saved.
 */
export async function getAttendance(classroomId: string, attendanceDate: string): Promise<AttendanceForDate> {
  const supabase = getSupabaseClient()

  const { data: sessionRow, error: sessionError } = await supabase
    .from('attendance_sessions')
    .select('*')
    .eq('classroom_id', classroomId)
    .eq('attendance_date', attendanceDate)
    .is('subject_id', null)
    .maybeSingle()

  if (sessionError) throw sessionError
  if (!sessionRow) return { session: null, records: {} }

  const session = mapSession(sessionRow as AttendanceSessionRow)

  const { data: recordRows, error: recordsError } = await supabase
    .from('attendance_records')
    .select('student_id, status, note')
    .eq('attendance_session_id', session.id)

  if (recordsError) throw recordsError

  const records: Record<string, AttendanceRecord> = {}
  for (const row of recordRows as AttendanceRecordRow[]) {
    records[row.student_id] = { studentId: row.student_id, status: row.status, note: row.note }
  }

  return { session, records }
}

/**
 * Persists a full roll call in one atomic round trip via the
 * `save_attendance_session` RPC (see its comment in
 * supabase/migrations/0004_attendance.sql) instead of an
 * upsert-the-session-then-upsert-each-record client-side loop, which
 * could leave a session with some students saved and others silently
 * missing if a single record write failed partway through. Calling this
 * again for the same classroom+date updates the existing session/records
 * in place (upsert) rather than creating a duplicate — see the RPC's
 * ON CONFLICT clauses.
 */
export async function saveAttendance(
  classroomId: string,
  attendanceDate: string,
  records: AttendanceRecord[],
): Promise<AttendanceSession> {
  const supabase = getSupabaseClient()

  const { data, error } = await supabase.rpc('save_attendance_session', {
    p_classroom_id: classroomId,
    p_attendance_date: attendanceDate,
    p_records: records.map((record) => ({
      student_id: record.studentId,
      status: record.status,
      note: record.note,
    })),
  })

  if (error) throw error
  return mapSession(data as AttendanceSessionRow)
}

/**
 * Client-side default for a NEW (never-saved) session: every active
 * student defaults to "มา" (present), matching the demo page's behavior.
 * Pure and Supabase-free so it stays cheaply unit-testable — nothing here
 * writes anything; the teacher still has to press "บันทึกการเช็คชื่อ"
 * (saveAttendance) before any of this reaches the database.
 */
export function buildDefaultRecords(studentIds: string[]): Record<string, AttendanceRecord> {
  const records: Record<string, AttendanceRecord> = {}
  for (const studentId of studentIds) {
    records[studentId] = { studentId, status: 'present', note: null }
  }
  return records
}

/** Pure tally used to render the live summary card before/after saving. */
export function getAttendanceSummary(records: Record<string, AttendanceRecord>): AttendanceSummary {
  const summary: AttendanceSummary = { present: 0, late: 0, leave: 0, absent: 0, total: 0 }
  for (const record of Object.values(records)) {
    summary[record.status] += 1
    summary.total += 1
  }
  return summary
}
