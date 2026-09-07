import { getSupabaseClient } from '@/lib/supabase'
import type { Classroom, CreateClassroomInput } from '@/types/classroom'

interface ClassroomRow {
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
}

function mapClassroom(row: ClassroomRow): Classroom {
  return {
    id: row.id,
    teacherId: row.teacher_id,
    name: row.name,
    gradeLevel: row.grade_level,
    section: row.section,
    academicYear: row.academic_year,
    semester: row.semester,
    isActive: row.is_active,
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
