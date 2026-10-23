/**
 * Pure model for the "ลบห้องเรียนถาวร" flow. The counts come from
 * get_classroom_deletion_preview (0032) — the server is the only source
 * of truth for what will be deleted; this module only validates the
 * payload and turns it into labelled Thai rows for the dialog.
 */

export const DELETED_COUNT_KEYS = [
  'enrollments',
  'subject_links',
  'assignments',
  'assignment_resources',
  'submissions',
  'graded_submissions',
  'submission_resources',
  'submission_events',
  'attendance_sessions',
  'attendance_records',
  'lessons',
  'lesson_resources',
  'sgs_columns',
  'sgs_scores',
  'followup_notes',
  'notifications',
] as const

export const PRESERVED_COUNT_KEYS = [
  'students',
  'students_only_in_this_classroom',
  'students_in_other_classrooms',
  'linked_student_accounts',
  'qr_identities',
  'subjects_linked',
  'other_classroom_submissions',
  'other_classroom_attendance_records',
] as const

export const FILE_COUNT_KEYS = ['storage_files', 'drive_files', 'files_referenced_elsewhere'] as const

const OTHER_COUNT_KEYS = ['foreign_subject_records'] as const

export type DeletionCountKey =
  | (typeof DELETED_COUNT_KEYS)[number]
  | (typeof PRESERVED_COUNT_KEYS)[number]
  | (typeof FILE_COUNT_KEYS)[number]
  | (typeof OTHER_COUNT_KEYS)[number]

export type DeletionCounts = Record<DeletionCountKey, number>

const ALL_COUNT_KEYS: readonly DeletionCountKey[] = [...DELETED_COUNT_KEYS, ...PRESERVED_COUNT_KEYS, ...FILE_COUNT_KEYS, ...OTHER_COUNT_KEYS]

export const COUNT_LABELS: Record<DeletionCountKey, string> = {
  enrollments: 'รายชื่อนักเรียนในห้องนี้ (การลงทะเบียน)',
  subject_links: 'การเชื่อมห้องนี้กับรายวิชา',
  assignments: 'งาน / การบ้าน',
  assignment_resources: 'ไฟล์แนบและลิงก์ของงาน (รายการอ้างอิง)',
  submissions: 'สถานะการส่งงานของนักเรียน',
  graded_submissions: 'คะแนนงานที่ให้แล้ว',
  submission_resources: 'ไฟล์และลิงก์ที่นักเรียนส่ง (รายการอ้างอิง)',
  submission_events: 'ประวัติการสแกน QR / แก้สถานะ',
  attendance_sessions: 'รอบการเช็คชื่อ',
  attendance_records: 'บันทึกการเช็คชื่อรายคน',
  lessons: 'บทเรียน',
  lesson_resources: 'สื่อการสอนของบทเรียน (รายการอ้างอิง)',
  sgs_columns: 'ช่องคะแนน SGS',
  sgs_scores: 'คะแนน SGS',
  followup_notes: 'บันทึกติดตามนักเรียน',
  notifications: 'การแจ้งเตือนที่เกี่ยวกับห้องนี้',
  students: 'นักเรียน — บัญชีนักเรียนไม่ถูกลบ',
  students_only_in_this_classroom: 'ในจำนวนนี้ ไม่มีห้องอื่นแล้ว (จะไม่อยู่ในห้องใด)',
  students_in_other_classrooms: 'ในจำนวนนี้ ยังเรียนอยู่ห้องอื่น',
  linked_student_accounts: 'บัญชีนักเรียนที่เชื่อมแล้ว',
  qr_identities: 'QR ประจำตัวนักเรียน (ใช้ต่อได้ทุกห้อง)',
  subjects_linked: 'รายวิชา (ลบเฉพาะการเชื่อมกับห้องนี้)',
  other_classroom_submissions: 'การส่งงานของนักเรียนกลุ่มนี้ในห้องอื่น',
  other_classroom_attendance_records: 'การเช็คชื่อของนักเรียนกลุ่มนี้ในห้องอื่น',
  storage_files: 'ไฟล์ที่อัปโหลดไว้ในระบบ',
  drive_files: 'ไฟล์ใน Google Drive',
  files_referenced_elsewhere: 'ไฟล์ที่ห้องอื่นยังใช้อยู่',
  foreign_subject_records: 'ข้อมูลในรายวิชาของครูคนอื่น',
}

export interface DeletionBlocker {
  code: string
  message: string
}

export interface DeletionPreviewClassroom {
  id: string
  name: string
  teacherId: string
  isActive: boolean
  academicYear: string | null
  semester: string | null
}

export interface ClassroomDeletionPreview {
  classroom: DeletionPreviewClassroom
  counts: DeletionCounts
  blockers: DeletionBlocker[]
  /** Opaque token: the server refuses the delete if the data changed since. */
  fingerprint: string
}

export class InvalidDeletionPreviewError extends Error {
  constructor() {
    super('ข้อมูลตัวอย่างการลบไม่สมบูรณ์ กรุณาลองใหม่อีกครั้ง')
    this.name = 'InvalidDeletionPreviewError'
  }
}

function toCount(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw new InvalidDeletionPreviewError()
  return n
}

/**
 * Validates the RPC payload. Anything missing or malformed is an error —
 * the dialog must never show a "0" it did not actually get from the server.
 */
export function parseDeletionPreview(raw: unknown): ClassroomDeletionPreview {
  const r = raw as {
    classroom?: { id?: unknown; name?: unknown; teacher_id?: unknown; is_active?: unknown; academic_year?: unknown; semester?: unknown }
    counts?: Record<string, unknown>
    blockers?: unknown
    fingerprint?: unknown
  } | null
  const c = r?.classroom
  if (!c || typeof c.id !== 'string' || typeof c.name !== 'string' || typeof c.teacher_id !== 'string' || typeof c.is_active !== 'boolean') {
    throw new InvalidDeletionPreviewError()
  }
  if (!r?.counts || typeof r.fingerprint !== 'string' || r.fingerprint.length === 0 || !Array.isArray(r.blockers)) {
    throw new InvalidDeletionPreviewError()
  }
  const counts = {} as DeletionCounts
  for (const key of ALL_COUNT_KEYS) counts[key] = toCount(r.counts[key])
  const blockers = r.blockers.map((b) => {
    const blocker = b as { code?: unknown; message?: unknown }
    if (typeof blocker?.code !== 'string' || typeof blocker.message !== 'string') throw new InvalidDeletionPreviewError()
    return { code: blocker.code, message: blocker.message }
  })
  return {
    classroom: {
      id: c.id,
      name: c.name,
      teacherId: c.teacher_id,
      isActive: c.is_active,
      academicYear: typeof c.academic_year === 'string' ? c.academic_year : null,
      semester: typeof c.semester === 'string' ? c.semester : null,
    },
    counts,
    blockers,
    fingerprint: r.fingerprint,
  }
}

export interface CountRow {
  key: DeletionCountKey
  label: string
  value: number
  /** Indented sub-row (a breakdown of the row above). */
  nested?: boolean
}

const NESTED_KEYS: ReadonlySet<DeletionCountKey> = new Set(['graded_submissions', 'students_only_in_this_classroom', 'students_in_other_classrooms'])

function rows(keys: readonly DeletionCountKey[], counts: DeletionCounts, hideZero: boolean): CountRow[] {
  return keys
    .filter((key) => !hideZero || counts[key] > 0)
    .map((key) => ({ key, label: COUNT_LABELS[key], value: counts[key], nested: NESTED_KEYS.has(key) || undefined }))
}

/** What will be deleted — zero rows hidden (an empty classroom shows none). */
export function deletedRows(counts: DeletionCounts): CountRow[] {
  return rows(DELETED_COUNT_KEYS, counts, true)
}

/** What is kept — always shown, so the teacher sees students/QR are safe. */
export function preservedRows(counts: DeletionCounts): CountRow[] {
  return rows(PRESERVED_COUNT_KEYS, counts, false).filter((row) => !row.nested || counts.students > 0)
}

export function fileRows(counts: DeletionCounts): CountRow[] {
  return rows(FILE_COUNT_KEYS, counts, false)
}

/** Every record the delete removes (graded_submissions is a subset of submissions). */
export function totalDeletedRecords(counts: DeletionCounts): number {
  return DELETED_COUNT_KEYS.filter((key) => key !== 'graded_submissions').reduce((sum, key) => sum + counts[key], 0)
}

export function hasFiles(counts: DeletionCounts): boolean {
  return counts.storage_files + counts.drive_files > 0
}

/** Exact match, as the server checks it: no trimming, no case folding. */
export function isConfirmationNameMatch(typed: string, classroomName: string): boolean {
  return typed === classroomName
}

export function canDelete(preview: ClassroomDeletionPreview): boolean {
  return preview.blockers.length === 0 && !preview.classroom.isActive
}

/** Toast after the server confirmed the delete. */
export function deletedToast(name: string, queuedFiles: number): string {
  return queuedFiles > 0
    ? `ลบห้อง "${name}" ถาวรแล้ว — บันทึกรายการไฟล์ ${queuedFiles} รายการไว้ให้ผู้ดูแลระบบตรวจสอบ (ยังไม่ได้ลบไฟล์)`
    : `ลบห้อง "${name}" ถาวรแล้ว`
}
