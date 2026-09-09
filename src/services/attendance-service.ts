import { getSupabaseClient } from '@/lib/supabase'
import type { AttendanceRecord, AttendanceSession, AttendanceStatus, AttendanceSummary } from '@/types/attendance'

interface AttendanceSessionRow {
  id: string
  classroom_id: string
  subject_id: string | null
  period_number: number | null
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
    periodNumber: row.period_number,
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
 * Looks up the session for this classroom+date, plus every record saved
 * on it. `subjectId`/`periodNumber` default to null — the classroom-level
 * homeroom lookup from Phase 5, unchanged. Pass a subjectId (from the
 * subject's เช็คชื่อ tab, see 0005_subject_attendance.sql) to look up that
 * subject's session instead, optionally scoped to one คาบ via
 * periodNumber. Returns `session: null` and an empty records map when
 * nothing has been saved for that exact combination yet — the UI is
 * responsible for defaulting every student to "present" itself (see
 * buildDefaultRecords below) rather than this service inventing rows that
 * were never actually saved.
 *
 * Deliberately does NOT use `.maybeSingle()` for the session lookup.
 * `.maybeSingle()` tolerates zero matching rows but THROWS if more than
 * one row matches — correct only as long as
 * attendance_sessions_classroom_date_no_subject_uidx (and its two
 * subject-scoped siblings, 0004/0005_*.sql) holds perfectly for every
 * row that has ever existed in the table, an invariant this function has
 * no way to verify at read time. If it is ever violated for any reason
 * (a legacy row predating the index, a migration that did not fully
 * apply — see docs/DATABASE.md's account-linking RPC-permissions
 * incident for a real prior example of exactly that class of gap), the
 * whole roll call used to hard-fail with an opaque, non-Thai
 * PostgREST "multiple rows returned" error instead of just... showing
 * the roster. `.order(...).limit(1)` never throws for "too many rows":
 * it deterministically picks the most recently updated matching
 * session, which degrades gracefully instead of taking down the entire
 * Attendance page over a single stray row.
 */
export async function getAttendance(
  classroomId: string,
  attendanceDate: string,
  subjectId: string | null = null,
  periodNumber: number | null = null,
): Promise<AttendanceForDate> {
  const supabase = getSupabaseClient()

  let query = supabase
    .from('attendance_sessions')
    .select('*')
    .eq('classroom_id', classroomId)
    .eq('attendance_date', attendanceDate)

  query = subjectId === null ? query.is('subject_id', null) : query.eq('subject_id', subjectId)
  query = periodNumber === null ? query.is('period_number', null) : query.eq('period_number', periodNumber)

  const { data: sessionRows, error: sessionError } = await query.order('updated_at', { ascending: false }).limit(1)

  if (sessionError) throw sessionError
  const sessionRow = (sessionRows as AttendanceSessionRow[] | null)?.[0] ?? null
  if (!sessionRow) return { session: null, records: {} }

  const session = mapSession(sessionRow)

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
 * supabase/migrations/0004_attendance.sql and the p_subject_id/
 * p_period_number extension in 0005_subject_attendance.sql) instead of an
 * upsert-the-session-then-upsert-each-record client-side loop, which
 * could leave a session with some students saved and others silently
 * missing if a single record write failed partway through. Calling this
 * again for the same classroom+date(+subject+period) updates the existing
 * session/records in place (upsert) rather than creating a duplicate —
 * see the RPC's ON CONFLICT clauses.
 *
 * `subjectId`/`periodNumber` default to null — the standalone classroom
 * Attendance page never passes them, so it keeps writing exactly the same
 * homeroom rows it always has. The subject เช็คชื่อ tab passes its
 * subject.id (and, optionally, a คาบ number) to scope the session to that
 * subject instead.
 */
export async function saveAttendance(
  classroomId: string,
  attendanceDate: string,
  records: AttendanceRecord[],
  subjectId: string | null = null,
  periodNumber: number | null = null,
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
    p_subject_id: subjectId,
    p_period_number: periodNumber,
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

/**
 * The records shown/edited for a roster, given the roster's active
 * student ids and a (possibly failed) attendance-session lookup. Saved
 * statuses from `attendance.records` win over the "มา" default when the
 * lookup succeeded; when it's `null` (the caller's getAttendance() call
 * failed, or simply hasn't resolved yet), every active student still
 * gets a default "มา" record rather than none at all.
 *
 * This is the fix for the "classroom has 31 students but Attendance
 * shows 0" production bug: the roster (from getStudentsByClassroom) and
 * the attendance-session lookup (getAttendance) are two independent
 * network calls, and the roster is the source of truth — it must never
 * be blanked out just because the OTHER call had a problem. Callers
 * should fetch the roster and the attendance session as two independent
 * requests (not a combined Promise.all that fails both on either one
 * failing) and pass `null` here for a failed/pending attendance lookup,
 * exactly like "no session saved yet" — the teacher can still see and
 * mark the roster either way.
 */
export function buildRecordsForRoster(
  activeStudentIds: string[],
  attendance: AttendanceForDate | null,
): Record<string, AttendanceRecord> {
  return { ...buildDefaultRecords(activeStudentIds), ...(attendance?.records ?? {}) }
}

export interface ParsedPeriodNumber {
  /** null means "no specific period" (the homeroom-style, valid default). */
  value: number | null
  /** true only for non-empty input that isn't a positive integer. */
  invalid: boolean
}

/**
 * Parses the subject เช็คชื่อ tab's optional "คาบ" text field into what
 * `saveAttendance`/`getAttendance` expect. Mirrors the RPC's own
 * `p_period_number is null or p_period_number > 0` acceptance rule (see
 * 0005_subject_attendance.sql) on the client side, so an obviously-bad
 * value never reaches Supabase at all. Empty/whitespace-only input is
 * valid and means null, not an error.
 */
export function parsePeriodNumber(input: string): ParsedPeriodNumber {
  const trimmed = input.trim()
  if (trimmed === '') return { value: null, invalid: false }

  const value = Number(trimmed)
  const invalid = !Number.isInteger(value) || value <= 0
  return { value: invalid ? null : value, invalid }
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

/**
 * The roster shown/saved for any real attendance session — shared by the
 * standalone classroom Attendance page and every subject's เช็คชื่อ tab:
 * every currently-active classroom member, PLUS any member who has since
 * been archived (status = 'inactive') but already has a saved record in
 * `records` for this exact session. This way reopening a past session
 * never silently drops a student's attendance just because they were
 * archived afterward, while a brand-new session never invents a "มา"
 * default for a student no longer active. Pure — takes the already-loaded
 * classroom roster and the already-loaded records map, no Supabase call.
 */
export function deriveAttendanceRoster<T extends { id: string; status: 'active' | 'inactive' }>(
  students: T[],
  records: Record<string, AttendanceRecord>,
): T[] {
  return students.filter((student) => student.status === 'active' || records[student.id] !== undefined)
}
