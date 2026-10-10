import { describe, expect, it } from 'vitest'

import {
  describeNotification,
  filterNotifications,
  formatRelativeTime,
  formatUnreadBadge,
  INITIAL_FEED_STATE,
  mapNotificationRow,
  mergeStudentFeeds,
  notificationFeedReducer,
  notificationTarget,
  TEACHER_LINK_REQUESTS_PATH,
  type AppNotification,
  type NotificationFeedState,
} from './notification-model'

const SUBJECT = '0f4c2d9e-1a2b-4c3d-8e9f-001122334455'
const CLASSROOM = 'a1b2c3d4-e5f6-4a7b-8c9d-aabbccddeeff'
const ASSIGNMENT = '11111111-2222-4333-8444-555555555555'
const STUDENT = '99999999-8888-4777-8666-555555555555'

function notification(patch: Partial<AppNotification> & { id: string }): AppNotification {
  return {
    type: 'assignment_submitted',
    title: 'ส่งงานใหม่ — รอตรวจ',
    body: null,
    entityType: 'assignment_submission',
    entityId: null,
    metadata: {},
    readAt: null,
    createdAt: '2026-10-10T03:00:00.000Z',
    origin: 'app',
    ...patch,
  }
}

const SUBMISSION = notification({
  id: 'n1',
  metadata: {
    student_id: STUDENT,
    student_name: 'สมชาย ใจดี',
    assignment_id: ASSIGNMENT,
    assignment_title: 'รายงานการทดลอง',
    subject_id: SUBJECT,
    subject_name: 'วิทยาศาสตร์',
    classroom_id: CLASSROOM,
    classroom_name: 'ม.4/1',
    submitted_at: '2026-10-10T02:58:00.000Z',
    late: false,
  },
})

describe('unread badge', () => {
  it('hidden at 0, exact up to 99, "99+" above', () => {
    expect(formatUnreadBadge(0)).toBeNull()
    expect(formatUnreadBadge(-2)).toBeNull()
    expect(formatUnreadBadge(1)).toBe('1')
    expect(formatUnreadBadge(99)).toBe('99')
    expect(formatUnreadBadge(100)).toBe('99+')
    expect(formatUnreadBadge(4321)).toBe('99+')
  })
})

describe('relative time (Thai)', () => {
  const now = new Date('2026-10-10T12:00:00.000Z')
  it('seconds, minutes, hours, yesterday, days, then a date', () => {
    expect(formatRelativeTime('2026-10-10T11:59:30.000Z', now)).toBe('เมื่อสักครู่')
    expect(formatRelativeTime('2026-10-10T11:55:00.000Z', now)).toBe('5 นาทีที่แล้ว')
    expect(formatRelativeTime('2026-10-10T09:00:00.000Z', now)).toBe('3 ชั่วโมงที่แล้ว')
    expect(formatRelativeTime('2026-10-09T10:00:00.000Z', now)).toBe('เมื่อวาน')
    expect(formatRelativeTime('2026-10-06T10:00:00.000Z', now)).toBe('4 วันที่แล้ว')
    expect(formatRelativeTime('2026-09-01T10:00:00.000Z', now)).toMatch(/ก\.ย\./)
    // A clock slightly behind the server never shows a negative time.
    expect(formatRelativeTime('2026-10-10T12:00:20.000Z', now)).toBe('เมื่อสักครู่')
  })
})

describe('display text', () => {
  it('submission: student, classroom, subject, assignment and submission time', () => {
    const view = describeNotification(SUBMISSION)
    expect(view.title).toBe('ส่งงานใหม่ — รอตรวจ')
    expect(view.description).toBe('สมชาย ใจดี ส่งงาน “รายงานการทดลอง”')
    expect(view.details[0]).toBe('วิทยาศาสตร์ · ม.4/1')
    expect(view.details[1]).toMatch(/^ส่งเมื่อ .*น\.$/)
  })

  it('resubmission and late submission are labelled', () => {
    const view = describeNotification({ ...SUBMISSION, type: 'assignment_resubmitted', metadata: { ...SUBMISSION.metadata, late: true } })
    expect(view.title).toBe('ส่งงานแก้ไขใหม่ — รอตรวจ')
    expect(view.description).toContain('ส่งงานแก้ไข')
    expect(view.details[1]).toContain('(ส่งช้า)')
  })

  it('link request: student, requested classroom, time and live approval status', () => {
    const base = notification({ id: 'r1', type: 'link_request', metadata: { student_name: 'มานี มีนา', classroom_names: 'ม.4/1', requested_at: '2026-10-10T01:00:00Z', status: 'pending' } })
    const view = describeNotification(base)
    expect(view.description).toBe('มานี มีนา ขอเชื่อมบัญชีนักเรียน')
    expect(view.details[0]).toBe('ห้อง ม.4/1')
    expect(view.details[1]).toMatch(/^ขอเมื่อ /)
    expect(view.status?.label).toBe('รออนุมัติ')
    expect(describeNotification({ ...base, metadata: { ...base.metadata, status: 'approved' } }).status?.label).toBe('อนุมัติแล้ว')
    expect(describeNotification({ ...base, metadata: { ...base.metadata, status: 'rejected' } }).status?.label).toBe('ปฏิเสธแล้ว')
  })

  it('student notifications: approval, rejection, new work, grade, deadline, teacher message', () => {
    expect(describeNotification(notification({ id: 'a', type: 'link_approved', body: 'ครูอนุมัติแล้ว' })).title).toBe('บัญชีได้รับการอนุมัติแล้ว')
    expect(describeNotification(notification({ id: 'b', type: 'link_rejected', body: 'ครูปฏิเสธ: รหัสไม่ตรง' })).description).toContain('รหัสไม่ตรง')
    expect(describeNotification(notification({ id: 'c', type: 'assignment_published', metadata: { assignment_title: 'ใบงาน 1', subject_name: 'คณิต', due_date: '2026-10-12' } })).details.join(' ')).toMatch(/คณิต.*ครบกำหนด/)
    expect(describeNotification(notification({ id: 'd', type: 'submission_graded', metadata: { assignment_title: 'ใบงาน 1', score: 8.5, max_score: 10 } })).details).toContain('ได้ 8.5/10 คะแนน')
    expect(describeNotification(notification({ id: 'e', type: 'deadline_student', title: 'งานครบกำหนดพรุ่งนี้', metadata: { assignment_title: 'ใบงาน 2', due_date: '2026-10-11' } })).details).toContain('ยังไม่ได้ส่งงาน')
    expect(describeNotification(notification({ id: 'f', type: 'deadline_teacher', title: 'งานครบกำหนดวันนี้', metadata: { assignment_title: 'ใบงาน 2', pending_count: 4 } })).details).toContain('ยังไม่ส่ง 4 คน')
    expect(describeNotification(notification({ id: 'g', type: 'teacher_message', title: 'ข้อความจากครู', body: 'พรุ่งนี้สอบ', metadata: { sender_name: 'ครูสมศรี' } })).details).toEqual(['จาก ครูสมศรี'])
  })

  it('falls back to the stored body when details are missing', () => {
    expect(describeNotification(notification({ id: 'x', body: 'ข้อความสำรอง' })).description).toBe('ข้อความสำรอง')
  })
})

describe('navigation targets', () => {
  it('submission → that assignment’s review page, opening the student’s submission', () => {
    expect(notificationTarget(SUBMISSION)).toBe(`/teacher/subjects/${SUBJECT}/classrooms/${CLASSROOM}/assignments/${ASSIGNMENT}?student=${STUDENT}`)
  })

  it('link request → the existing approval page (never an approve action)', () => {
    expect(notificationTarget(notification({ id: 'r', type: 'link_request' }))).toBe(TEACHER_LINK_REQUESTS_PATH)
    expect(TEACHER_LINK_REQUESTS_PATH).toBe('/teacher/students/requests')
  })

  it('student targets', () => {
    const meta = { subject_id: SUBJECT, assignment_id: ASSIGNMENT }
    expect(notificationTarget(notification({ id: 'a', type: 'assignment_published', metadata: meta }))).toBe(`/student/subjects/${SUBJECT}/assignments/${ASSIGNMENT}`)
    expect(notificationTarget(notification({ id: 'b', type: 'submission_graded', metadata: meta }))).toBe(`/student/subjects/${SUBJECT}/assignments/${ASSIGNMENT}`)
    expect(notificationTarget(notification({ id: 'c', type: 'link_approved' }))).toBe('/student/dashboard')
    expect(notificationTarget(notification({ id: 'd', type: 'link_rejected' }))).toBe('/student/link-account')
    expect(notificationTarget(notification({ id: 'e', type: 'teacher_message' }))).toBe('/student/dashboard')
  })

  it('ids that are not plain ids never reach the URL', () => {
    const bad = { ...SUBMISSION, metadata: { ...SUBMISSION.metadata, subject_id: '../../admin' } }
    expect(notificationTarget(bad)).toBe('/teacher/subjects')
    const badStudent = { ...SUBMISSION, metadata: { ...SUBMISSION.metadata, student_id: 'x?y=1' } }
    expect(notificationTarget(badStudent)).not.toContain('student=')
    expect(notificationTarget(notification({ id: 'z', type: 'assignment_published', metadata: { subject_id: 'a/b' } }))).toBe('/student/subjects')
  })
})

describe('row mapping', () => {
  it('maps known rows and skips unknown types', () => {
    const row = { id: '1', notification_type: 'link_request', title: 't', body: null, entity_type: 'student_link_request', entity_id: null, metadata: { status: 'pending' }, read_at: null, created_at: '2026-10-10T00:00:00Z' }
    expect(mapNotificationRow(row)).toMatchObject({ id: '1', type: 'link_request', origin: 'app', metadata: { status: 'pending' } })
    expect(mapNotificationRow({ ...row, notification_type: 'something_new' })).toBeNull()
    expect(mapNotificationRow({ ...row, metadata: null })?.metadata).toEqual({})
  })
})

function ready(items: AppNotification[], unreadCount: number): NotificationFeedState {
  return notificationFeedReducer(INITIAL_FEED_STATE, { type: 'loaded', items, hasMore: false, unreadCount })
}

describe('feed reducer — ordering, dedupe, unread count', () => {
  const a = notification({ id: 'a', createdAt: '2026-10-10T01:00:00Z' })
  const b = notification({ id: 'b', createdAt: '2026-10-10T02:00:00Z', readAt: '2026-10-10T02:30:00Z' })

  it('newest first; count comes from the server', () => {
    const s = ready([a, b], 7)
    expect(s.items.map((n) => n.id)).toEqual(['b', 'a'])
    expect(s.unreadCount).toBe(7)
    expect(s.status).toBe('ready')
  })

  it('a new live notification is added once and counted once, even if delivered twice', () => {
    const c = notification({ id: 'c', createdAt: '2026-10-10T03:00:00Z' })
    let s = ready([a, b], 1)
    s = notificationFeedReducer(s, { type: 'upsert', items: [c], adjustCount: true })
    s = notificationFeedReducer(s, { type: 'upsert', items: [c], adjustCount: true })
    expect(s.items.map((n) => n.id)).toEqual(['c', 'b', 'a'])
    expect(s.unreadCount).toBe(2)
  })

  it('a live update that makes a read item unread again (e.g. a new grade) counts it', () => {
    let s = ready([a, b], 1)
    s = notificationFeedReducer(s, { type: 'upsert', items: [{ ...b, readAt: null, createdAt: '2026-10-10T04:00:00Z' }], adjustCount: true })
    expect(s.unreadCount).toBe(2)
    expect(s.items[0].id).toBe('b')
  })

  it('resync merges without touching the count (the server count replaces it)', () => {
    let s = ready([a], 1)
    s = notificationFeedReducer(s, { type: 'upsert', items: [a, b], adjustCount: false })
    expect(s.items).toHaveLength(2)
    expect(s.unreadCount).toBe(1)
    s = notificationFeedReducer(s, { type: 'setUnread', count: 5 })
    expect(s.unreadCount).toBe(5)
  })

  it('mark one read / mark all read', () => {
    const c = notification({ id: 'c', createdAt: '2026-10-10T03:00:00Z' })
    let s = ready([a, b, c], 2)
    s = notificationFeedReducer(s, { type: 'markRead', ids: ['a'], at: 'T' })
    expect(s.unreadCount).toBe(1)
    expect(s.items.find((n) => n.id === 'a')?.readAt).toBe('T')
    // Already read → no double decrement.
    expect(notificationFeedReducer(s, { type: 'markRead', ids: ['a', 'b'], at: 'T2' })).toBe(s)
    s = notificationFeedReducer(s, { type: 'markAllRead', at: 'T3' })
    expect(s.unreadCount).toBe(0)
    expect(s.items.every((n) => n.readAt !== null)).toBe(true)
  })

  it('older pages merge in order; filters', () => {
    const old = notification({ id: 'old', createdAt: '2026-10-01T00:00:00Z' })
    let s = ready([a, b], 1)
    s = notificationFeedReducer(s, { type: 'pageLoaded', items: [old, a], hasMore: false })
    expect(s.items.map((n) => n.id)).toEqual(['b', 'a', 'old'])
    expect(filterNotifications(s.items, 'unread').map((n) => n.id)).toEqual(['a', 'old'])
    expect(filterNotifications(s.items, 'all')).toHaveLength(3)
  })

  it('error keeps shown items; unavailable resets', () => {
    let s = ready([a], 1)
    s = notificationFeedReducer(s, { type: 'failed', error: 'x' })
    expect(s.status).toBe('ready')
    expect(s.error).toBe('x')
    expect(notificationFeedReducer(INITIAL_FEED_STATE, { type: 'failed', error: 'x' }).status).toBe('error')
    expect(notificationFeedReducer(s, { type: 'unavailable' })).toMatchObject({ status: 'unavailable', items: [], unreadCount: 0 })
  })
})

describe('student bell merge', () => {
  it('teacher messages and app notifications in one newest-first list, ids never collide', () => {
    const app = [notification({ id: 'same', type: 'assignment_published', createdAt: '2026-10-10T01:00:00Z' })]
    const messages = [{ id: 'same', senderName: 'ครูสมศรี', title: null, message: 'พรุ่งนี้สอบ', readAt: null, createdAt: '2026-10-10T02:00:00Z' }]
    const merged = mergeStudentFeeds(app, messages)
    expect(merged.map((n) => `${n.origin}:${n.type}`)).toEqual(['message:teacher_message', 'app:assignment_published'])
    expect(merged[0].title).toBe('ข้อความจากครู')
    expect(mergeStudentFeeds(app, [...messages, ...messages])).toHaveLength(2)
  })
})
