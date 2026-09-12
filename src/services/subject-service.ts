import { getSupabaseClient } from '@/lib/supabase'
import { getAssignmentResources, removeResourceStorageObjects } from '@/services/assignment-resource-service'
import { getLessonResources, getLessonsForSubject, removeLessonResourceStorageObjects } from '@/services/lesson-service'
import { getStudentsByClassroom, mapStudent, type StudentRow } from '@/services/student-service'
import {
  getSubmissionResourceStoragePathsForAssignment,
  removeSubmissionResourceStorageObjects,
} from '@/services/submission-service'
import type {
  CreateSubjectInput,
  Subject,
  SubjectClassroom,
  SubjectClassroomWithCount,
  SubjectStudentView,
  UpdateSubjectInput,
} from '@/types/subject'

interface SubjectRow {
  id: string
  teacher_id: string
  name: string
  subject_code: string | null
  description: string | null
  academic_year: string | null
  semester: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

interface SubjectClassroomRow {
  id: string
  subject_id: string
  classroom_id: string
  created_at: string
  classrooms: { name: string } | null
}

function mapSubject(row: SubjectRow): Subject {
  return {
    id: row.id,
    teacherId: row.teacher_id,
    name: row.name,
    subjectCode: row.subject_code,
    description: row.description,
    academicYear: row.academic_year,
    semester: row.semester,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapSubjectClassroom(row: SubjectClassroomRow): SubjectClassroom {
  return {
    id: row.id,
    subjectId: row.subject_id,
    classroomId: row.classroom_id,
    classroomName: row.classrooms?.name ?? null,
    createdAt: row.created_at,
  }
}

export async function getSubjects(): Promise<Subject[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('subjects')
    .select('*')
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data as SubjectRow[]).map(mapSubject)
}

export async function getSubjectById(subjectId: string): Promise<Subject | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.from('subjects').select('*').eq('id', subjectId).maybeSingle()

  if (error) throw error
  return data ? mapSubject(data as SubjectRow) : null
}

/**
 * Creates a subject and links every selected classroom to it as a single
 * atomic operation via the `create_subject_with_classrooms` database
 * function — see that function's comment in
 * supabase/migrations/0002_subjects_topics.sql. This avoids the
 * half-created-subject risk of inserting the subject and then linking
 * classrooms as separate client-side statements, where a failure on any
 * one link (e.g. a classroom_id the caller doesn't own) would otherwise
 * leave an already-committed subject with zero or a partial set of
 * classrooms behind.
 */
export async function createSubject(input: CreateSubjectInput): Promise<Subject> {
  const supabase = getSupabaseClient()

  const { data, error } = await supabase.rpc('create_subject_with_classrooms', {
    p_name: input.name,
    p_classroom_ids: input.classroomIds,
    p_subject_code: input.subjectCode ?? null,
    p_description: input.description ?? null,
    p_academic_year: input.academicYear ?? null,
    p_semester: input.semester ?? null,
  })

  if (error) throw error
  return mapSubject(data as SubjectRow)
}

export async function updateSubject(subjectId: string, input: UpdateSubjectInput): Promise<Subject> {
  const supabase = getSupabaseClient()

  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.subjectCode !== undefined) patch.subject_code = input.subjectCode
  if (input.description !== undefined) patch.description = input.description
  if (input.academicYear !== undefined) patch.academic_year = input.academicYear
  if (input.semester !== undefined) patch.semester = input.semester

  const { data, error } = await supabase
    .from('subjects')
    .update(patch)
    .eq('id', subjectId)
    .select('*')
    .single()

  if (error) throw error
  return mapSubject(data as SubjectRow)
}

/**
 * Subjects are never hard-deleted through the app (there is no delete RLS
 * policy for them — see 0002_subjects_topics.sql) — archiving just flips
 * `is_active` to false via a normal update, keeping topics and links
 * intact for history.
 */
export async function archiveSubject(subjectId: string): Promise<Subject> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('subjects')
    .update({ is_active: false })
    .eq('id', subjectId)
    .select('*')
    .single()

  if (error) throw error
  return mapSubject(data as SubjectRow)
}

/**
 * How many attendance_sessions rows (เช็คชื่อ) are recorded for this
 * subject, across every classroom it's linked to — used by the subjects
 * page to show the stronger "attendance history will also be deleted"
 * confirmation copy BEFORE deleteSubjectPermanently is ever called. A
 * head-only count: never fetches the rows themselves.
 */
export async function countSubjectAttendanceSessions(subjectId: string): Promise<number> {
  const supabase = getSupabaseClient()
  const { count, error } = await supabase
    .from('attendance_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('subject_id', subjectId)

  if (error) throw error
  return count ?? 0
}

/**
 * Permanently removes a subject AND every record that depends
 * specifically on it, INCLUDING the subject's own attendance history —
 * via 0022's delete_subject_permanently RPC (ownership-checked at the
 * database, SECURITY DEFINER, one transaction):
 *   1. attendance_sessions where subject_id = this subject
 *      (-> attendance_records cascade, 0004). Homeroom sessions
 *      (subject_id null) and every other subject's sessions — even for
 *      the same classroom — are never matched. Students rows are never
 *      deleted (attendance_records.student_id is RESTRICT and nothing
 *      deletes students).
 *   2. the subjects row, cascading exactly as under 0021:
 *      subject_classrooms (LINK rows only — classrooms are never
 *      deleted), topics, lessons (-> lesson_resources), assignments
 *      (-> assignment_resources, -> assignment_submissions
 *      -> assignment_submission_resources).
 * The RPC is atomic: if the subjects delete fails, the attendance delete
 * rolls back with it — "attendance gone but subject still there" can
 * never happen. attendance_sessions.subject_id's RESTRICT FK is
 * deliberately left in place (see 0022's own audit comment) so this
 * RPC remains the ONLY path that can remove attendance.
 *
 * Also removes every Storage object the subject's rows referenced across
 * all three buckets (lesson-files, assignment-files, submission-files) —
 * Storage is never covered by an FK cascade. A 'link' resource
 * (including any Google Drive reference) is only ever a URL stored in
 * our own database; this function removes that reference and NEVER
 * calls out to Google Drive or any external provider to delete the
 * teacher's original file. Never touches another subject's data, student
 * accounts, the teacher's own profile, or any classroom's row — every
 * query below is explicitly scoped to THIS subjectId (transitively,
 * through this subject's own lessons/assignments) only.
 *
 * ORDER: an RLS-checked ownership read comes first, so a caller who does
 * not own the subject is refused before any Storage object is touched
 * (the RPC re-checks ownership itself — this pre-check is UX/ordering,
 * not the authorization boundary). Storage cleanup then happens entirely
 * BEFORE the RPC, same rule as deleteAssignmentPermanently /
 * deleteLessonPermanently — submission-files' delete policy is
 * row-dependent (teacher_owns_submission), so it must run while the
 * assignment_submissions rows it inspects still exist.
 */
export async function deleteSubjectPermanently(subjectId: string): Promise<void> {
  const supabase = getSupabaseClient()

  const { data: owned, error: ownedError } = await supabase
    .from('subjects')
    .select('id')
    .eq('id', subjectId)
    .maybeSingle()
  if (ownedError) throw ownedError
  if (!owned) {
    throw new Error('ไม่สามารถลบรายวิชานี้ได้ — คุณอาจไม่มีสิทธิ์จัดการรายวิชานี้')
  }

  const lessons = await getLessonsForSubject(subjectId)
  for (const lesson of lessons) {
    const resources = await getLessonResources(lesson.id)
    await removeLessonResourceStorageObjects(resources)
  }

  const { data: assignmentRows, error: assignmentsError } = await supabase
    .from('assignments')
    .select('id')
    .eq('subject_id', subjectId)
  if (assignmentsError) throw assignmentsError

  for (const { id: assignmentId } of assignmentRows as { id: string }[]) {
    const resources = await getAssignmentResources(assignmentId)
    const submissionStoragePaths = await getSubmissionResourceStoragePathsForAssignment(assignmentId)
    await removeResourceStorageObjects(resources)
    await removeSubmissionResourceStorageObjects(submissionStoragePaths)
  }

  const { error } = await supabase.rpc('delete_subject_permanently', { p_subject_id: subjectId })
  if (error) throw error
}

export async function linkClassroomToSubject(subjectId: string, classroomId: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('subject_classrooms')
    .insert({ subject_id: subjectId, classroom_id: classroomId })

  if (error) throw error
}

export async function unlinkClassroomFromSubject(subjectId: string, classroomId: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('subject_classrooms')
    .delete()
    .eq('subject_id', subjectId)
    .eq('classroom_id', classroomId)

  if (error) throw error
}

export async function getSubjectClassrooms(subjectId: string): Promise<SubjectClassroom[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('subject_classrooms')
    .select('id, subject_id, classroom_id, created_at, classrooms(name)')
    .eq('subject_id', subjectId)

  if (error) throw error
  return (data as unknown as SubjectClassroomRow[]).map(mapSubjectClassroom)
}

/**
 * Same as getSubjectClassrooms, plus each link's current member count —
 * used by the subject root page's "choose which classroom" screen (one
 * card per linked classroom, e.g. "ม.5/1 · 31 คน") and by the classroom
 * link/unlink editor. Counts are read via getStudentsByClassroom
 * (student-service.ts) per linked classroom rather than a stored/derived
 * subject-level number, so they're always exactly what that classroom's
 * own Students tab would show — no separate count to fall out of sync.
 */
export async function getSubjectClassroomsWithCounts(subjectId: string): Promise<SubjectClassroomWithCount[]> {
  const links = await getSubjectClassrooms(subjectId)
  const counts = await Promise.all(links.map((link) => getStudentsByClassroom(link.classroomId)))
  return links.map((link, i) => ({ ...link, studentCount: counts[i].length }))
}

/**
 * Whether this subject has ever recorded attendance for this specific
 * classroom — the safeguard check before letting a teacher unlink a
 * classroom from a subject (see EditSubjectDialog). Unlinking never
 * deletes attendance_sessions/attendance_records rows (they reference
 * subject_id/classroom_id directly, not the subject_classrooms link row
 * — see supabase/migrations/0005_subject_attendance.sql), so no academic
 * history is ever destroyed by an unlink either way; this check exists so
 * the teacher is warned before losing the ability to take attendance for
 * that classroom under this subject again, not to prevent data loss that
 * can't actually happen.
 */
export async function hasSubjectClassroomAttendance(subjectId: string, classroomId: string): Promise<boolean> {
  const supabase = getSupabaseClient()
  const { count, error } = await supabase
    .from('attendance_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('subject_id', subjectId)
    .eq('classroom_id', classroomId)

  if (error) throw error
  return (count ?? 0) > 0
}

/**
 * Derives the subject's student roster from
 * subjects -> subject_classrooms -> classroom_students -> students —
 * never a stored/duplicated row. A student who belongs to more than one
 * of the subject's linked classrooms is de-duplicated (returned once,
 * attributed to whichever linked classroom is encountered first).
 *
 * Pass `classroomId` to scope the roster to one linked classroom only
 * (used by the Students tab's classroom filter); omit it for the full
 * subject roster across every linked classroom.
 */
export async function getSubjectStudents(
  subjectId: string,
  classroomId?: string,
): Promise<SubjectStudentView[]> {
  const supabase = getSupabaseClient()

  const { data: links, error: linksError } = await supabase
    .from('subject_classrooms')
    .select('classroom_id, classrooms(id, name)')
    .eq('subject_id', subjectId)

  if (linksError) throw linksError

  const linkRows = (links ?? []) as unknown as {
    classroom_id: string
    classrooms: { id: string; name: string } | null
  }[]
  const classroomIds = classroomId
    ? linkRows.filter((link) => link.classroom_id === classroomId).map((link) => link.classroom_id)
    : linkRows.map((link) => link.classroom_id)

  if (classroomIds.length === 0) return []

  const classroomNameById = new Map(linkRows.map((link) => [link.classroom_id, link.classrooms?.name ?? '']))

  const { data, error } = await supabase
    .from('classroom_students')
    .select('classroom_id, students(*)')
    .in('classroom_id', classroomIds)

  if (error) throw error

  const rows = data as unknown as { classroom_id: string; students: StudentRow }[]
  const seen = new Set<string>()
  const result: SubjectStudentView[] = []

  for (const row of rows) {
    if (seen.has(row.students.id)) continue
    seen.add(row.students.id)
    result.push({
      ...mapStudent(row.students),
      classroomId: row.classroom_id,
      classroomName: classroomNameById.get(row.classroom_id) ?? '',
    })
  }

  return result.sort((a, b) => (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER))
}
