import { getSupabaseClient } from '@/lib/supabase'
import { getMyStudentProfile } from '@/services/student-portal-service'
import type { AssignmentSubmission, SubmissionStatus } from '@/types/assignment'
import type {
  AddSubmissionFileInput,
  AddSubmissionLinkInput,
  AddSubmissionTextInput,
  SubmissionResource,
  SubmissionResourceType,
} from '@/types/submission'

const RESOURCE_BUCKET = 'submission-files'

/**
 * Mirrors supabase/migrations/0016_assignment_submission_uploads.sql's
 * `allowed_mime_types` on the 'submission-files' bucket exactly — a
 * client-side pre-check in front of that Storage-level enforcement, not
 * a replacement for it. ZIP is included per the feature spec's "ZIP only
 * if security review supports it" — see the migration's own comment for
 * why a ZIP is no different from any other opaque file in this
 * architecture (stored/served as inert bytes behind a signed URL, never
 * executed or extracted server-side).
 */
const FILE_TYPE_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
}

/** Bytes — mirrors the migration's `file_size_limit` (25 MiB) exactly. */
export const SUBMISSION_FILE_MAX_BYTES = 25 * 1024 * 1024

interface SubmissionRow {
  id: string
  student_id: string
  status: SubmissionStatus
  score: number | null
  note: string | null
  submitted_at: string | null
  reviewed_at: string | null
}

interface SubmissionResourceRow {
  id: string
  assignment_submission_id: string
  resource_type: SubmissionResourceType
  title: string | null
  storage_path: string | null
  external_url: string | null
  text_content: string | null
  original_filename: string | null
  mime_type: string | null
  file_size: number | null
  sort_order: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

function mapSubmissionRow(row: SubmissionRow): AssignmentSubmission {
  return {
    id: row.id,
    studentId: row.student_id,
    status: row.status,
    score: row.score,
    note: row.note,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
  }
}

function mapResource(row: SubmissionResourceRow): SubmissionResource {
  return {
    id: row.id,
    submissionId: row.assignment_submission_id,
    resourceType: row.resource_type,
    title: row.title,
    storagePath: row.storage_path,
    externalUrl: row.external_url,
    textContent: row.text_content,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  }
}

// ==================================================
// Student side
// ==================================================

/**
 * The signed-in student's own submission for one assignment — never
 * another student's (RLS: assignment_submissions_select_own_student,
 * 0011, scopes this to `student_id = my_student_id()` regardless of what
 * this function does or doesn't filter by). Returns null when the
 * student has never had a row created for this assignment yet (before
 * their first "ส่งงาน"). NOT for teacher use — a teacher calling this
 * would see every one of their students' rows for the assignment and
 * `.maybeSingle()` would throw; teachers use assignment-service.ts's
 * getSubmissions() (returns a per-student map) instead.
 */
export async function getMySubmission(assignmentId: string): Promise<AssignmentSubmission | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('assignment_submissions')
    .select('id, student_id, status, score, note, submitted_at, reviewed_at')
    .eq('assignment_id', assignmentId)
    .maybeSingle()

  if (error) throw error
  return data ? mapSubmissionRow(data as SubmissionRow) : null
}

/**
 * Get-or-create the student's own submission row for this assignment —
 * the "create then continue" step every resource attach needs a real
 * submission id to reference (assignment_submission_resources has a NOT
 * NULL FK). Deliberately does NOT touch status/submitted_at/score/note
 * on an EXISTING row (opening the page to add one more file to an
 * already-submitted, already-graded assignment must never reset any of
 * that) — only a brand-new row is inserted, with status defaulting to
 * 'not_submitted' until the student explicitly finalizes (see
 * finalizeSubmission below). A duplicate-key race (e.g. a double-click)
 * is resolved by re-reading the row that won, never surfaced as an
 * error to the student.
 */
export async function getOrCreateMySubmission(assignmentId: string): Promise<AssignmentSubmission> {
  const existing = await getMySubmission(assignmentId)
  if (existing) return existing

  const supabase = getSupabaseClient()
  const profile = await getMyStudentProfile()
  if (!profile) throw new Error('ไม่พบข้อมูลนักเรียน กรุณาเข้าสู่ระบบใหม่')

  const { data, error } = await supabase
    .from('assignment_submissions')
    .insert({ assignment_id: assignmentId, student_id: profile.id, status: 'not_submitted' })
    .select('id, student_id, status, score, note, submitted_at, reviewed_at')
    .single()

  if (error) {
    if (error.code === '23505') {
      const raced = await getMySubmission(assignmentId)
      if (raced) return raced
    }
    throw error
  }
  return mapSubmissionRow(data as SubmissionRow)
}

/**
 * Derives whether a submission happening at `submittedAt` counts as
 * on-time or late — `dueDate` is a plain DATE (no time component, see
 * assignments.due_date), treated as valid through 23:59:59 of that day.
 * Pure so it can be unit-tested without a live Supabase round trip and
 * shared between finalizeSubmission below and any future preview UI
 * ("if you submit right now, this will be marked ...").
 */
export function computeSubmissionStatusOnSubmit(dueDate: string | null, submittedAt: Date): SubmissionStatus {
  if (!dueDate) return 'submitted'
  const dueEndOfDay = new Date(`${dueDate}T23:59:59`)
  return submittedAt > dueEndOfDay ? 'late' : 'submitted'
}

/** The student-facing status set — the same four `SubmissionStatus`
 * values PLUS 'reviewed', a pure display-time derivation (never a fifth
 * database status) that takes priority once a teacher has recorded a
 * score via setSubmissionScore (assignment-service.ts), which always
 * stamps reviewed_at regardless of the underlying submitted/late status.
 * This is the ONE shared place that derivation happens — every
 * student-facing status badge (MySubmissionSection,
 * StudentAssignmentDetailPage) reads it from here rather than
 * re-implementing the same reviewedAt check. */
export type StudentFacingSubmissionStatus = SubmissionStatus | 'reviewed'

export function deriveStudentFacingStatus(submission: { status: SubmissionStatus; reviewedAt?: string | null } | null): StudentFacingSubmissionStatus {
  if (submission?.reviewedAt) return 'reviewed'
  return submission?.status ?? 'not_submitted'
}

export const STUDENT_SUBMISSION_STATUS_LABEL: Record<StudentFacingSubmissionStatus, string> = {
  not_submitted: 'ยังไม่ส่ง',
  submitted: 'ส่งแล้ว',
  late: 'ส่งช้า',
  missing: 'ขาดส่ง',
  reviewed: 'ตรวจแล้ว',
}

export const STUDENT_SUBMISSION_STATUS_BADGE_VARIANT: Record<
  StudentFacingSubmissionStatus,
  'outline' | 'success' | 'warning' | 'default'
> = {
  not_submitted: 'outline',
  submitted: 'success',
  late: 'warning',
  missing: 'warning',
  reviewed: 'default',
}

/**
 * The actual "ส่งงาน" commit point — marks the submission as
 * submitted/late (never called until the student has at least one
 * resource attached; the UI enforces this, see the student assignment
 * detail page) and stamps submittedAt to now. This is a SEPARATE step
 * from attaching resources on purpose (Section 10's error isolation
 * requirement: "If storage upload fails: do not mark the assignment as
 * successfully submitted") — a resource upload failure never reaches
 * this function at all, so status/submitted_at are never touched by a
 * failed upload. Calling this again later (resubmission) simply updates
 * the SAME row — score/note are untouched (enforced by 0016's
 * ownership trigger, not just this function's own payload shape), so a
 * resubmission can never silently wipe a grade that was already given.
 */
export async function finalizeSubmission(submissionId: string, dueDate: string | null): Promise<AssignmentSubmission> {
  const supabase = getSupabaseClient()
  const now = new Date()
  const status = computeSubmissionStatusOnSubmit(dueDate, now)

  const { data, error } = await supabase
    .from('assignment_submissions')
    .update({ status, submitted_at: now.toISOString() })
    .eq('id', submissionId)
    .select('id, student_id, status, score, note, submitted_at, reviewed_at')
    .single()

  if (error) throw error
  return mapSubmissionRow(data as SubmissionRow)
}

// ==================================================
// Resources — shared by student (read own / write own) and teacher
// (read own students' / cleanup only, never edit content — see the
// migration's enforce_submission_resource_teacher_edit trigger).
// ==================================================

const RESOURCE_TYPE_LABEL: Record<SubmissionResourceType, string> = {
  file: 'ไฟล์',
  link: 'ลิงก์',
  text: 'ข้อความ',
}

export function submissionResourceTypeLabel(type: SubmissionResourceType): string {
  return RESOURCE_TYPE_LABEL[type]
}

/** Every non-cleaned-up resource for one submission, in order. RLS
 * scopes this to either the owning student or the owning teacher —
 * never anyone else. Cleaned-up (deleted_at set) resources are still
 * included — the caller decides how to render "file removed" history,
 * see SubmissionResource.deletedAt. */
export async function getSubmissionResources(submissionId: string): Promise<SubmissionResource[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('assignment_submission_resources')
    .select('*')
    .eq('assignment_submission_id', submissionId)
    .order('sort_order', { ascending: true })

  if (error) throw error
  return (data as SubmissionResourceRow[]).map(mapResource)
}

/** Resource counts for many submissions in one query — lets the teacher
 * roster show a compact "2 ไฟล์" without eagerly fetching every
 * student's full resource list up front. Counts only NON-cleaned-up
 * resources (a fully cleaned-up submission shows 0, even though the
 * historical rows still exist). */
export async function getSubmissionResourceCounts(submissionIds: string[]): Promise<Record<string, number>> {
  if (submissionIds.length === 0) return {}

  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('assignment_submission_resources')
    .select('assignment_submission_id')
    .in('assignment_submission_id', submissionIds)
    .is('deleted_at', null)

  if (error) throw error

  const counts: Record<string, number> = {}
  for (const row of data as { assignment_submission_id: string }[]) {
    counts[row.assignment_submission_id] = (counts[row.assignment_submission_id] ?? 0) + 1
  }
  return counts
}

export function validateSubmissionResourceTitle(raw: string): string | null {
  return raw.trim() ? null : 'กรุณากรอกชื่อที่แสดง'
}

/** Rejects anything but a well-formed `https://` URL — mirrors the
 * migration's own `assignment_submission_resources_url_https_check`. */
export function validateSubmissionResourceUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return 'กรุณากรอกลิงก์'
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return 'ลิงก์ไม่ถูกต้อง'
  }
  if (parsed.protocol !== 'https:') return 'รองรับเฉพาะลิงก์ที่ขึ้นต้นด้วย https:// เท่านั้น'
  return null
}

export function validateSubmissionTextContent(raw: string): string | null {
  return raw.trim() ? null : 'กรุณากรอกคำตอบ'
}

/** Thai error message for a rejected file, or null when the file passes
 * both the type-allowlist and size-limit checks. */
export function validateSubmissionResourceFile(file: File): string | null {
  if (!(file.type in FILE_TYPE_EXTENSIONS)) {
    return 'รองรับเฉพาะไฟล์ PDF, DOCX, PPTX, XLSX, JPG, PNG, WEBP หรือ ZIP เท่านั้น'
  }
  if (file.size > SUBMISSION_FILE_MAX_BYTES) {
    return 'ขนาดไฟล์ต้องไม่เกิน 25MB — สำหรับไฟล์ขนาดใหญ่ แนะนำให้แนบเป็นลิงก์ Google Drive แทน'
  }
  return null
}

/** `<random uuid>.<ext>` — never the original filename (collision-proof,
 * leaks nothing about the original name). `original_filename` is stored
 * separately in the resource row for display/audit only. */
export function generateSubmissionFileName(mimeType: string): string {
  const ext = FILE_TYPE_EXTENSIONS[mimeType] ?? 'bin'
  return `${crypto.randomUUID()}.${ext}`
}

/**
 * The exact 7-segment path convention from 0016:
 * '<teacherId>/<subjectId>/<classroomId>/<assignmentId>/<studentId>/
 * <submissionId>/<generated name>' — every storage RLS policy
 * authorizes purely off the submissionId segment (6th), so the other
 * segments exist for human-readable organization only, not security.
 */
export function buildSubmissionResourcePath(
  teacherId: string,
  subjectId: string,
  classroomId: string,
  assignmentId: string,
  studentId: string,
  submissionId: string,
  generatedName: string,
): string {
  return `${teacherId}/${subjectId}/${classroomId}/${assignmentId}/${studentId}/${submissionId}/${generatedName}`
}

export function computeNextSubmissionResourceSortOrder(existing: SubmissionResource[]): number {
  if (existing.length === 0) return 0
  return Math.max(...existing.map((r) => r.sortOrder)) + 1
}

/**
 * Uploads the file to the submission's own scoped storage path, then
 * records it. "No partial successful state" (Section 10): if the row
 * insert fails after a successful upload, the just-uploaded object is
 * removed again — an interrupted attach never leaves an orphaned file
 * NOR a resource row with no backing object.
 */
export async function addSubmissionFileResource(
  input: AddSubmissionFileInput,
  teacherId: string,
  subjectId: string,
  classroomId: string,
  assignmentId: string,
  studentId: string,
  sortOrder: number,
): Promise<SubmissionResource> {
  const fileError = validateSubmissionResourceFile(input.file)
  if (fileError) throw new Error(fileError)

  const supabase = getSupabaseClient()
  const fileName = generateSubmissionFileName(input.file.type)
  const path = buildSubmissionResourcePath(teacherId, subjectId, classroomId, assignmentId, studentId, input.submissionId, fileName)

  const { error: uploadError } = await supabase.storage
    .from(RESOURCE_BUCKET)
    .upload(path, input.file, { contentType: input.file.type, cacheControl: '3600' })
  if (uploadError) throw uploadError

  const { data, error } = await supabase
    .from('assignment_submission_resources')
    .insert({
      assignment_submission_id: input.submissionId,
      resource_type: 'file',
      title: input.title?.trim() || null,
      storage_path: path,
      original_filename: input.file.name,
      mime_type: input.file.type,
      file_size: input.file.size,
      sort_order: sortOrder,
    })
    .select('*')
    .single()

  if (error) {
    await supabase.storage.from(RESOURCE_BUCKET).remove([path]).catch(() => undefined)
    throw error
  }
  return mapResource(data as SubmissionResourceRow)
}

export async function addSubmissionLinkResource(input: AddSubmissionLinkInput, sortOrder: number): Promise<SubmissionResource> {
  const titleError = validateSubmissionResourceTitle(input.title)
  if (titleError) throw new Error(titleError)
  const urlError = validateSubmissionResourceUrl(input.url)
  if (urlError) throw new Error(urlError)

  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('assignment_submission_resources')
    .insert({
      assignment_submission_id: input.submissionId,
      resource_type: 'link',
      title: input.title.trim(),
      external_url: input.url.trim(),
      sort_order: sortOrder,
    })
    .select('*')
    .single()

  if (error) throw error
  return mapResource(data as SubmissionResourceRow)
}

export async function addSubmissionTextResource(input: AddSubmissionTextInput, sortOrder: number): Promise<SubmissionResource> {
  const textError = validateSubmissionTextContent(input.text)
  if (textError) throw new Error(textError)

  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('assignment_submission_resources')
    .insert({
      assignment_submission_id: input.submissionId,
      resource_type: 'text',
      title: input.title?.trim() || null,
      text_content: input.text.trim(),
      sort_order: sortOrder,
    })
    .select('*')
    .single()

  if (error) throw error
  return mapResource(data as SubmissionResourceRow)
}

/** A student removes their OWN, not-yet-cleaned-up resource (e.g. fixing
 * a wrongly-attached file before/while resubmitting) — RLS
 * (assignment_submission_resources_delete_student, 0016) denies this
 * once a teacher has cleaned it up (deleted_at set), which is frozen as
 * permanent history from that point on. */
export async function removeSubmissionResource(resource: SubmissionResource): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.from('assignment_submission_resources').delete().eq('id', resource.id)
  if (error) throw error

  if (resource.resourceType === 'file' && resource.storagePath) {
    await supabase.storage.from(RESOURCE_BUCKET).remove([resource.storagePath]).catch(() => undefined)
  }
}

/**
 * 'submission-files' is a PRIVATE bucket — every read (student
 * re-opening their own upload, teacher reviewing it) goes through a
 * short-lived signed URL gated by the caller's own RLS-checked SELECT
 * access to the underlying storage object.
 */
export async function getSubmissionResourceSignedUrl(storagePath: string, expiresInSeconds = 300): Promise<string> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.storage.from(RESOURCE_BUCKET).createSignedUrl(storagePath, expiresInSeconds)
  if (error) throw error
  return data.signedUrl
}

// ==================================================
// Teacher-only: manual file cleanup ("ล้างไฟล์งานที่ตรวจแล้ว", Section 9).
// Never automatic/scheduled — always one explicit call per resource,
// always after the caller's own UI confirmation dialog.
// ==================================================

/**
 * Removes ONLY the stored file — never the row, never any
 * score/status/submitted_at/note on the parent submission, never
 * original_filename/mime_type/file_size on this same row (kept for the
 * academic record). Storage is deleted FIRST; the row is only updated
 * (storage_path -> null, deleted_at -> now) once that actually
 * succeeds, so a failed storage removal never leaves the row claiming
 * "cleaned up" while the object still exists ("no partial successful
 * state", Section 10, applied symmetrically to cleanup).
 */
export async function cleanupSubmissionResourceFile(resource: SubmissionResource): Promise<SubmissionResource> {
  if (resource.resourceType !== 'file' || !resource.storagePath) {
    throw new Error('มีเฉพาะไฟล์ที่แนบเท่านั้นที่สามารถล้างได้')
  }

  const supabase = getSupabaseClient()
  const { error: removeError } = await supabase.storage.from(RESOURCE_BUCKET).remove([resource.storagePath])
  if (removeError) throw removeError

  const { data, error } = await supabase
    .from('assignment_submission_resources')
    .update({ storage_path: null, deleted_at: new Date().toISOString() })
    .eq('id', resource.id)
    .select('*')
    .single()

  if (error) throw error
  return mapResource(data as SubmissionResourceRow)
}
