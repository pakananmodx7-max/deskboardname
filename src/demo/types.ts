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
