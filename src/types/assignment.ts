export interface AssignmentSummary {
  id: string
  title: string
  dueDate: string
  submittedCount: number
  totalCount: number
}

export type SubmissionStatus = 'not_submitted' | 'submitted' | 'late' | 'missing'

/**
 * An assignment always belongs to exactly one subject AND one of that
 * subject's linked classrooms — see
 * supabase/migrations/0006_subject_assignments.sql's scope note. Never
 * merge assignments across classrooms, even when the same subject has
 * two assignments with the same title in two different classrooms.
 */
export interface Assignment {
  id: string
  subjectId: string
  classroomId: string
  topicId: string | null
  title: string
  description: string | null
  maxScore: number
  dueDate: string | null
  isArchived: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateAssignmentInput {
  subjectId: string
  classroomId: string
  topicId?: string | null
  title: string
  description?: string | null
  maxScore: number
  dueDate?: string | null
}

export interface UpdateAssignmentInput {
  topicId?: string | null
  title?: string
  description?: string | null
  maxScore?: number
  dueDate?: string | null
  isArchived?: boolean
}

export interface AssignmentSubmission {
  studentId: string
  status: SubmissionStatus
  score: number | null
  note: string | null
}
