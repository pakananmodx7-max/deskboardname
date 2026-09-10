export type LessonResourceType = 'slide' | 'video' | 'document' | 'link'

/**
 * A teacher-organized learning material grouping ("บทเรียน") — slides,
 * videos, documents, external links — always scoped to exactly one
 * subject+classroom pair, entirely separate from the assignment workflow
 * (see supabase/migrations/0015_lessons.sql). Never gradable, never has
 * a due date. A student only ever sees a lesson once BOTH isPublished
 * and !isArchived are true — enforced by RLS, not just this type.
 */
export interface Lesson {
  id: string
  subjectId: string
  classroomId: string
  title: string
  description: string | null
  sortOrder: number
  isPublished: boolean
  isArchived: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

/**
 * One resource attached to a lesson ("สไลด์บทที่ 1", "คลิปการสอน", ...).
 * Exactly one of filePath/url is ever set (enforced by a database check
 * constraint, not just this type). A `video` resource can NEVER carry an
 * uploaded file — it is always an external link (YouTube, Google Drive,
 * etc.) — see the migration's `lesson_resources_video_no_upload_check`.
 * `filePath` is a raw Supabase Storage object path — never shown to a
 * student directly, always resolved to a short-lived signed URL first.
 */
export interface LessonResource {
  id: string
  lessonId: string
  resourceType: LessonResourceType
  title: string
  filePath: string | null
  url: string | null
  mimeType: string | null
  /** Google Drive's own file id — set only for a resource added via the
   * Google Drive Picker (Google Drive API Integration), never for a
   * manually pasted link. Purely a display/API convenience; the
   * resource's provider is still always DERIVED from `url` at render
   * time (detectResourceProvider), never trusted from this column. */
  driveFileId: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface CreateLessonInput {
  subjectId: string
  classroomId: string
  title: string
  description?: string | null
}

export interface UpdateLessonInput {
  title?: string
  description?: string | null
  isPublished?: boolean
  isArchived?: boolean
}

export interface AddLessonFileResourceInput {
  lessonId: string
  /** Only 'slide' or 'document' — a 'video' resource is never a file
   * upload (see the type-level comment on LessonResourceType/LessonResource). */
  resourceType: Extract<LessonResourceType, 'slide' | 'document'>
  title: string
  file: File
}

export interface AddLessonLinkResourceInput {
  lessonId: string
  resourceType: LessonResourceType
  title: string
  url: string
  /** Set only when this link came from the Google Drive Picker. */
  driveFileId?: string | null
  mimeType?: string | null
}
