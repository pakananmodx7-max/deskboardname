import { getSupabaseClient } from '@/lib/supabase'
import type {
  AddFileResourceInput,
  AddLinkResourceInput,
  AssignmentResource,
  AssignmentResourceType,
} from '@/types/assignment-resource'

const RESOURCE_BUCKET = 'assignment-files'

/**
 * Mirrors supabase/migrations/0013_assignment_resources.sql's
 * `allowed_mime_types` on the 'assignment-files' bucket exactly — this is
 * a client-side pre-check in front of that Storage-level enforcement, not
 * a replacement for it (same "defense in depth, not either-or" stance as
 * every other client-side validator in this app, e.g. attendance's score
 * bound / avatar upload).
 */
const FILE_TYPE_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Bytes — mirrors the migration's `file_size_limit` (10 MiB) exactly. */
export const RESOURCE_FILE_MAX_BYTES = 10 * 1024 * 1024

interface AssignmentResourceRow {
  id: string
  assignment_id: string
  resource_type: AssignmentResourceType
  title: string
  file_path: string | null
  url: string | null
  mime_type: string | null
  drive_file_id: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

function mapResource(row: AssignmentResourceRow): AssignmentResource {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    resourceType: row.resource_type,
    title: row.title,
    filePath: row.file_path,
    url: row.url,
    mimeType: row.mime_type,
    driveFileId: row.drive_file_id,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function requireTeacherId(): Promise<string> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) {
    throw new Error('กรุณาเข้าสู่ระบบก่อนใช้งาน')
  }
  return data.user.id
}

/**
 * Rejects anything but a well-formed `https://` URL — `javascript:`,
 * `data:`, `file:`, and any string `new URL()` can't parse are all
 * rejected the same way. Mirrors the migration's own
 * `assignment_resources_url_https_check` constraint client-side, so a bad
 * link never round-trips to the database only to be rejected there.
 */
export function validateResourceUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return 'กรุณากรอกลิงก์'

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return 'ลิงก์ไม่ถูกต้อง'
  }

  if (parsed.protocol !== 'https:') {
    return 'รองรับเฉพาะลิงก์ที่ขึ้นต้นด้วย https:// เท่านั้น'
  }
  return null
}

/** Thai error message for a rejected file, or null when the file passes
 * both the type-allowlist and size-limit checks. */
export function validateResourceFile(file: File): string | null {
  if (!(file.type in FILE_TYPE_EXTENSIONS)) {
    return 'รองรับเฉพาะไฟล์ PDF, DOCX, XLSX, JPG, PNG หรือ WEBP เท่านั้น'
  }
  if (file.size > RESOURCE_FILE_MAX_BYTES) {
    return 'ขนาดไฟล์ต้องไม่เกิน 10MB'
  }
  return null
}

/** Non-empty, trimmed title — the one shared rule for both file and link
 * resources (the migration's own `char_length(title) > 0` check). */
export function validateResourceTitle(raw: string): string | null {
  return raw.trim() ? null : 'กรุณากรอกชื่อสื่อ/ใบงาน'
}

/**
 * A stable, collision-proof storage path — always
 * `<teacherId>/<subjectId>/<classroomId>/<assignmentId>/<generated name>`,
 * NEVER built from the original uploaded filename (see the migration's
 * storage section for why: no two teachers/assignments could ever collide,
 * and nothing about the original filename ever leaks into the path). Pure
 * and independently testable — `generatedName` is passed in rather than
 * generated internally so a test can assert the exact path shape without
 * mocking crypto.randomUUID().
 */
export function buildAssignmentResourcePath(
  teacherId: string,
  subjectId: string,
  classroomId: string,
  assignmentId: string,
  generatedName: string,
): string {
  return `${teacherId}/${subjectId}/${classroomId}/${assignmentId}/${generatedName}`
}

/** `<random uuid>.<ext>` derived from the file's MIME type — never the
 * original filename or extension. */
export function generateResourceFileName(mimeType: string): string {
  const ext = FILE_TYPE_EXTENSIONS[mimeType] ?? 'bin'
  return `${crypto.randomUUID()}.${ext}`
}

/** The next resource's sort_order given the resources already loaded for
 * this assignment — always appends to the end. Pure so the "add resource"
 * UI flow (which already holds the current list in state) never needs an
 * extra round trip just to know where a new row belongs. */
export function computeNextSortOrder(existing: AssignmentResource[]): number {
  if (existing.length === 0) return 0
  return Math.max(...existing.map((r) => r.sortOrder)) + 1
}

/**
 * Every resource for one assignment, in display order. RLS
 * (`assignment_resources_select_teacher` / `_select_student`, 0013)
 * scopes this to either the owning teacher or a student currently
 * enrolled in the assignment's classroom — never anyone else, so this
 * function itself needs no extra scoping.
 */
export async function getAssignmentResources(assignmentId: string): Promise<AssignmentResource[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('assignment_resources')
    .select('*')
    .eq('assignment_id', assignmentId)
    .order('sort_order', { ascending: true })

  if (error) throw error
  return (data as AssignmentResourceRow[]).map(mapResource)
}

/**
 * Resource counts for many assignments in one query — lets a list view
 * (e.g. the student assignment list) decide whether to render the
 * "ใบงานและลิงก์" disclosure toggle at all, without eagerly fetching every
 * assignment's full resource list up front (avoids N+1).
 */
export async function getResourceCounts(assignmentIds: string[]): Promise<Record<string, number>> {
  if (assignmentIds.length === 0) return {}

  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('assignment_resources')
    .select('assignment_id')
    .in('assignment_id', assignmentIds)

  if (error) throw error

  const counts: Record<string, number> = {}
  for (const row of data as { assignment_id: string }[]) {
    counts[row.assignment_id] = (counts[row.assignment_id] ?? 0) + 1
  }
  return counts
}

/**
 * Uploads the file to the assignment's own scoped storage path, then
 * records it. If the row insert fails after a successful upload (e.g. the
 * caller doesn't actually own the assignment — `assignment_resources_insert_teacher`,
 * 0013 — a case that should never reach here through the real UI, but is
 * not trusted client-side either), the just-uploaded object is removed
 * again so no orphaned file survives a rejected resource.
 */
export async function addFileResource(
  input: AddFileResourceInput,
  subjectId: string,
  classroomId: string,
  sortOrder: number,
): Promise<AssignmentResource> {
  const titleError = validateResourceTitle(input.title)
  if (titleError) throw new Error(titleError)
  const fileError = validateResourceFile(input.file)
  if (fileError) throw new Error(fileError)

  const supabase = getSupabaseClient()
  const teacherId = await requireTeacherId()
  const fileName = generateResourceFileName(input.file.type)
  const path = buildAssignmentResourcePath(teacherId, subjectId, classroomId, input.assignmentId, fileName)

  const { error: uploadError } = await supabase.storage
    .from(RESOURCE_BUCKET)
    .upload(path, input.file, { contentType: input.file.type, cacheControl: '3600' })
  if (uploadError) throw uploadError

  const { data, error } = await supabase
    .from('assignment_resources')
    .insert({
      assignment_id: input.assignmentId,
      resource_type: 'file',
      title: input.title.trim(),
      file_path: path,
      mime_type: input.file.type,
      sort_order: sortOrder,
      created_by: teacherId,
    })
    .select('*')
    .single()

  if (error) {
    await supabase.storage.from(RESOURCE_BUCKET).remove([path]).catch(() => undefined)
    throw error
  }
  return mapResource(data as AssignmentResourceRow)
}

export async function addLinkResource(input: AddLinkResourceInput, sortOrder: number): Promise<AssignmentResource> {
  const titleError = validateResourceTitle(input.title)
  if (titleError) throw new Error(titleError)
  const urlError = validateResourceUrl(input.url)
  if (urlError) throw new Error(urlError)

  const supabase = getSupabaseClient()
  const teacherId = await requireTeacherId()

  const { data, error } = await supabase
    .from('assignment_resources')
    .insert({
      assignment_id: input.assignmentId,
      resource_type: 'link',
      title: input.title.trim(),
      url: input.url.trim(),
      mime_type: input.mimeType ?? null,
      drive_file_id: input.driveFileId ?? null,
      sort_order: sortOrder,
      created_by: teacherId,
    })
    .select('*')
    .single()

  if (error) throw error
  return mapResource(data as AssignmentResourceRow)
}

/** Deletes the row (RLS: only the owning teacher can), then best-effort
 * removes the underlying storage object for a file resource — the row
 * delete is the authoritative "this resource is gone" step; a leftover
 * orphaned object afterward is a cleanup detail, never something that
 * blocks or reverts the delete the teacher just asked for. */
export async function removeResource(resource: AssignmentResource): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.from('assignment_resources').delete().eq('id', resource.id)
  if (error) throw error

  if (resource.resourceType === 'file' && resource.filePath) {
    await supabase.storage.from(RESOURCE_BUCKET).remove([resource.filePath]).catch(() => undefined)
  }
}

/**
 * Persists a new relative order for a set of resources belonging to the
 * SAME assignment — independent per-row updates (same "no shared parent
 * write needs all-or-nothing semantics" reasoning as
 * assignment-service.ts's bulkSetSubmissionStatus), each independently
 * authorized by `assignment_resources_update_teacher` (0013).
 */
export async function reorderResources(updates: { id: string; sortOrder: number }[]): Promise<void> {
  const supabase = getSupabaseClient()
  await Promise.all(
    updates.map(async ({ id, sortOrder }) => {
      const { error } = await supabase.from('assignment_resources').update({ sort_order: sortOrder }).eq('id', id)
      if (error) throw error
    }),
  )
}

/**
 * Moves the resource at `fromIndex` to `toIndex` and returns a brand-new
 * array with every item's `sortOrder` renumbered 0..n-1 in its new
 * position — pure, so the reorder UI (and reorderResources' persistence
 * step above) can be driven and unit-tested without a live Supabase round
 * trip for every drag.
 */
export function reorderResourcesLocally(
  resources: AssignmentResource[],
  fromIndex: number,
  toIndex: number,
): AssignmentResource[] {
  const next = [...resources]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next.map((resource, index) => ({ ...resource, sortOrder: index }))
}

/**
 * Copies one resource onto a NEW assignment — used by "คัดลอกไปห้องอื่น"
 * (see assignment-service.ts's copyAssignmentToClassrooms). A 'link'
 * resource is just a fresh row (same url/mimeType/driveFileId) pointing at
 * the new assignment — nothing to copy in Storage. A 'file' resource's
 * underlying object is copied SERVER-SIDE (Storage's own `.copy()` — the
 * bytes never pass through this client) to a FRESH path scoped under the
 * target assignment's own teacherId/subjectId/classroomId/assignmentId —
 * reusing the SOURCE path would leave the object's classroom_id path
 * segment pointing at the SOURCE classroom, which would deny read access
 * to a student in a DIFFERENT target classroom
 * (assignment_files_select_student, 0013, checks that exact segment) even
 * though the new assignment_resources row says the file belongs to them.
 * Authorized by the SAME storage.objects policies as a normal upload
 * (assignment_files_select_teacher on the source path,
 * assignment_files_insert_teacher on the destination path) — both require
 * the path's teacherId segment to equal the caller's own auth.uid(), which
 * it always does here since the same signed-in teacher owns every valid
 * copy target (see getAssignmentCopyTargets).
 */
export async function copyResourceToAssignment(
  resource: AssignmentResource,
  targetAssignmentId: string,
  targetSubjectId: string,
  targetClassroomId: string,
): Promise<void> {
  const supabase = getSupabaseClient()
  const teacherId = await requireTeacherId()

  if (resource.resourceType === 'link') {
    const { error } = await supabase.from('assignment_resources').insert({
      assignment_id: targetAssignmentId,
      resource_type: 'link',
      title: resource.title,
      url: resource.url,
      mime_type: resource.mimeType,
      drive_file_id: resource.driveFileId,
      sort_order: resource.sortOrder,
      created_by: teacherId,
    })
    if (error) throw error
    return
  }

  // resourceType === 'file' — the migration's own check constraint
  // guarantees filePath is set whenever resourceType is 'file'.
  if (!resource.filePath) return
  const newFileName = generateResourceFileName(resource.mimeType ?? '')
  const newPath = buildAssignmentResourcePath(teacherId, targetSubjectId, targetClassroomId, targetAssignmentId, newFileName)

  const { error: copyError } = await supabase.storage.from(RESOURCE_BUCKET).copy(resource.filePath, newPath)
  if (copyError) throw copyError

  const { error } = await supabase
    .from('assignment_resources')
    .insert({
      assignment_id: targetAssignmentId,
      resource_type: 'file',
      title: resource.title,
      file_path: newPath,
      mime_type: resource.mimeType,
      sort_order: resource.sortOrder,
      created_by: teacherId,
    })
    .select('*')
    .single()

  if (error) {
    await supabase.storage.from(RESOURCE_BUCKET).remove([newPath]).catch(() => undefined)
    throw error
  }
}

/**
 * Best-effort removes every 'file' resource's underlying Storage object
 * for the given resources — used by assignment-service.ts's
 * deleteAssignmentPermanently right AFTER the assignments row delete has
 * already succeeded (whose own delete cascades away the
 * assignment_resources ROWS via FK, 0013 — but never their Storage
 * objects, which would otherwise become orphaned, unreachable objects).
 * Never called before/instead of that delete succeeding — see the calling
 * function's own ordering note for why.
 */
export async function removeResourceStorageObjects(resources: AssignmentResource[]): Promise<void> {
  const paths = resources
    .filter((r): r is AssignmentResource & { filePath: string } => r.resourceType === 'file' && Boolean(r.filePath))
    .map((r) => r.filePath)
  if (paths.length === 0) return

  const supabase = getSupabaseClient()
  await supabase.storage.from(RESOURCE_BUCKET).remove(paths).catch(() => undefined)
}

/**
 * `assignment-files` is a PRIVATE bucket (unlike the avatars bucket,
 * which is public) — every read, teacher or student, goes through a
 * short-lived signed URL gated by the caller's own RLS-checked SELECT
 * access to the underlying storage object (0013's
 * `assignment_files_select_teacher` / `_select_student`). There is no
 * plain/public URL construction for this bucket anywhere in this app.
 */
export async function getResourceSignedUrl(filePath: string, expiresInSeconds = 300): Promise<string> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.storage.from(RESOURCE_BUCKET).createSignedUrl(filePath, expiresInSeconds)
  if (error) throw error
  return data.signedUrl
}
