/**
 * The payload shape KrunameClass hands to the local SGS Bridge Chrome
 * extension (see sgs-bridge/) — never sent to any server, never
 * containing Supabase tokens or SGS credentials. `version` exists so a
 * future breaking change to this shape can be detected explicitly by
 * the extension (an old extension talking to a new payload, or vice
 * versa) instead of failing on an unexpected/missing field.
 *
 * Only students with an ACTUAL, non-null score are included in
 * `students` — a null score ("no work graded yet") is never converted
 * to 0 and never sent at all. `skippedStudentIds` records who was left
 * out and why, purely for the teacher's own audit trail; the extension
 * never needs it to do its job.
 */
export const SGS_BRIDGE_PAYLOAD_VERSION = 1 as const

export interface SgsBridgeStudentScore {
  studentId: string
  studentNumber: number | null
  fullName: string
  /** Always a finite number, 0 <= score <= maxScore. Never null — a
   * null score means the student isn't in this array at all. */
  score: number
}

export interface SgsBridgeSkippedStudent {
  studentId: string
  studentNumber: number | null
  fullName: string
  reason: 'no_score'
}

export interface SgsBridgePayload {
  version: typeof SGS_BRIDGE_PAYLOAD_VERSION
  /** ISO 8601 — when this payload was generated, for the teacher's own
   * reference inside the extension; never used for auth or ordering. */
  generatedAt: string
  subjectId: string
  subjectName: string
  classroomId: string
  classroomName: string
  assignmentId: string
  assignmentTitle: string
  maxScore: number
  students: SgsBridgeStudentScore[]
  skippedStudentIds: SgsBridgeSkippedStudent[]
}
