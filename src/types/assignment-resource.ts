export type AssignmentResourceType = 'file' | 'link'

/**
 * One teacher-attached worksheet/link on an assignment
 * ("สื่อและใบงาน") — see supabase/migrations/0013_assignment_resources.sql.
 * Exactly one of filePath/url is ever set, matching resourceType (enforced
 * by a database check constraint, not just this type). `filePath` is a
 * raw Supabase Storage object path — never shown to a student directly,
 * always resolved to a short-lived signed URL first (see
 * assignment-resource-service.ts's getResourceSignedUrl).
 */
export interface AssignmentResource {
  id: string
  assignmentId: string
  resourceType: AssignmentResourceType
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

export interface AddFileResourceInput {
  assignmentId: string
  title: string
  file: File
}

export interface AddLinkResourceInput {
  assignmentId: string
  title: string
  url: string
  /** Set only when this link came from the Google Drive Picker. */
  driveFileId?: string | null
  mimeType?: string | null
}
