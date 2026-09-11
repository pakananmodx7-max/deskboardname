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

/**
 * One selectable target in "คัดลอกไปห้องอื่น" — a (subject, classroom) pair
 * the calling teacher owns, with both names carried alongside the ids so
 * the picker can show "subjectName · classroomName" without a second
 * lookup (see assignment-service.ts's getAssignmentCopyTargets).
 */
export interface AssignmentCopyTarget {
  subjectId: string
  subjectName: string
  classroomId: string
  classroomName: string
}

/** Per-target outcome of copyAssignmentToClassrooms — a partial failure
 * (e.g. one target's resource copy fails) never rolls back or blocks the
 * other targets, matching this codebase's established "independent
 * per-target writes" pattern (see bulkSetSubmissionStatus). */
export interface AssignmentCopyOutcome {
  target: AssignmentCopyTarget
  ok: boolean
  error?: string
}

export interface AssignmentSubmission {
  studentId: string
  status: SubmissionStatus
  score: number | null
  note: string | null
  /** Optional — omitted by call sites that only ever synthesize a
   * default "no row yet" submission (e.g. the teacher roster's
   * mergeSubmissionsWithDefaults), present whenever the row actually
   * came from the database. `id` is required to attach/read
   * assignment_submission_resources (see submission-service.ts) — a
   * synthesized default has no real submission id yet. */
  id?: string
  /** When the student last (re)submitted — null until they submit at
   * least once. Set by submission-service.ts's finalizeSubmission(),
   * never editable by a teacher. */
  submittedAt?: string | null
  /** When a teacher last recorded a score — bumped every time
   * setSubmissionScore() runs. Informational only (supports a future
   * storage-retention policy, e.g. "clean up files N days after
   * grading") — never editable by a student, enforced by
   * 0016's enforce_submission_field_ownership trigger. */
  reviewedAt?: string | null
}
