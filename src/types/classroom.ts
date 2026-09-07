export interface Classroom {
  id: string
  teacherId: string
  name: string
  gradeLevel: string | null
  section: string | null
  academicYear: string | null
  semester: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateClassroomInput {
  name: string
  gradeLevel?: string | null
  section?: string | null
  academicYear?: string | null
  semester?: string | null
}

export interface UpdateClassroomInput {
  name?: string
  gradeLevel?: string | null
  section?: string | null
  academicYear?: string | null
  semester?: string | null
  isActive?: boolean
}
