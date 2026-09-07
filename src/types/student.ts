export type StudentStatus = 'active' | 'inactive'

export interface Student {
  id: string
  studentCode: string | null
  number: number | null
  firstName: string
  lastName: string
  nickname: string | null
  email: string | null
  phone: string | null
  status: StudentStatus
  createdAt: string
  updatedAt: string
}

/** A student row joined with its membership info for a specific classroom. */
export interface ClassroomStudent extends Student {
  classroomStudentId: string
  joinedAt: string
}

export interface CreateStudentInput {
  classroomId: string
  studentCode?: string | null
  number?: number | null
  firstName: string
  lastName: string
  nickname?: string | null
  email?: string | null
  phone?: string | null
}

export interface UpdateStudentInput {
  studentCode?: string | null
  number?: number | null
  firstName?: string
  lastName?: string
  nickname?: string | null
  email?: string | null
  phone?: string | null
  status?: StudentStatus
}
