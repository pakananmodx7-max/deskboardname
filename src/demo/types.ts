export type DemoAttendanceStatus = 'present' | 'late' | 'leave' | 'absent'

export type DemoRiskLevel = 'low' | 'medium' | 'high'

export interface DemoStudent {
  id: string
  number: number
  studentCode: string
  firstName: string
  lastName: string
  nickname: string
  classroom: string
  status: 'active' | 'inactive'
}

export interface DemoAssignment {
  id: string
  title: string
  dueDate: string
  /** studentId -> submitted */
  submissions: Record<string, boolean>
}

export interface DemoGradeComponent {
  key: 'quiz1' | 'quiz2' | 'homework' | 'project' | 'midterm'
  label: string
  max: number
}

export type DemoGradeScores = Record<DemoGradeComponent['key'], number>

export interface DemoActivityItem {
  id: string
  timeLabel: string
  message: string
}

export interface DemoChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
}

// ==================================================
// Subject workspace
// ==================================================

export interface DemoClassroomInfo {
  id: string
  name: string
  studentIds: string[]
}

export interface DemoSubject {
  id: string
  name: string
  code: string
  academicYear: string
  semester: string
  description: string
  classroomIds: string[]
}

export interface DemoTopic {
  id: string
  subjectId: string
  title: string
  description: string
  order: number
  taughtDate: string
}

export type SubjectAssignmentType = 'homework' | 'worksheet' | 'exercise' | 'quiz' | 'project'

export const SUBJECT_ASSIGNMENT_TYPE_LABEL: Record<SubjectAssignmentType, string> = {
  homework: 'การบ้าน',
  worksheet: 'ใบงาน',
  exercise: 'แบบฝึกหัด',
  quiz: 'Quiz',
  project: 'Project',
}

export type SubmissionStatus = 'not_submitted' | 'submitted' | 'late' | 'missing'

export const SUBMISSION_STATUS_LABEL: Record<SubmissionStatus, string> = {
  not_submitted: 'ยังไม่ส่ง',
  submitted: 'ส่งแล้ว',
  late: 'ส่งช้า',
  missing: 'ขาดส่ง',
}

export const SUBMISSION_STATUS_ORDER: SubmissionStatus[] = ['submitted', 'not_submitted', 'late', 'missing']

export interface DemoSubmission {
  status: SubmissionStatus
  score: number | null
  note: string
}

/**
 * An assignment always belongs to exactly one subject AND one of that
 * subject's linked classrooms — never a bare subject-wide thing. Two
 * classrooms linked to the same subject get completely independent
 * assignment sets, even when a title matches between them (mirrors
 * supabase/migrations/0006_subject_assignments.sql's real schema).
 */
export interface DemoSubjectAssignment {
  id: string
  subjectId: string
  classroomId: string
  topicId: string | null
  title: string
  type: SubjectAssignmentType
  maxScore: number
  dueDate: string
  description: string
  isArchived: boolean
  /** studentId -> submission record */
  submissions: Record<string, DemoSubmission>
}

/**
 * subjectId -> classroomId -> date (YYYY-MM-DD) -> studentId -> status
 *
 * Keyed by classroomId (not merged across a subject's linked classrooms)
 * so subject attendance mirrors the real Supabase schema's
 * attendance_sessions, which is scoped to (classroom_id, subject_id,
 * attendance_date) — see supabase/migrations/0005_subject_attendance.sql.
 * Recording ม.5/1's roll call for a subject must never be visible under,
 * or overwrite, ม.5/2's roll call for that same subject+date.
 */
export type DemoSubjectAttendance = Record<
  string,
  Record<string, Record<string, Record<string, DemoAttendanceStatus>>>
>
