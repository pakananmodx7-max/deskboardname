import { getSupabaseClient } from '@/lib/supabase'
import type {
  ClassroomStudent,
  CreateStudentInput,
  Student,
  UpdateStudentInput,
} from '@/types/student'

export interface StudentRow {
  id: string
  student_code: string | null
  number: number | null
  first_name: string
  last_name: string
  nickname: string | null
  email: string | null
  phone: string | null
  status: 'active' | 'inactive'
  created_at: string
  updated_at: string
}

interface ClassroomStudentRow {
  id: string
  joined_at: string
  students: StudentRow
}

/** Exported so subject-service.ts can map the same `students` row shape
 * when deriving a subject's roster via subject_classrooms ->
 * classroom_students -> students, without duplicating the mapping logic. */
export function mapStudent(row: StudentRow): Student {
  return {
    id: row.id,
    studentCode: row.student_code,
    number: row.number,
    firstName: row.first_name,
    lastName: row.last_name,
    nickname: row.nickname,
    email: row.email,
    phone: row.phone,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapClassroomStudent(row: ClassroomStudentRow): ClassroomStudent {
  return {
    ...mapStudent(row.students),
    classroomStudentId: row.id,
    joinedAt: row.joined_at,
  }
}

export async function getStudentsByClassroom(classroomId: string): Promise<ClassroomStudent[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('classroom_students')
    .select('id, joined_at, students(*)')
    .eq('classroom_id', classroomId)

  if (error) throw error

  const rows = data as unknown as ClassroomStudentRow[]
  return rows
    .map(mapClassroomStudent)
    .sort((a, b) => (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER))
}

/**
 * Looks up a student by student_code among students already visible to the
 * current teacher (i.e. members of a classroom they own) — RLS makes this
 * scoping automatic. See docs/DATABASE.md for why this isn't a global,
 * cross-teacher lookup.
 */
export async function findStudentByCode(studentCode: string): Promise<Student | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('students')
    .select('*')
    .eq('student_code', studentCode)
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data ? mapStudent(data as StudentRow) : null
}

export async function isStudentInClassroom(studentId: string, classroomId: string): Promise<boolean> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('classroom_students')
    .select('id')
    .eq('student_id', studentId)
    .eq('classroom_id', classroomId)
    .maybeSingle()

  if (error) throw error
  return Boolean(data)
}

export async function addStudentToClassroom(studentId: string, classroomId: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('classroom_students')
    .insert({ student_id: studentId, classroom_id: classroomId })

  if (error) throw error
}

export async function removeStudentFromClassroom(studentId: string, classroomId: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('classroom_students')
    .delete()
    .eq('student_id', studentId)
    .eq('classroom_id', classroomId)

  if (error) throw error
}

/**
 * Creates a student and enrolls them in a classroom as a single atomic
 * operation via the `create_student_and_enroll` database function — see
 * that function's comment in supabase/migrations/0001_init.sql. This
 * avoids the orphan-row risk of doing "insert student" then "insert
 * membership" as two separate client-side statements, where a failure
 * on the second step would leave an unreachable student record behind.
 */
export async function createStudent(input: CreateStudentInput): Promise<Student> {
  const supabase = getSupabaseClient()

  const { data, error } = await supabase.rpc('create_student_and_enroll', {
    p_classroom_id: input.classroomId,
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_student_code: input.studentCode ?? null,
    p_number: input.number ?? null,
    p_nickname: input.nickname ?? null,
    p_email: input.email ?? null,
    p_phone: input.phone ?? null,
  })

  if (error) throw error
  return mapStudent(data as StudentRow)
}

export async function updateStudent(studentId: string, input: UpdateStudentInput): Promise<Student> {
  const supabase = getSupabaseClient()

  const patch: Record<string, unknown> = {}
  if (input.studentCode !== undefined) patch.student_code = input.studentCode
  if (input.number !== undefined) patch.number = input.number
  if (input.firstName !== undefined) patch.first_name = input.firstName
  if (input.lastName !== undefined) patch.last_name = input.lastName
  if (input.nickname !== undefined) patch.nickname = input.nickname
  if (input.email !== undefined) patch.email = input.email
  if (input.phone !== undefined) patch.phone = input.phone
  if (input.status !== undefined) patch.status = input.status

  const { data, error } = await supabase
    .from('students')
    .update(patch)
    .eq('id', studentId)
    .select('*')
    .single()

  if (error) throw error
  return mapStudent(data as StudentRow)
}

export async function archiveStudent(studentId: string): Promise<Student> {
  return updateStudent(studentId, { status: 'inactive' })
}
