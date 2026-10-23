export interface Classroom {
  id: string
  teacherId: string
  name: string
  gradeLevel: string | null
  section: string | null
  academicYear: string | null
  semester: string | null
  isActive: boolean
  /** When it was archived (null while active, or archived before 0032). */
  archivedAt?: string | null
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
