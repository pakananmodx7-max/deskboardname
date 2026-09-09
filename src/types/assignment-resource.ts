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
}
