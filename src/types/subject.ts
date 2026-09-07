import type { Student } from './student'

export interface Subject {
  id: string
  teacherId: string
  name: string
  subjectCode: string | null
  description: string | null
  academicYear: string | null
  semester: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

/** A subject↔classroom link row, with the linked classroom's name for display. */
export interface SubjectClassroom {
  id: string
  subjectId: string
  classroomId: string
  classroomName: string | null
  createdAt: string
}

export interface CreateSubjectInput {
  name: string
  classroomIds: string[]
  subjectCode?: string | null
  description?: string | null
  academicYear?: string | null
  semester?: string | null
}

export interface UpdateSubjectInput {
  name?: string
  subjectCode?: string | null
  description?: string | null
  academicYear?: string | null
  semester?: string | null
}

/**
 * A student as seen from inside a subject workspace — derived (never
 * stored) via subjects -> subject_classrooms -> classroom_students ->
 * students. `classroomId`/`classroomName` record which of the subject's
 * linked classrooms this student was found through.
 */
export interface SubjectStudentView extends Student {
  classroomId: string
  classroomName: string
}
