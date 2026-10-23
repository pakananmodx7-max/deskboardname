import { getSupabaseClient } from '@/lib/supabase'
import { isLifecycleRpcMissing, toClassroomLifecycleError } from '@/services/classroom-lifecycle-errors'
import type { Classroom, CreateClassroomInput, UpdateClassroomInput } from '@/types/classroom'

export interface ClassroomRow {
  id: string
  teacher_id: string
  name: string
  grade_level: string | null
  section: string | null
  academic_year: string | null
  semester: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  /** 0032; absent before that migration. */
  archived_at?: string | null
}

export function mapClassroom(row: ClassroomRow): Classroom {
  return {
    id: row.id,
    teacherId: row.teacher_id,
    name: row.name,
    gradeLevel: row.grade_level,
    section: row.section,
    academicYear: row.academic_year,
    semester: row.semester,
    isActive: row.is_active,
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

class AuthRequiredError extends Error {
  constructor() {
    super('กรุณาเข้าสู่ระบบก่อนใช้งาน')
    this.name = 'AuthRequiredError'
  }
}

async function requireTeacherId(): Promise<string> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) {
    throw new AuthRequiredError()
  }
  return data.user.id
}

export async function getClassrooms(): Promise<Classroom[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('classrooms')
    .select('*')
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data as ClassroomRow[]).map(mapClassroom)
}

export async function getClassroomById(classroomId: string): Promise<Classroom | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('classrooms')
    .select('*')
    .eq('id', classroomId)
    .maybeSingle()

  if (error) throw error
  return data ? mapClassroom(data as ClassroomRow) : null
}

export async function createClassroom(input: CreateClassroomInput): Promise<Classroom> {
  const supabase = getSupabaseClient()
  const teacherId = await requireTeacherId()

  const { data, error } = await supabase
    .from('classrooms')
    .insert({
      teacher_id: teacherId,
      name: input.name,
      grade_level: input.gradeLevel ?? null,
      section: input.section ?? null,
      academic_year: input.academicYear ?? null,
      semester: input.semester ?? null,
    })
    .select('*')
    .single()

  if (error) throw error
  return mapClassroom(data as ClassroomRow)
}

/**
 * `classrooms_update_own` (0001_init.sql) already scopes this to rows
 * where `teacher_id = auth.uid()` — there is no `teacher_id` field on
 * `UpdateClassroomInput` at all, so ownership can never be reassigned
 * through this function, and a teacher can never touch a classroom they
 * don't own regardless of what id is passed in.
 */
export async function updateClassroom(classroomId: string, input: UpdateClassroomInput): Promise<Classroom> {
  const supabase = getSupabaseClient()

  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.gradeLevel !== undefined) patch.grade_level = input.gradeLevel
  if (input.section !== undefined) patch.section = input.section
  if (input.academicYear !== undefined) patch.academic_year = input.academicYear
  if (input.semester !== undefined) patch.semester = input.semester
  if (input.isActive !== undefined) patch.is_active = input.isActive

  const { data, error } = await supabase
    .from('classrooms')
    .update(patch)
    .eq('id', classroomId)
    .select('*')
    .single()

  if (error) throw error
  return mapClassroom(data as ClassroomRow)
}

/**
 * Archiving just flips `is_active` to false; everything the classroom
 * references (students, attendance, grades, subject links) stays intact.
 * Goes through set_classroom_archived (0032), which checks ownership on
 * the server, refuses a duplicate archive/restore (KC005/KC006) and
 * writes the audit row. Until 0032 is installed the RPC does not exist,
 * so the previous plain update (classrooms_update_own) is used instead.
 * Permanent deletion is a separate, explicit flow:
 * classroom-lifecycle-service.ts.
 */
async function setClassroomArchived(classroomId: string, archived: boolean): Promise<Classroom> {
  const supabase = getSupabaseClient()
  let response
  try {
    response = await supabase.rpc('set_classroom_archived', { p_classroom_id: classroomId, p_archived: archived })
  } catch (err) {
    throw toClassroomLifecycleError(err)
  }
  if (response.error) {
    if (isLifecycleRpcMissing(response.error)) return updateClassroom(classroomId, { isActive: !archived })
    throw toClassroomLifecycleError(response.error)
  }
  return mapClassroom(response.data as ClassroomRow)
}

export async function archiveClassroom(classroomId: string): Promise<Classroom> {
  return setClassroomArchived(classroomId, true)
}

export async function reactivateClassroom(classroomId: string): Promise<Classroom> {
  return setClassroomArchived(classroomId, false)
}
