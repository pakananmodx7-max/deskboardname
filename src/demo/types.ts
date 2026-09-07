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

export interface DemoSubjectAssignment {
  id: string
  subjectId: string
  topicId: string | null
  title: string
  type: SubjectAssignmentType
  maxScore: number
  dueDate: string
  description: string
  /** studentId -> submission record */
  submissions: Record<string, DemoSubmission>
}

/** subjectId -> date (YYYY-MM-DD) -> studentId -> status */
export type DemoSubjectAttendance = Record<string, Record<string, Record<string, DemoAttendanceStatus>>>
