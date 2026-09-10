import { getSupabaseClient } from '@/lib/supabase'
import type {
  AddLessonFileResourceInput,
  AddLessonLinkResourceInput,
  CreateLessonInput,
  Lesson,
  LessonResource,
  LessonResourceType,
  UpdateLessonInput,
} from '@/types/lesson'

/** Re-exported for backward compatibility — every real implementation
 * now lives in the shared resource-provider module (see its own doc
 * comment for why), alongside the equivalent Google Slides embed
 * derivation this feature adds. */
export { getYoutubeEmbedUrl } from '@/lib/resource-provider'

const RESOURCE_BUCKET = 'lesson-files'

/**
 * Mirrors supabase/migrations/0015_lessons.sql's `allowed_mime_types` on
 * the 'lesson-files' bucket exactly — a client-side pre-check in front
 * of that Storage-level enforcement, not a replacement for it (same
 * "defense in depth, not either-or" stance as assignment-resource-service.ts).
 * Deliberately has NO video mime type — a video resource is always an
 * external link, never an upload (see the migration's
 * lesson_resources_video_no_upload_check).
 */
const FILE_TYPE_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Bytes — mirrors the migration's `file_size_limit` (20 MiB) exactly. */
export const LESSON_FILE_MAX_BYTES = 20 * 1024 * 1024

interface LessonRow {
  id: string
  subject_id: string
  classroom_id: string
  title: string
  description: string | null
  sort_order: number
  is_published: boolean
  is_archived: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

interface LessonResourceRow {
  id: string
  lesson_id: string
  resource_type: LessonResourceType
  title: string
  file_path: string | null
  url: string | null
  mime_type: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

function mapLesson(row: LessonRow): Lesson {
  return {
    id: row.id,
    subjectId: row.subject_id,
    classroomId: row.classroom_id,
    title: row.title,
    description: row.description,
    sortOrder: row.sort_order,
    isPublished: row.is_published,
    isArchived: row.is_archived,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapResource(row: LessonResourceRow): LessonResource {
  return {
    id: row.id,
    lessonId: row.lesson_id,
    resourceType: row.resource_type,
    title: row.title,
    filePath: row.file_path,
    url: row.url,
    mimeType: row.mime_type,
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

// ==================================================
// Lessons
// ==================================================

/**
 * Every lesson for one subject+classroom pair, in display order. RLS
 * (`lessons_select_teacher` / `_select_student`, 0015) scopes this to
 * either the owning teacher (sees drafts and archived lessons too) or a
 * student currently enrolled in the classroom (sees ONLY published,
 * non-archived rows) — never anyone else, so this function itself needs
 * no extra scoping or role branching.
 */
export async function getLessons(subjectId: string, classroomId: string): Promise<Lesson[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('lessons')
    .select('*')
    .eq('subject_id', subjectId)
    .eq('classroom_id', classroomId)
    .order('sort_order', { ascending: true })

  if (error) throw error
  return (data as LessonRow[]).map(mapLesson)
}

/**
 * `lessons_insert_teacher` (0015) already requires the caller to own
 * both the classroom and the subject AND that the subject is actually
 * linked to that classroom via subject_classrooms — so passing a
 * classroomId not linked to subjectId fails with a clear RLS error
 * rather than silently creating a dangling lesson. A new lesson always
 * starts unpublished (draft) — the teacher must explicitly publish it
 * (see publishLesson below) before any student can see it.
 */
export async function createLesson(input: CreateLessonInput, sortOrder: number): Promise<Lesson> {
  const supabase = getSupabaseClient()
  const teacherId = await requireTeacherId()

  const { data, error } = await supabase
    .from('lessons')
    .insert({
      subject_id: input.subjectId,
      classroom_id: input.classroomId,
      title: input.title,
      description: input.description ?? null,
      sort_order: sortOrder,
      created_by: teacherId,
    })
    .select('*')
    .single()

  if (error) throw error
  return mapLesson(data as LessonRow)
}

/**
 * `lessons_update_teacher` (0015) scopes this to rows the caller owns —
 * there is no subjectId/classroomId field on UpdateLessonInput at all,
 * so a lesson can never be reassigned to a different subject/classroom
 * pair through this function.
 */
export async function updateLesson(lessonId: string, input: UpdateLessonInput): Promise<Lesson> {
  const supabase = getSupabaseClient()

  const patch: Record<string, unknown> = {}
  if (input.title !== undefined) patch.title = input.title
  if (input.description !== undefined) patch.description = input.description
  if (input.isPublished !== undefined) patch.is_published = input.isPublished
  if (input.isArchived !== undefined) patch.is_archived = input.isArchived

  const { data, error } = await supabase.from('lessons').update(patch).eq('id', lessonId).select('*').single()

  if (error) throw error
  return mapLesson(data as LessonRow)
}

export async function publishLesson(lessonId: string): Promise<Lesson> {
  return updateLesson(lessonId, { isPublished: true })
}

export async function unpublishLesson(lessonId: string): Promise<Lesson> {
  return updateLesson(lessonId, { isPublished: false })
}

/**
 * Lessons are never hard-deleted through the app — there is no DELETE
 * RLS policy for them (0015), matching assignments/students/subjects.
 * Archiving just flips is_archived to true; every resource stays intact
 * (and immediately becomes invisible to students too — see
 * student_can_view_lesson() in the migration).
 */
export async function archiveLesson(lessonId: string): Promise<Lesson> {
  return updateLesson(lessonId, { isArchived: true })
}

/**
 * Persists a new relative order for a set of lessons belonging to the
 * SAME subject+classroom — independent per-row updates, each
 * independently authorized by `lessons_update_teacher` (0015). Mirrors
 * assignment-resource-service.ts's reorderResources.
 */
export async function reorderLessons(updates: { id: string; sortOrder: number }[]): Promise<void> {
  const supabase = getSupabaseClient()
  await Promise.all(
    updates.map(async ({ id, sortOrder }) => {
      const { error } = await supabase.from('lessons').update({ sort_order: sortOrder }).eq('id', id)
      if (error) throw error
    }),
  )
}

/** Moves the lesson at `fromIndex` to `toIndex` and returns a brand-new
 * array with every item's `sortOrder` renumbered 0..n-1 in its new
 * position — pure, so the reorder UI (and reorderLessons' persistence
 * step above) can be driven and unit-tested without a live Supabase
 * round trip for every move. */
export function reorderLessonsLocally(lessons: Lesson[], fromIndex: number, toIndex: number): Lesson[] {
  const next = [...lessons]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next.map((lesson, index) => ({ ...lesson, sortOrder: index }))
}

/** The next lesson's sort_order given the lessons already loaded for
 * this subject+classroom — always appends to the end. */
export function computeNextLessonSortOrder(existing: Lesson[]): number {
  if (existing.length === 0) return 0
  return Math.max(...existing.map((l) => l.sortOrder)) + 1
}

// ==================================================
// Lesson resources
// ==================================================

const RESOURCE_TYPE_LABEL: Record<LessonResourceType, string> = {
  slide: 'สไลด์',
  video: 'วิดีโอ',
  document: 'เอกสาร',
  link: 'ลิงก์',
}

export function lessonResourceTypeLabel(type: LessonResourceType): string {
  return RESOURCE_TYPE_LABEL[type]
}

/** Every resource for one lesson, in display order. RLS
 * (`lesson_resources_select_teacher` / `_select_student`, 0015) scopes
 * this to either the owning teacher or a student who can currently view
 * the parent lesson (published, non-archived, own classroom). */
export async function getLessonResources(lessonId: string): Promise<LessonResource[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('lesson_resources')
    .select('*')
    .eq('lesson_id', lessonId)
    .order('sort_order', { ascending: true })

  if (error) throw error
  return (data as LessonResourceRow[]).map(mapResource)
}

/**
 * Resource counts for many lessons in one query — lets the student
 * lesson list decide how many items each lesson has without eagerly
 * fetching every lesson's full resource list up front. Mirrors
 * assignment-resource-service.ts's getResourceCounts.
 */
export async function getLessonResourceCounts(lessonIds: string[]): Promise<Record<string, number>> {
  if (lessonIds.length === 0) return {}

  const supabase = getSupabaseClient()
  const { data, error } = await supabase.from('lesson_resources').select('lesson_id').in('lesson_id', lessonIds)

  if (error) throw error

  const counts: Record<string, number> = {}
  for (const row of data as { lesson_id: string }[]) {
    counts[row.lesson_id] = (counts[row.lesson_id] ?? 0) + 1
  }
  return counts
}

/** Non-empty, trimmed title. */
export function validateLessonResourceTitle(raw: string): string | null {
  return raw.trim() ? null : 'กรุณากรอกชื่อสื่อการสอน'
}

/** Rejects anything but a well-formed `https://` URL — mirrors the
 * migration's own `lesson_resources_url_https_check` constraint
 * client-side. */
export function validateLessonResourceUrl(raw: string): string | null {
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
 * both the type-allowlist and size-limit checks. Only ever called for
 * 'slide'/'document' uploads — 'video' never reaches this path (see
 * AddLessonFileResourceInput's resourceType narrowing). */
export function validateLessonResourceFile(file: File): string | null {
  if (!(file.type in FILE_TYPE_EXTENSIONS)) {
    return 'รองรับเฉพาะไฟล์ PDF, PPTX, DOCX, JPG, PNG หรือ WEBP เท่านั้น'
  }
  if (file.size > LESSON_FILE_MAX_BYTES) {
    return 'ขนาดไฟล์ต้องไม่เกิน 20MB'
  }
  return null
}

/** `<random uuid>.<ext>` derived from the file's MIME type — never the
 * original filename or extension, same reasoning as
 * assignment-resource-service.ts's generateResourceFileName. */
export function generateLessonResourceFileName(mimeType: string): string {
  const ext = FILE_TYPE_EXTENSIONS[mimeType] ?? 'bin'
  return `${crypto.randomUUID()}.${ext}`
}

/**
 * A stable, collision-proof storage path — always
 * `<teacherId>/<subjectId>/<classroomId>/<lessonId>/<generated name>`,
 * matching the migration's storage path convention exactly (the
 * lesson_id segment, 4th, is what the student SELECT policy checks
 * against student_can_view_lesson()).
 */
export function buildLessonResourcePath(
  teacherId: string,
  subjectId: string,
  classroomId: string,
  lessonId: string,
  generatedName: string,
): string {
  return `${teacherId}/${subjectId}/${classroomId}/${lessonId}/${generatedName}`
}

/** The next resource's sort_order given the resources already loaded for
 * this lesson — always appends to the end. */
export function computeNextResourceSortOrder(existing: LessonResource[]): number {
  if (existing.length === 0) return 0
  return Math.max(...existing.map((r) => r.sortOrder)) + 1
}

/**
 * Uploads the file to the lesson's own scoped storage path, then records
 * it as a 'slide' or 'document' resource. If the row insert fails after
 * a successful upload (e.g. the caller doesn't actually own the lesson —
 * a case that should never reach here through the real UI, but is not
 * trusted client-side either), the just-uploaded object is removed again
 * so no orphaned file survives a rejected resource. Mirrors
 * assignment-resource-service.ts's addFileResource.
 */
export async function addLessonFileResource(
  input: AddLessonFileResourceInput,
  subjectId: string,
  classroomId: string,
  sortOrder: number,
): Promise<LessonResource> {
  const titleError = validateLessonResourceTitle(input.title)
  if (titleError) throw new Error(titleError)
  const fileError = validateLessonResourceFile(input.file)
  if (fileError) throw new Error(fileError)

  const supabase = getSupabaseClient()
  const teacherId = await requireTeacherId()
  const fileName = generateLessonResourceFileName(input.file.type)
  const path = buildLessonResourcePath(teacherId, subjectId, classroomId, input.lessonId, fileName)

  const { error: uploadError } = await supabase.storage
    .from(RESOURCE_BUCKET)
    .upload(path, input.file, { contentType: input.file.type, cacheControl: '3600' })
  if (uploadError) throw uploadError

  const { data, error } = await supabase
    .from('lesson_resources')
    .insert({
      lesson_id: input.lessonId,
      resource_type: input.resourceType,
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
  return mapResource(data as LessonResourceRow)
}

/** Adds a link resource — any of the four resource types can be a link
 * (a 'video' resource is ALWAYS a link, never an upload). */
export async function addLessonLinkResource(input: AddLessonLinkResourceInput, sortOrder: number): Promise<LessonResource> {
  const titleError = validateLessonResourceTitle(input.title)
  if (titleError) throw new Error(titleError)
  const urlError = validateLessonResourceUrl(input.url)
  if (urlError) throw new Error(urlError)

  const supabase = getSupabaseClient()
  const teacherId = await requireTeacherId()

  const { data, error } = await supabase
    .from('lesson_resources')
    .insert({
      lesson_id: input.lessonId,
      resource_type: input.resourceType,
      title: input.title.trim(),
      url: input.url.trim(),
      sort_order: sortOrder,
      created_by: teacherId,
    })
    .select('*')
    .single()

  if (error) throw error
  return mapResource(data as LessonResourceRow)
}

/** Deletes the row (RLS: only the owning teacher can), then best-effort
 * removes the underlying storage object for a file resource. */
export async function removeLessonResource(resource: LessonResource): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.from('lesson_resources').delete().eq('id', resource.id)
  if (error) throw error

  if (resource.filePath) {
    await supabase.storage.from(RESOURCE_BUCKET).remove([resource.filePath]).catch(() => undefined)
  }
}

/** Persists a new relative order for a set of resources belonging to the
 * SAME lesson — independent per-row updates. */
export async function reorderLessonResources(updates: { id: string; sortOrder: number }[]): Promise<void> {
  const supabase = getSupabaseClient()
  await Promise.all(
    updates.map(async ({ id, sortOrder }) => {
      const { error } = await supabase.from('lesson_resources').update({ sort_order: sortOrder }).eq('id', id)
      if (error) throw error
    }),
  )
}

export function reorderLessonResourcesLocally(
  resources: LessonResource[],
  fromIndex: number,
  toIndex: number,
): LessonResource[] {
  const next = [...resources]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next.map((resource, index) => ({ ...resource, sortOrder: index }))
}

/**
 * 'lesson-files' is a PRIVATE bucket — every read, teacher or student,
 * goes through a short-lived signed URL gated by the caller's own
 * RLS-checked SELECT access to the underlying storage object (0015's
 * `lesson_files_select_teacher` / `_select_student`). Mirrors
 * assignment-resource-service.ts's getResourceSignedUrl exactly.
 */
export async function getLessonResourceSignedUrl(filePath: string, expiresInSeconds = 300): Promise<string> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.storage.from(RESOURCE_BUCKET).createSignedUrl(filePath, expiresInSeconds)
  if (error) throw error
  return data.signedUrl
}
