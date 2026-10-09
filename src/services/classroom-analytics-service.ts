import { getSupabaseClient } from '@/lib/supabase'
import type {
  AnalyticsAssignmentData,
  AnalyticsAttendanceRecord,
  AnalyticsContext,
  AnalyticsRoster,
  AnalyticsStudent,
  AttendanceStatus,
  SubmissionStatusValue,
} from '@/features/classroom-analytics/analytics'

/**
 * Real-data loaders for the Classroom Analytics Dashboard. Every query is
 * scoped by the existing RLS policies (a teacher only ever sees rows of
 * classrooms they own) and by the selected semester's classroom ids. No
 * per-student or per-session requests: each loader is a fixed number of
 * batched queries — ids are chunked so a request URL never grows with the
 * semester, and results are paged past PostgREST's row limit.
 */

const PAGE_SIZE = 1000
const ID_CHUNK = 100
/** Hard stop so a runaway result can never loop forever. */
const MAX_ROWS = 200_000
export const ANALYTICS_REQUEST_TIMEOUT_MS = 30_000

export class AnalyticsTimeoutError extends Error {
  constructor() {
    super('โหลดข้อมูลนานเกินไป กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่')
    this.name = 'AnalyticsTimeoutError'
  }
}

/** Rejects after `ms` so a hung request can never leave a section
 * loading forever (the request itself is simply ignored afterwards). */
export function withTimeout<T>(promise: Promise<T>, ms: number = ANALYTICS_REQUEST_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AnalyticsTimeoutError()), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export function chunk<T>(items: T[], size: number = ID_CHUNK): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

type PageResult<T> = PromiseLike<{ data: T[] | null; error: unknown }>

/** Reads every page of one query (`.range(from, to)`), sequentially. */
export async function fetchAllPages<T>(page: (from: number, to: number) => PageResult<T>, pageSize: number = PAGE_SIZE): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1)
    if (error) throw error
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < pageSize) return rows
    if (rows.length >= MAX_ROWS) throw new Error('ข้อมูลมีจำนวนมากเกินกว่าที่แดชบอร์ดแสดงได้ กรุณาเลือกภาคเรียนให้แคบลง')
  }
}

/** Runs the same paged query for every id chunk, in parallel. */
async function fetchByIdChunks<T>(ids: string[], page: (idChunk: string[], from: number, to: number) => PageResult<T>): Promise<T[]> {
  if (ids.length === 0) return []
  const results = await Promise.all(chunk(ids).map((idChunk) => fetchAllPages<T>((from, to) => page(idChunk, from, to))))
  return results.flat()
}

// ==================================================
// Context: classrooms, subjects, links
// ==================================================

export async function getAnalyticsContext(): Promise<AnalyticsContext> {
  const supabase = getSupabaseClient()
  const [classrooms, subjects, links] = await withTimeout(
    Promise.all([
      fetchAllPages<{ id: string; name: string; academic_year: string | null; semester: string | null; is_active: boolean }>((from, to) =>
        supabase.from('classrooms').select('id, name, academic_year, semester, is_active').order('id').range(from, to),
      ),
      fetchAllPages<{ id: string; name: string; academic_year: string | null; semester: string | null }>((from, to) =>
        supabase.from('subjects').select('id, name, academic_year, semester').order('id').range(from, to),
      ),
      fetchAllPages<{ subject_id: string; classroom_id: string }>((from, to) =>
        supabase.from('subject_classrooms').select('subject_id, classroom_id').order('subject_id').order('classroom_id').range(from, to),
      ),
    ]),
  )
  return {
    classrooms: classrooms.map((c) => ({ id: c.id, name: c.name, academicYear: c.academic_year, semester: c.semester, isActive: c.is_active })),
    subjects: subjects.map((s) => ({ id: s.id, name: s.name, academicYear: s.academic_year, semester: s.semester })),
    links: links.map((l) => ({ subjectId: l.subject_id, classroomId: l.classroom_id })),
  }
}

// ==================================================
// Roster
// ==================================================

interface RosterRow {
  classroom_id: string
  student_id: string
  students: { id: string; student_code: string | null; number: number | null; first_name: string; last_name: string; status: 'active' | 'inactive' } | null
}

export async function getAnalyticsRoster(classroomIds: string[]): Promise<AnalyticsRoster> {
  const supabase = getSupabaseClient()
  const rows = await withTimeout(
    fetchByIdChunks<RosterRow>(classroomIds, (ids, from, to) =>
      supabase
        .from('classroom_students')
        .select('classroom_id, student_id, students(id, student_code, number, first_name, last_name, status)')
        .in('classroom_id', ids)
        .order('id')
        .range(from, to) as unknown as PageResult<RosterRow>,
    ),
  )
  const students = new Map<string, AnalyticsStudent>()
  for (const row of rows) {
    if (!row.students || students.has(row.students.id)) continue
    students.set(row.students.id, {
      id: row.students.id,
      firstName: row.students.first_name,
      lastName: row.students.last_name,
      studentCode: row.students.student_code,
      number: row.students.number,
      status: row.students.status,
    })
  }
  return {
    memberships: rows.map((r) => ({ studentId: r.student_id, classroomId: r.classroom_id })),
    students: [...students.values()],
  }
}

// ==================================================
// Attendance records (with their session)
// ==================================================

interface AttendanceRow {
  attendance_session_id: string
  student_id: string
  status: AttendanceStatus
  attendance_sessions: { classroom_id: string; subject_id: string | null; attendance_date: string } | null
}

/** Every record of every roll call in the given classrooms — one embedded
 * query (records !inner sessions), paged; never one request per session. */
export async function getAnalyticsAttendance(classroomIds: string[]): Promise<AnalyticsAttendanceRecord[]> {
  const supabase = getSupabaseClient()
  const rows = await withTimeout(
    fetchByIdChunks<AttendanceRow>(classroomIds, (ids, from, to) =>
      supabase
        .from('attendance_records')
        .select('attendance_session_id, student_id, status, attendance_sessions!inner(classroom_id, subject_id, attendance_date)')
        .in('attendance_sessions.classroom_id', ids)
        .order('id')
        .range(from, to) as unknown as PageResult<AttendanceRow>,
    ),
  )
  const records: AnalyticsAttendanceRecord[] = []
  for (const row of rows) {
    const session = row.attendance_sessions
    if (!session) continue
    records.push({
      sessionId: row.attendance_session_id,
      classroomId: session.classroom_id,
      subjectId: session.subject_id,
      date: session.attendance_date,
      studentId: row.student_id,
      status: row.status,
    })
  }
  return records
}

// ==================================================
// Assignments + submissions
// ==================================================

export async function getAnalyticsAssignments(classroomIds: string[]): Promise<AnalyticsAssignmentData> {
  const supabase = getSupabaseClient()
  return withTimeout(
    (async () => {
      const assignmentRows = await fetchByIdChunks<{ id: string; classroom_id: string; subject_id: string; title: string; due_date: string | null }>(
        classroomIds,
        (ids, from, to) =>
          supabase
            .from('assignments')
            .select('id, classroom_id, subject_id, title, due_date')
            .eq('is_archived', false)
            .in('classroom_id', ids)
            .order('id')
            .range(from, to),
      )
      const submissionRows = await fetchByIdChunks<{ assignment_id: string; student_id: string; status: SubmissionStatusValue }>(
        assignmentRows.map((a) => a.id),
        (ids, from, to) =>
          supabase.from('assignment_submissions').select('assignment_id, student_id, status').in('assignment_id', ids).order('id').range(from, to),
      )
      return {
        assignments: assignmentRows.map((a) => ({ id: a.id, classroomId: a.classroom_id, subjectId: a.subject_id, title: a.title, dueDate: a.due_date })),
        submissions: submissionRows.map((s) => ({ assignmentId: s.assignment_id, studentId: s.student_id, status: s.status })),
      }
    })(),
  )
}
