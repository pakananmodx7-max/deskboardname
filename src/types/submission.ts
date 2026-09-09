export type SubmissionResourceType = 'file' | 'link' | 'text'

/**
 * One piece of a student's submitted work ("งานออนไลน์") — a file, an
 * external link, or a text answer. Exactly one of storagePath/
 * externalUrl/textContent is ever set, matching resourceType (enforced
 * by a database check constraint, not just this type). See
 * supabase/migrations/0016_assignment_submission_uploads.sql.
 *
 * `deletedAt` is set only by a teacher's manual "ล้างไฟล์งานที่ตรวจแล้ว"
 * cleanup action — the row survives (originalFilename/mimeType/fileSize
 * stay intact for the academic record), only storagePath is cleared. A
 * resource with deletedAt set can no longer be opened (there is no file
 * to open) but still shows in the history as "was submitted, later
 * cleaned up."
 */
export interface SubmissionResource {
  id: string
  submissionId: string
  resourceType: SubmissionResourceType
  title: string | null
  storagePath: string | null
  externalUrl: string | null
  textContent: string | null
  originalFilename: string | null
  mimeType: string | null
  fileSize: number | null
  sortOrder: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface AddSubmissionFileInput {
  submissionId: string
  file: File
  title?: string | null
}

export interface AddSubmissionLinkInput {
  submissionId: string
  url: string
  title: string
}

export interface AddSubmissionTextInput {
  submissionId: string
  text: string
  title?: string | null
}
