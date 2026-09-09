import type { AttendanceStatus } from './attendance'
import type { SubmissionStatus } from './assignment'

/**
 * The signed-in student's own identity, as derived server-side by RLS
 * (0011_student_portal_read_access.sql's my_student_id()) from
 * auth.uid() -> students.linked_profile_id — never from anything the
 * client supplies. This is the ONLY shape the student portal ever reads
 * "who am I" from.
 */
export interface MyStudentProfile {
  id: string
  studentCode: string | null
  number: number | null
  firstName: string
  lastName: string
  nickname: string | null
}

/** A classroom the signed-in student currently belongs to. */
export interface MyClassroom {
  id: string
  name: string
  gradeLevel: string | null
  section: string | null
}

/** A subject taught in one of the signed-in student's classrooms. */
export interface MySubject {
  id: string
  name: string
  subjectCode: string | null
  description: string | null
  classroomId: string
  classroomName: string
}

/** One assignment, from the signed-in student's own point of view —
 * always exactly their own status/score, never another student's. */
export interface MyAssignment {
  id: string
  subjectId: string
  subjectName: string
  classroomId: string
  classroomName: string
  title: string
  description: string | null
  maxScore: number
  dueDate: string | null
  status: SubmissionStatus
  score: number | null
}

/** One attendance record, from the signed-in student's own point of
 * view. subjectName/periodNumber are null for a classroom-level
 * homeroom session (see 0004/0005's subject_id/period_number design). */
export interface MyAttendanceRecord {
  sessionId: string
  classroomId: string
  classroomName: string
  subjectId: string | null
  subjectName: string | null
  periodNumber: number | null
  attendanceDate: string
  status: AttendanceStatus
}
