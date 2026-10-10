import { readFileSync } from 'node:fs'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { AppNotification } from './notification-model'
import { NotificationPopover, type NotificationPopoverProps } from './notification-popover'

const noop = () => {}
const NOW = new Date('2026-10-10T04:00:00.000Z')

function item(id: string, patch: Partial<AppNotification> = {}): AppNotification {
  return {
    id,
    type: 'assignment_submitted',
    title: 'ส่งงานใหม่ — รอตรวจ',
    body: null,
    entityType: 'assignment_submission',
    entityId: null,
    metadata: {
      student_name: 'สมชาย ใจดี',
      assignment_title: 'รายงานการทดลอง',
      subject_name: 'วิทยาศาสตร์',
      classroom_name: 'ม.4/1',
      submitted_at: '2026-10-10T03:55:00.000Z',
    },
    readAt: null,
    createdAt: '2026-10-10T03:55:00.000Z',
    origin: 'app',
    ...patch,
  }
}

function render(patch: Partial<NotificationPopoverProps> = {}, open = true): string {
  const props: NotificationPopoverProps = {
    status: 'ready',
    error: null,
    items: [],
    unreadCount: 0,
    hasMore: false,
    loadingMore: false,
    connection: 'live',
    onRetry: noop,
    onLoadMore: noop,
    onOpen: noop,
    onMarkRead: noop,
    onMarkAllRead: noop,
    defaultOpen: open,
    now: NOW,
    ...patch,
  }
  return renderToStaticMarkup(createElement(NotificationPopover, props))
}

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf-8')
}

describe('bell button', () => {
  it('unread badge with 99+ cap; none when everything is read', () => {
    expect(render({ unreadCount: 3 }, false)).toContain('data-testid="notification-badge">3<')
    expect(render({ unreadCount: 150 }, false)).toContain('>99+<')
    expect(render({ unreadCount: 150 }, false)).toContain('aria-label="การแจ้งเตือน (ยังไม่อ่าน 99+ รายการ)"')
    expect(render({ unreadCount: 0 }, false)).not.toContain('notification-badge')
    // Closed: no panel.
    expect(render({ unreadCount: 3 }, false)).not.toContain('role="dialog"')
  })
})

describe('popover', () => {
  it('header, ทั้งหมด / ยังไม่อ่าน filters, อ่านทั้งหมด', () => {
    const html = render({ items: [item('a')], unreadCount: 1 })
    expect(html).toContain('role="dialog"')
    expect(html).toContain('การแจ้งเตือน')
    expect(html).toContain('ทั้งหมด')
    expect(html).toContain('ยังไม่อ่าน (1)')
    expect(html).toContain('อ่านทั้งหมด')
    expect(html).toContain('aria-selected="true"')
  })

  it('item: title, description, details, relative time, unread marker, per-item mark read', () => {
    const html = render({ items: [item('a')], unreadCount: 1 })
    expect(html).toContain('ส่งงานใหม่ — รอตรวจ')
    expect(html).toContain('สมชาย ใจดี ส่งงาน “รายงานการทดลอง”')
    expect(html).toContain('วิทยาศาสตร์ · ม.4/1')
    expect(html).toContain('5 นาทีที่แล้ว')
    expect(html).toContain('aria-label="ทำเครื่องหมายว่าอ่านแล้ว"')
    expect(html).toContain('ยังไม่อ่าน</span>')
  })

  it('read items have no mark-read button; link request shows its approval status', () => {
    const html = render({
      items: [item('r', { type: 'link_request', readAt: '2026-10-10T03:59:00Z', metadata: { student_name: 'มานี มีนา', classroom_names: 'ม.4/1', status: 'pending', requested_at: '2026-10-10T03:00:00Z' } })],
    })
    expect(html).not.toContain('aria-label="ทำเครื่องหมายว่าอ่านแล้ว"')
    expect(html).toContain('รออนุมัติ')
    expect(html).toContain('มานี มีนา ขอเชื่อมบัญชีนักเรียน')
  })

  it('loading skeleton, empty, error with retry, not-set-up, offline hint, load more', () => {
    expect(render({ status: 'loading' })).toContain('data-testid="notification-loading"')
    expect(render({ status: 'ready', items: [] })).toContain('ยังไม่มีการแจ้งเตือน')
    const err = render({ status: 'error', error: 'โหลดการแจ้งเตือนไม่สำเร็จ' })
    expect(err).toContain('role="alert"')
    expect(err).toContain('ลองใหม่')
    expect(render({ status: 'unavailable', unavailableText: 'ยังไม่พร้อม' })).toContain('ยังไม่พร้อม')
    expect(render({ connection: 'offline' })).toContain('ออฟไลน์')
    expect(render({ items: [item('a')], hasMore: true })).toContain('โหลดการแจ้งเตือนก่อนหน้า')
    expect(render({ items: [item('a')], hasMore: true, loadingMore: true })).toContain('กำลังโหลด...')
  })

  it('อ่านทั้งหมด is disabled when nothing is unread', () => {
    expect(render({ items: [item('a', { readAt: 'x' })], unreadCount: 0 })).toMatch(/<button type="button" disabled=""[^>]*>.*?อ่านทั้งหมด/)
  })

  it('no Tailwind dark: variants (theme tokens only)', () => {
    expect(source('./notification-popover.tsx')).not.toMatch(/\bdark:/)
    expect(source('./notification-styles.ts')).not.toMatch(/\bdark:/)
  })
})

describe('wiring (source guards)', () => {
  it('the existing header bell is reused — one bell per header, teacher real + demo', () => {
    const header = source('../../components/layout/header.tsx')
    expect(header).toContain('<TeacherNotificationBell />')
    expect(header).toContain('<DemoTeacherNotificationBell />')
    expect(header).not.toContain('function NotificationButton')
    expect(header.match(/NotificationBell \/>/g)).toHaveLength(2)
  })

  it('student header uses the same popover; messages toast/dashboard stay on the existing provider', () => {
    const layout = source('../../layouts/student-layout.tsx')
    expect(layout).toContain('<StudentNotificationBell />')
    expect(layout).toContain('StudentNotificationsProvider')
    expect(layout).toContain('NotificationToast')
  })

  it('clicking marks read then navigates; reading never calls approve/reject', () => {
    const bells = source('./notification-bells.tsx')
    expect(bells).toContain('navigate(notificationTarget(n))')
    expect(bells).not.toMatch(/(approve|reject)[A-Za-z]*Request\(|rpc\(/)
    const service = source('../../services/app-notification-service.ts')
    expect(service).not.toMatch(/approve_student_link_request|reject_student_link_request/)
  })

  it('client never inserts/updates notifications rows directly; no service role; channel cleaned up', () => {
    const service = source('../../services/app-notification-service.ts')
    expect(service).not.toMatch(/from\('notifications'\)\s*\.(insert|update|upsert|delete)/)
    expect(service).not.toMatch(/service_role|SERVICE_ROLE/)
    expect(service).toContain(".eq('recipient_user_id', userId)")
    expect(service).toContain('removeChannel(channel)')
    expect(service).toContain('.limit(limit + 1)')
  })

  it('assignment review page opens ?student= submissions; pending page listens for the decision', () => {
    expect(source('../../pages/teacher/subjects/subject-classroom-assignment-detail-page-real.tsx')).toContain("searchParams.get('student')")
    const pending = source('../../pages/student/pending-page.tsx')
    expect(pending).toContain('subscribeToMyNotifications')
    expect(pending).toMatch(/link_approved'.*link_rejected'/)
  })
})

describe('migration 0029 (prepared, not applied)', () => {
  const sql = source('../../../supabase/migrations/0029_notifications.sql')

  it('table with the requested columns, idempotency key, indexes', () => {
    for (const col of ['id uuid primary key', 'recipient_user_id uuid not null', 'actor_user_id uuid', 'notification_type text not null', 'title text not null', 'body text', 'entity_type text not null', 'entity_id uuid', 'metadata jsonb not null', 'read_at timestamptz', 'created_at timestamptz not null']) {
      expect(sql).toContain(col)
    }
    expect(sql).toContain('unique (recipient_user_id, dedupe_key)')
    expect(sql).toContain('(recipient_user_id, created_at desc, id desc)')
    expect(sql).toContain('where read_at is null')
  })

  it('RLS: own rows only, no client writes, internal helper not callable', () => {
    expect(sql).toContain('enable row level security')
    expect(sql).toMatch(/for select\s+using \(recipient_user_id = auth\.uid\(\)\)/)
    expect(sql).not.toMatch(/on public\.notifications for (insert|update|delete)/)
    expect(sql).toContain('revoke insert, update, delete, truncate on public.notifications from public, anon, authenticated')
    expect(sql).toContain('revoke all on function public.notifications_insert(uuid, uuid, text, text, text, text, uuid, jsonb, text) from public, anon, authenticated')
  })

  it('triggers on the real event sources; realtime publication; never blocks the source write', () => {
    expect(sql).toContain('after insert or update of submitted_at, status, score on public.assignment_submissions')
    expect(sql).toContain('after insert or update of is_archived on public.assignments')
    expect(sql).toContain('after insert or update of status on public.student_account_link_requests')
    expect(sql).toContain('alter publication supabase_realtime add table public.notifications')
    expect(sql.match(/exception when others then\s+raise warning/g)?.length).toBe(3)
  })

  it('additive only: no drops of existing objects, no SGS tables, no data deletes', () => {
    expect(sql).not.toMatch(/drop table|drop column|truncate public\.|delete from/i)
    expect(sql).not.toMatch(/sgs_/i)
  })
})
