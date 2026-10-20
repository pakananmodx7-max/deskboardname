import type { Assignment, AssignmentSubmission, SubmissionStatus } from '@/types/assignment'

/**
 * QR submission scanning — pure model (no DOM, no network). Everything
 * the scanner screen decides or displays goes through here so it can be
 * tested without a camera, a scanner or a database.
 */

/** Dates are stored as UTC timestamps and always shown in school time. */
export const SCHOOL_TIME_ZONE = 'Asia/Bangkok'
/** Asia/Bangkok has no daylight saving time. */
const SCHOOL_UTC_OFFSET = '+07:00'

// ==================================================
// Deadlines
// ==================================================

/**
 * The instant after which a submission is late — the same rule as the
 * database (assignment_effective_deadline, migration 0030): the exact
 * submissionDeadline, else 23:59:59 of dueDate in school time, else none.
 */
export function effectiveDeadline(assignment: Pick<Assignment, 'submissionDeadline' | 'dueDate'>): Date | null {
  if (assignment.submissionDeadline) return new Date(assignment.submissionDeadline)
  if (assignment.dueDate) return new Date(`${assignment.dueDate}T23:59:59${SCHOOL_UTC_OFFSET}`)
  return null
}

/** `<input type="datetime-local">` value (school time) → ISO timestamp. */
export function schoolLocalInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const date = new Date(`${value}:00${SCHOOL_UTC_OFFSET}`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** ISO timestamp → `<input type="datetime-local">` value in school time. */
export function isoToSchoolLocalInput(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHOOL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

const THAI_DATE_TIME = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: SCHOOL_TIME_ZONE,
})
const THAI_TIME = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: SCHOOL_TIME_ZONE })

export function formatThaiDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '-'
  const date = typeof iso === 'string' ? new Date(iso) : iso
  return Number.isNaN(date.getTime()) ? '-' : `${THAI_DATE_TIME.format(date)} น.`
}

export function formatThaiTime(iso: string | Date | null | undefined): string {
  if (!iso) return '-'
  const date = typeof iso === 'string' ? new Date(iso) : iso
  return Number.isNaN(date.getTime()) ? '-' : `${THAI_TIME.format(date)} น.`
}

/** One line describing when/whether the assignment accepts work. */
export function describeSubmissionWindow(assignment: Pick<Assignment, 'submissionDeadline' | 'dueDate' | 'latePolicy' | 'acceptingSubmissions' | 'isArchived'>): string {
  if (assignment.isArchived) return 'งานนี้ถูกเก็บถาวรแล้ว — ไม่รับงาน'
  if (!assignment.acceptingSubmissions) return 'ปิดรับงานแล้ว'
  const deadline = effectiveDeadline(assignment)
  if (!deadline) return 'เปิดรับงาน · ไม่มีกำหนดส่ง'
  const policy = assignment.latePolicy === 'reject_late' ? 'ไม่รับงานหลังกำหนด' : 'หลังกำหนดบันทึกเป็นส่งช้า'
  return `กำหนดส่ง ${formatThaiDateTime(deadline)} · ${policy}`
}

// ==================================================
// Status / score display (status and score are separate)
// ==================================================

export type StatusTone = 'success' | 'warning' | 'muted' | 'danger' | 'neutral'

export interface StatusDisplay {
  label: string
  tone: StatusTone
}

/**
 * Submission status in words. 'submitted' only reads "ส่งตรงเวลา" when
 * there is evidence (a deadline and a submission time before it) —
 * historical rows without a timestamp, or assignments without a
 * deadline, read the neutral "ส่งแล้ว", never a guessed on-time/late.
 */
export function submissionStatusDisplay(
  submission: Pick<AssignmentSubmission, 'status' | 'submittedAt'> | null | undefined,
  assignment: Pick<Assignment, 'submissionDeadline' | 'dueDate'>,
): StatusDisplay {
  const status: SubmissionStatus = submission?.status ?? 'not_submitted'
  switch (status) {
    case 'late':
      return { label: 'ส่งช้า', tone: 'warning' }
    case 'excused':
      return { label: 'ยกเว้น', tone: 'neutral' }
    case 'missing':
      return { label: 'ขาดส่ง', tone: 'danger' }
    case 'not_submitted':
      return { label: 'ยังไม่ส่ง', tone: 'muted' }
    case 'submitted': {
      const deadline = effectiveDeadline(assignment)
      const at = submission?.submittedAt ? new Date(submission.submittedAt) : null
      if (deadline && at && at.getTime() <= deadline.getTime()) return { label: 'ส่งตรงเวลา', tone: 'success' }
      return { label: 'ส่งแล้ว', tone: 'success' }
    }
  }
}

/** Score text next to the status — never derived from the status. */
export function scoreDisplay(submission: Pick<AssignmentSubmission, 'status' | 'score'> | null | undefined, maxScore: number): string {
  if (submission?.score !== null && submission?.score !== undefined) return `${submission.score}/${maxScore}`
  const status = submission?.status ?? 'not_submitted'
  if (status === 'submitted' || status === 'late') return 'ยังไม่ตรวจคะแนน'
  if (status === 'excused') return 'ไม่ต้องส่ง'
  return 'ไม่มีการส่งงาน'
}

export interface SubmissionCounts {
  total: number
  onTime: number
  submitted: number
  late: number
  notSubmitted: number
  missing: number
  excused: number
}

/** Counts for the roster of ONE assignment ("ส่งแล้ว" = on time + late +
 * submitted without timing evidence). */
export function countSubmissions(
  studentIds: string[],
  submissions: Record<string, Pick<AssignmentSubmission, 'status' | 'submittedAt'>>,
  assignment: Pick<Assignment, 'submissionDeadline' | 'dueDate'>,
): SubmissionCounts {
  const counts: SubmissionCounts = { total: studentIds.length, onTime: 0, submitted: 0, late: 0, notSubmitted: 0, missing: 0, excused: 0 }
  for (const id of studentIds) {
    const submission = submissions[id]
    const status = submission?.status ?? 'not_submitted'
    if (status === 'submitted') {
      counts.submitted += 1
      if (submissionStatusDisplay(submission, assignment).label === 'ส่งตรงเวลา') counts.onTime += 1
    } else if (status === 'late') {
      counts.submitted += 1
      counts.late += 1
    } else if (status === 'excused') counts.excused += 1
    else if (status === 'missing') counts.missing += 1
    else counts.notSubmitted += 1
  }
  return counts
}

// ==================================================
// Server results
// ==================================================

export type ScanOutcome =
  | 'recorded'
  | 'duplicate'
  | 'excused'
  | 'invalid_qr'
  | 'revoked_qr'
  | 'not_in_roster'
  | 'assignment_closed'
  | 'deadline_passed'

export interface ScannedStudent {
  id: string
  firstName: string
  lastName: string
  number: number | null
  studentCode: string | null
  avatarPath: string | null
}

export interface ScanResultSubmission {
  id: string
  status: SubmissionStatus
  submittedAt: string | null
  score: number | null
}

export interface ScanResult {
  outcome: ScanOutcome
  serverTime: string | null
  deadline: string | null
  student: ScannedStudent | null
  submission: ScanResultSubmission | null
}

const OUTCOMES: ReadonlySet<string> = new Set(['recorded', 'duplicate', 'excused', 'invalid_qr', 'revoked_qr', 'not_in_roster', 'assignment_closed', 'deadline_passed'])
const STATUSES: ReadonlySet<string> = new Set(['not_submitted', 'submitted', 'late', 'missing', 'excused'])

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

/** Validates the RPC's jsonb result; anything unexpected is an error,
 * never a success. */
export function parseScanResult(raw: unknown): ScanResult {
  const r = (raw ?? {}) as Record<string, unknown>
  const outcome = str(r.outcome)
  if (!outcome || !OUTCOMES.has(outcome)) throw new Error('ผลลัพธ์จากเซิร์ฟเวอร์ไม่ถูกต้อง')
  const s = r.student as Record<string, unknown> | null | undefined
  const sub = r.submission as Record<string, unknown> | null | undefined
  const subStatus = sub ? str(sub.status) : null
  return {
    outcome: outcome as ScanOutcome,
    serverTime: str(r.server_time),
    deadline: str(r.deadline),
    student:
      s && str(s.id)
        ? {
            id: str(s.id)!,
            firstName: str(s.first_name) ?? '',
            lastName: str(s.last_name) ?? '',
            number: num(s.number),
            studentCode: str(s.student_code),
            avatarPath: str(s.avatar_path),
          }
        : null,
    submission:
      sub && str(sub.id) && subStatus && STATUSES.has(subStatus)
        ? { id: str(sub.id)!, status: subStatus as SubmissionStatus, submittedAt: str(sub.submitted_at), score: num(sub.score) }
        : null,
  }
}

export type FeedbackKind = 'success' | 'warning' | 'error'

export interface ScanFeedback {
  kind: FeedbackKind
  title: string
  detail: string
}

/** What the teacher sees (and hears) after the server answers. Only
 * 'recorded' is a success — the UI never says "saved" before this. */
export function feedbackFor(result: ScanResult, assignment: Pick<Assignment, 'submissionDeadline' | 'dueDate' | 'title'>): ScanFeedback {
  const name = result.student ? `${result.student.firstName} ${result.student.lastName}`.trim() : ''
  const at = result.submission?.submittedAt ? formatThaiTime(result.submission.submittedAt) : ''
  switch (result.outcome) {
    case 'recorded': {
      const status = submissionStatusDisplay(result.submission, assignment).label
      return { kind: 'success', title: `บันทึกแล้ว: ${name}`, detail: `${status}${at ? ` · ${at}` : ''} · ${assignment.title}` }
    }
    case 'duplicate':
      return {
        kind: 'warning',
        title: `ส่งแล้วก่อนหน้านี้: ${name}`,
        detail: result.submission?.submittedAt ? `บันทึกไว้เมื่อ ${formatThaiDateTime(result.submission.submittedAt)} — ไม่มีการเปลี่ยนแปลง` : 'บันทึกไว้แล้ว — ไม่มีการเปลี่ยนแปลง',
      }
    case 'excused':
      return { kind: 'warning', title: `ยกเว้นการส่งงาน: ${name}`, detail: 'นักเรียนคนนี้ได้รับการยกเว้นงานนี้ — ไม่มีการเปลี่ยนแปลง' }
    case 'invalid_qr':
      return { kind: 'error', title: 'QR ไม่ถูกต้อง', detail: 'ไม่ใช่ QR ประจำตัวนักเรียนของ KrunameClass' }
    case 'revoked_qr':
      return { kind: 'error', title: 'QR นี้ถูกยกเลิกแล้ว', detail: name ? `${name} มี QR ใหม่แล้ว — ให้ใช้บัตรใบใหม่` : 'ให้นักเรียนใช้ QR ใบใหม่' }
    case 'not_in_roster':
      return { kind: 'error', title: 'ไม่พบนักเรียนในห้องนี้', detail: 'QR นี้เป็นของนักเรียนที่ไม่ได้อยู่ในห้องเรียนของงานนี้' }
    case 'assignment_closed':
      return { kind: 'error', title: 'งานนี้ปิดรับแล้ว', detail: `${name ? `${name} · ` : ''}เปิดรับงานได้ที่ “ตั้งค่าการรับงาน”` }
    case 'deadline_passed':
      return { kind: 'error', title: 'เลยกำหนดส่งแล้ว', detail: `${name ? `${name} · ` : ''}งานนี้ไม่รับงานหลังกำหนด` }
  }
}

/** Merge a confirmed server submission into the local roster state. */
export function applyScanResult(
  submissions: Record<string, AssignmentSubmission>,
  result: ScanResult,
): Record<string, AssignmentSubmission> {
  if (!result.student || !result.submission) return submissions
  const previous = submissions[result.student.id]
  return {
    ...submissions,
    [result.student.id]: {
      studentId: result.student.id,
      id: result.submission.id,
      status: result.submission.status,
      score: result.submission.score,
      note: previous?.note ?? null,
      submittedAt: result.submission.submittedAt,
      reviewedAt: previous?.reviewedAt ?? null,
    },
  }
}

// ==================================================
// Duplicate suppression for rapid input
// ==================================================

/** The same payload read again within this window is the same physical
 * scan (camera frames, a scanner's double trigger) — ignored locally. */
export const SAME_SCAN_WINDOW_MS = 2500

export interface RecentScan {
  key: string
  at: number
}

export function isRepeatScan(recent: RecentScan | null, key: string, now: number): boolean {
  return recent !== null && recent.key === key && now - recent.at < SAME_SCAN_WINDOW_MS
}

/** A QR the camera keeps seeing is still the same scan; it may count again
 * only after it has been out of view this long. */
export const CAMERA_OUT_OF_VIEW_MS = 1500

/** Camera frames: true while the same code stays continuously in view.
 * Returns the updated "last seen" record to keep. */
export function cameraStillInView(previous: RecentScan | null, key: string, now: number): { stillInView: boolean; next: RecentScan } {
  const stillInView = previous !== null && previous.key === key && now - previous.at < CAMERA_OUT_OF_VIEW_MS
  return { stillInView, next: { key, at: now } }
}

// ==================================================
// Search
// ==================================================

export function matchesStudentQuery(student: { firstName: string; lastName: string; number: number | null; studentCode: string | null; nickname?: string | null }, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = [student.firstName, student.lastName, `${student.firstName} ${student.lastName}`, student.nickname ?? '', student.studentCode ?? '', student.number === null ? '' : String(student.number)]
  return haystack.some((value) => value.toLowerCase().includes(q))
}
