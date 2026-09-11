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
  /** Supabase Storage object path in the 'avatars' bucket, e.g.
   * '<student_id>/avatar.jpg' — never a full URL. Null when no avatar has
   * been uploaded yet (render fallback initials). Only ever written via
   * update_my_avatar_path() (0012) — see student-portal-service.ts. */
  avatarPath: string | null
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
  /** When a teacher last recorded a score for this assignment — see
   * AssignmentSubmission.reviewedAt. Set regardless of `status`, so the
   * UI can show a distinct "ตรวจแล้ว" (reviewed) state even for a
   * submission that was merely 'submitted'/'late' before grading. */
  reviewedAt: string | null
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

/** A private calendar note/reminder the student created themselves
 * (student_calendar_entries, 0012) — strictly own-row CRUD, never
 * visible to a teacher. */
export interface MyCalendarEntry {
  id: string
  title: string
  note: string | null
  eventDate: string
  eventTime: string | null
  createdAt: string
  updatedAt: string
}

/** One entry in the merged personal-calendar view shown on the
 * dashboard/calendar widget — either a student-created note (editable)
 * or a read-only assignment due date pulled in from getMyAssignments. */
export type MyCalendarItem =
  | { kind: 'note'; entry: MyCalendarEntry }
  | { kind: 'assignment-due'; assignmentId: string; title: string; subjectName: string; eventDate: string }

/** One teacher -> student notification (teacher_student_notifications,
 * 0012). Always addressed to the signed-in student themselves — RLS
 * guarantees this can never be another student's message. */
export interface MyNotification {
  id: string
  senderName: string
  title: string | null
  message: string
  readAt: string | null
  createdAt: string
}
