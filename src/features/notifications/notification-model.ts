import { buildAssignmentDetailPath, buildStudentAssignmentDetailPath } from '@/features/subjects-shared/subject-classroom-nav'

/**
 * In-app notifications (header bell) — pure model shared by the teacher
 * bell, the student bell and Demo Mode. Rows come from public.notifications
 * (0029_notifications.sql, created only by server-side triggers) plus, for
 * students, teacher messages from teacher_student_notifications (0012).
 */

export type NotificationType =
  // teacher
  | 'assignment_submitted'
  | 'assignment_resubmitted'
  | 'link_request'
  | 'deadline_teacher'
  // student
  | 'link_approved'
  | 'link_rejected'
  | 'assignment_published'
  | 'submission_graded'
  | 'deadline_student'
  | 'teacher_message'

/** Where a row lives: the notifications table, the 0012 messages table,
 * or the in-memory Demo Mode feed. Decides which "mark read" call runs. */
export type NotificationOrigin = 'app' | 'message' | 'demo'

export interface AppNotification {
  id: string
  type: NotificationType
  title: string
  body: string | null
  entityType: string | null
  entityId: string | null
  metadata: Record<string, unknown>
  readAt: string | null
  createdAt: string
  origin: NotificationOrigin
}

export const NOTIFICATION_PAGE_SIZE = 20

const KNOWN_TYPES: ReadonlySet<string> = new Set<NotificationType>([
  'assignment_submitted',
  'assignment_resubmitted',
  'link_request',
  'deadline_teacher',
  'link_approved',
  'link_rejected',
  'assignment_published',
  'submission_graded',
  'deadline_student',
  'teacher_message',
])

export function isKnownNotificationType(value: unknown): value is NotificationType {
  return typeof value === 'string' && KNOWN_TYPES.has(value)
}

// ==================================================
// Row mapping
// ==================================================

export interface NotificationRow {
  id: string
  notification_type: string
  title: string
  body: string | null
  entity_type: string | null
  entity_id: string | null
  metadata: Record<string, unknown> | null
  read_at: string | null
  created_at: string
}

/** null for a type this build does not know (a newer server) — skipped
 * rather than rendered wrongly. */
export function mapNotificationRow(row: NotificationRow): AppNotification | null {
  if (!isKnownNotificationType(row.notification_type)) return null
  return {
    id: row.id,
    type: row.notification_type,
    title: row.title,
    body: row.body,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    readAt: row.read_at,
    createdAt: row.created_at,
    origin: 'app',
  }
}

// ==================================================
// Formatting
// ==================================================

/** Badge text: nothing for 0, "99+" above 99. */
export function formatUnreadBadge(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null
  return count > 99 ? '99+' : String(Math.floor(count))
}

const THAI_DATE = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok' })
const THAI_DATE_TIME = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })

/** "เมื่อสักครู่", "5 นาทีที่แล้ว", "3 ชั่วโมงที่แล้ว", "เมื่อวาน",
 * "4 วันที่แล้ว", then a short Thai date. */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return ''
  const seconds = Math.max(0, Math.round((now.getTime() - time) / 1000))
  if (seconds < 60) return 'เมื่อสักครู่'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'เมื่อวาน'
  if (days < 7) return `${days} วันที่แล้ว`
  return THAI_DATE.format(new Date(time))
}

export function formatThaiDateTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : `${THAI_DATE_TIME.format(date)} น.`
}

function formatDueDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null
  return THAI_DATE.format(new Date(`${value.slice(0, 10)}T12:00:00+07:00`))
}

function text(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function num(meta: Record<string, unknown>, key: string): number | null {
  const value = meta[key]
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) ? n : null
}

function formatScore(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)))
}

export type NotificationTone = 'primary' | 'success' | 'warning' | 'danger' | 'info'
export type NotificationIcon = 'submission' | 'resubmission' | 'request' | 'approved' | 'rejected' | 'assignment' | 'graded' | 'deadline' | 'message'

export interface NotificationView {
  title: string
  description: string
  details: string[]
  icon: NotificationIcon
  tone: NotificationTone
  /** Live approval status for a link-request notification. */
  status: { label: string; tone: NotificationTone } | null
}

const REQUEST_STATUS: Record<string, { label: string; tone: NotificationTone }> = {
  pending: { label: 'รออนุมัติ', tone: 'warning' },
  approved: { label: 'อนุมัติแล้ว', tone: 'success' },
  rejected: { label: 'ปฏิเสธแล้ว', tone: 'danger' },
}

/** Concise, display-ready text built from the row's metadata (falling
 * back to the stored title/body when a detail is missing). */
export function describeNotification(n: AppNotification): NotificationView {
  const m = n.metadata
  const student = text(m, 'student_name')
  const assignment = text(m, 'assignment_title')
  const subject = text(m, 'subject_name')
  const classroom = text(m, 'classroom_name')
  const fallback = n.body ?? ''
  const where = [subject, classroom].filter(Boolean).join(' · ')

  switch (n.type) {
    case 'assignment_submitted':
    case 'assignment_resubmitted': {
      const submittedAt = text(m, 'submitted_at')
      const resubmitted = n.type === 'assignment_resubmitted'
      return {
        title: resubmitted ? 'ส่งงานแก้ไขใหม่ — รอตรวจ' : 'ส่งงานใหม่ — รอตรวจ',
        description: student && assignment ? `${student} ${resubmitted ? 'ส่งงานแก้ไข' : 'ส่งงาน'} “${assignment}”` : fallback,
        details: [where, submittedAt ? `ส่งเมื่อ ${formatThaiDateTime(submittedAt)}${m.late === true ? ' (ส่งช้า)' : ''}` : ''].filter(Boolean),
        icon: resubmitted ? 'resubmission' : 'submission',
        tone: 'primary',
        status: null,
      }
    }
    case 'link_request': {
      const status = text(m, 'status') ?? 'pending'
      const classrooms = text(m, 'classroom_names')
      const requestedAt = text(m, 'requested_at')
      return {
        title: 'คำขอเชื่อมบัญชีนักเรียน',
        description: student ? `${student} ขอเชื่อมบัญชีนักเรียน` : fallback,
        details: [classrooms ? `ห้อง ${classrooms}` : '', requestedAt ? `ขอเมื่อ ${formatThaiDateTime(requestedAt)}` : ''].filter(Boolean),
        icon: 'request',
        tone: 'warning',
        status: REQUEST_STATUS[status] ?? REQUEST_STATUS.pending,
      }
    }
    case 'deadline_teacher':
    case 'deadline_student': {
      const due = formatDueDate(m.due_date)
      const pending = num(m, 'pending_count')
      return {
        title: n.title,
        description: assignment ? `“${assignment}”` : fallback,
        details: [where, due ? `ครบกำหนด ${due}` : '', n.type === 'deadline_teacher' && pending !== null ? `ยังไม่ส่ง ${pending} คน` : n.type === 'deadline_student' ? 'ยังไม่ได้ส่งงาน' : ''].filter(Boolean),
        icon: 'deadline',
        tone: 'warning',
        status: null,
      }
    }
    case 'link_approved':
      return { title: 'บัญชีได้รับการอนุมัติแล้ว', description: fallback || 'ครูอนุมัติการเชื่อมบัญชีของคุณแล้ว', details: [], icon: 'approved', tone: 'success', status: null }
    case 'link_rejected':
      return { title: 'คำขอเชื่อมบัญชีถูกปฏิเสธ', description: fallback || 'ครูปฏิเสธคำขอเชื่อมบัญชีของคุณ', details: [], icon: 'rejected', tone: 'danger', status: null }
    case 'assignment_published': {
      const due = formatDueDate(m.due_date)
      return {
        title: 'มีงานใหม่',
        description: assignment ? `“${assignment}”` : fallback,
        details: [subject ?? '', due ? `ครบกำหนด ${due}` : ''].filter(Boolean),
        icon: 'assignment',
        tone: 'info',
        status: null,
      }
    }
    case 'submission_graded': {
      const score = num(m, 'score')
      const max = num(m, 'max_score')
      return {
        title: 'ครูตรวจงานแล้ว',
        description: assignment ? `“${assignment}”` : fallback,
        details: [subject ?? '', score !== null ? `ได้ ${formatScore(score)}${max !== null ? `/${formatScore(max)}` : ''} คะแนน` : ''].filter(Boolean),
        icon: 'graded',
        tone: 'success',
        status: null,
      }
    }
    case 'teacher_message': {
      const sender = text(m, 'sender_name')
      return { title: n.title || 'ข้อความจากครู', description: fallback, details: sender ? [`จาก ${sender}`] : [], icon: 'message', tone: 'info', status: null }
    }
  }
}

// ==================================================
// Navigation
// ==================================================

/** UUIDs and demo ids only — never a path fragment. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

function id(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key]
  return typeof value === 'string' && SAFE_ID.test(value) ? value : null
}

export const TEACHER_LINK_REQUESTS_PATH = '/teacher/students/requests'

/** Where clicking a notification goes. Never an action — opening a
 * request notification only shows the existing approval page. */
export function notificationTarget(n: AppNotification): string {
  const m = n.metadata
  const subjectId = id(m, 'subject_id')
  const classroomId = id(m, 'classroom_id')
  const assignmentId = id(m, 'assignment_id')
  switch (n.type) {
    case 'assignment_submitted':
    case 'assignment_resubmitted': {
      if (!subjectId || !classroomId || !assignmentId) return '/teacher/subjects'
      const studentId = id(m, 'student_id')
      return `${buildAssignmentDetailPath(subjectId, classroomId, assignmentId)}${studentId ? `?student=${studentId}` : ''}`
    }
    case 'deadline_teacher':
      return subjectId && classroomId && assignmentId ? buildAssignmentDetailPath(subjectId, classroomId, assignmentId) : '/teacher/subjects'
    case 'link_request':
      return TEACHER_LINK_REQUESTS_PATH
    case 'link_approved':
    case 'teacher_message':
      return '/student/dashboard'
    case 'link_rejected':
      return '/student/link-account'
    case 'assignment_published':
    case 'submission_graded':
    case 'deadline_student':
      return subjectId && assignmentId ? buildStudentAssignmentDetailPath(subjectId, assignmentId) : '/student/subjects'
  }
}

// ==================================================
// Feed state (pure reducer — dedupe, ordering, unread count)
// ==================================================

export function compareNotifications(a: AppNotification, b: AppNotification): number {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
}

export type FeedStatus = 'loading' | 'ready' | 'error' | 'unavailable'
export type FeedConnection = 'none' | 'connecting' | 'live' | 'offline'

export interface NotificationFeedState {
  status: FeedStatus
  error: string | null
  items: AppNotification[]
  hasMore: boolean
  loadingMore: boolean
  unreadCount: number
  connection: FeedConnection
}

export const INITIAL_FEED_STATE: NotificationFeedState = {
  status: 'loading',
  error: null,
  items: [],
  hasMore: false,
  loadingMore: false,
  unreadCount: 0,
  connection: 'none',
}

export type NotificationFeedAction =
  | { type: 'reset' }
  | { type: 'loaded'; items: AppNotification[]; hasMore: boolean; unreadCount: number }
  | { type: 'failed'; error: string }
  | { type: 'unavailable' }
  | { type: 'loadingMore'; value: boolean }
  | { type: 'pageLoaded'; items: AppNotification[]; hasMore: boolean }
  /** Live or resync rows. `adjustCount` (live events) applies the unread
   * change immediately; resync leaves the count to `setUnread`. */
  | { type: 'upsert'; items: AppNotification[]; adjustCount: boolean }
  | { type: 'markRead'; ids: string[]; at: string }
  | { type: 'markAllRead'; at: string }
  | { type: 'setUnread'; count: number }
  | { type: 'connection'; value: FeedConnection }

function mergeById(current: AppNotification[], incoming: AppNotification[]): AppNotification[] {
  const byId = new Map(current.map((n) => [n.id, n]))
  for (const n of incoming) byId.set(n.id, n)
  return [...byId.values()].sort(compareNotifications)
}

export function notificationFeedReducer(state: NotificationFeedState, action: NotificationFeedAction): NotificationFeedState {
  switch (action.type) {
    case 'reset':
      return { ...INITIAL_FEED_STATE, connection: state.connection }
    case 'loaded':
      return { ...state, status: 'ready', error: null, items: mergeById([], action.items), hasMore: action.hasMore, unreadCount: Math.max(0, action.unreadCount), loadingMore: false }
    case 'failed':
      return { ...state, status: state.items.length > 0 ? 'ready' : 'error', error: action.error, loadingMore: false }
    case 'unavailable':
      return { ...INITIAL_FEED_STATE, status: 'unavailable', connection: 'none' }
    case 'loadingMore':
      return { ...state, loadingMore: action.value }
    case 'pageLoaded':
      return { ...state, items: mergeById(state.items, action.items), hasMore: action.hasMore, loadingMore: false }
    case 'upsert': {
      if (action.items.length === 0) return state
      let delta = 0
      if (action.adjustCount) {
        const known = new Map(state.items.map((n) => [n.id, n]))
        for (const n of action.items) {
          const before = known.get(n.id)
          const wasUnread = before ? before.readAt === null : false
          const isUnread = n.readAt === null
          if (wasUnread !== isUnread) delta += isUnread ? 1 : -1
          known.set(n.id, n)
        }
      }
      return { ...state, items: mergeById(state.items, action.items), unreadCount: Math.max(0, state.unreadCount + delta) }
    }
    case 'markRead': {
      const ids = new Set(action.ids)
      let changed = 0
      const items = state.items.map((n) => {
        if (!ids.has(n.id) || n.readAt !== null) return n
        changed += 1
        return { ...n, readAt: action.at }
      })
      return changed === 0 ? state : { ...state, items, unreadCount: Math.max(0, state.unreadCount - changed) }
    }
    case 'markAllRead':
      return { ...state, items: state.items.map((n) => (n.readAt === null ? { ...n, readAt: action.at } : n)), unreadCount: 0 }
    case 'setUnread':
      return { ...state, unreadCount: Math.max(0, action.count) }
    case 'connection':
      return state.connection === action.value ? state : { ...state, connection: action.value }
  }
}

export type NotificationFilter = 'all' | 'unread'

export function filterNotifications(items: AppNotification[], filter: NotificationFilter): AppNotification[] {
  return filter === 'unread' ? items.filter((n) => n.readAt === null) : items
}

// ==================================================
// Student bell: teacher messages (0012) merged into the same list
// ==================================================

export interface TeacherMessageLike {
  id: string
  senderName: string
  title: string | null
  message: string
  readAt: string | null
  createdAt: string
}

export function teacherMessageToNotification(m: TeacherMessageLike): AppNotification {
  return {
    id: m.id,
    type: 'teacher_message',
    title: m.title?.trim() || 'ข้อความจากครู',
    body: m.message,
    entityType: null,
    entityId: null,
    metadata: { sender_name: m.senderName },
    readAt: m.readAt,
    createdAt: m.createdAt,
    origin: 'message',
  }
}

/** One newest-first list from both stores; ids are namespaced by origin
 * so the two tables can never collide. */
export function mergeStudentFeeds(app: AppNotification[], messages: TeacherMessageLike[]): AppNotification[] {
  const seen = new Set<string>()
  const out: AppNotification[] = []
  for (const n of [...app, ...messages.map(teacherMessageToNotification)]) {
    const k = `${n.origin}:${n.id}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(n)
  }
  return out.sort(compareNotifications)
}
