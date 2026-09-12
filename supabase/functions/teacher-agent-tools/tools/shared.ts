// deno-lint-ignore-file no-explicit-any
import { NotFoundError } from '../../_shared/agent-context.ts'

/** `${first} ${last}` — or `${first} ${last} (${nickname})` when a
 * nickname is on file — the exact "student display name" shape every
 * teacher-facing page in this app already uses. Never exposes email/
 * phone/student_code — those are PII this tool layer has no reason to
 * hand an agent (see the ticket's "never expose unnecessary PII"). */
export function studentDisplayName(row: { first_name: string; last_name: string; nickname?: string | null }): string {
  const base = `${row.first_name} ${row.last_name}`
  return row.nickname ? `${base} (${row.nickname})` : base
}

/** Fetches one classroom by id through the CALLER's own RLS-scoped
 * client (classrooms_select_own) — a null result means "does not exist
 * OR you don't own it" and is surfaced as a 404, never distinguished
 * further (see NotFoundError's own doc comment). */
export async function requireOwnedClassroom(client: any, classroomId: string) {
  const { data, error } = await client
    .from('classrooms')
    .select('id, name, grade_level, section, is_active')
    .eq('id', classroomId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new NotFoundError('ไม่พบห้องเรียนนี้ หรือคุณไม่มีสิทธิ์เข้าถึง')
  return data as { id: string; name: string; grade_level: string | null; section: string | null; is_active: boolean }
}

export async function requireOwnedSubject(client: any, subjectId: string) {
  const { data, error } = await client.from('subjects').select('id, name').eq('id', subjectId).maybeSingle()
  if (error) throw error
  if (!data) throw new NotFoundError('ไม่พบรายวิชานี้ หรือคุณไม่มีสิทธิ์เข้าถึง')
  return data as { id: string; name: string }
}

/** Same "exists AND you own it" shape as requireOwnedClassroom/Subject,
 * for an assignment (assignments_select_own). Returns the columns every
 * tool that starts from an assignmentId needs. */
export async function requireOwnedAssignment(client: any, assignmentId: string) {
  const { data, error } = await client
    .from('assignments')
    .select('id, subject_id, classroom_id, title, description, max_score, due_date, is_archived')
    .eq('id', assignmentId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new NotFoundError('ไม่พบงานนี้ หรือคุณไม่มีสิทธิ์เข้าถึง')
  return data as {
    id: string
    subject_id: string
    classroom_id: string
    title: string
    description: string | null
    max_score: number
    due_date: string | null
    is_archived: boolean
  }
}

export interface StudentRow {
  id: string
  student_code: string | null
  number: number | null
  first_name: string
  last_name: string
  nickname: string | null
}

/** The classroom's full roster (student rows) via classroom_students ->
 * students, both RLS-scoped to the caller. Ordered by class `number`
 * (nulls last) then first name — matches the Students tab's own
 * ordering so an agent's output reads the same way a teacher's does. */
export async function getClassroomRoster(client: any, classroomId: string): Promise<StudentRow[]> {
  const { data, error } = await client
    .from('classroom_students')
    .select('students(id, student_code, number, first_name, last_name, nickname)')
    .eq('classroom_id', classroomId)
  if (error) throw error
  const rows = ((data ?? []) as any[]).map((row) => row.students).filter((s): s is StudentRow => Boolean(s))
  rows.sort((a, b) => {
    if (a.number !== null && b.number !== null) return a.number - b.number
    if (a.number !== null) return -1
    if (b.number !== null) return 1
    return a.first_name.localeCompare(b.first_name, 'th')
  })
  return rows
}

/** Every assignment_submissions row that counts as "turned in" for
 * completion-rate purposes. Kept as one constant so every tool's
 * definition of "submitted" (used for the get_missing_submissions
 * exclusion set, completion summaries, etc.) stays identical. */
export const SUBMITTED_STATUSES = ['submitted', 'late'] as const
