import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useToast } from '@/components/ui/toast'
import { useDemoClassroom } from '@/demo/demo-context'
import { useAuth } from '@/lib/auth-context'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { useStudentNotificationsContext } from '@/lib/student-notifications-context'

import { buildDemoTeacherNotifications, createDemoNotificationSource } from './demo-notifications'
import { mergeStudentFeeds, notificationTarget, type AppNotification } from './notification-model'
import { NotificationPopover } from './notification-popover'
import { createSupabaseNotificationSource } from './notification-feed-controller'
import { useNotificationFeed, type NotificationFeed } from './use-notification-feed'

const NO_ITEMS: AppNotification[] = []

const TEACHER_UNAVAILABLE = 'ระบบแจ้งเตือนยังไม่พร้อมใช้งาน — ผู้ดูแลระบบต้องติดตั้งฐานข้อมูลการแจ้งเตือนก่อน'

/** Mark read (if unread) then go to the notification's page. Reading a
 * notification never approves/rejects or changes anything else. */
function useOpenNotification(markRead: (n: AppNotification) => Promise<void>) {
  const navigate = useNavigate()
  const { toast } = useToast()
  return useCallback(
    (n: AppNotification) => {
      if (n.readAt === null) markRead(n).catch((err: unknown) => toast(toFriendlyErrorMessage(err, 'บันทึกสถานะการอ่านไม่สำเร็จ')))
      navigate(notificationTarget(n))
    },
    [markRead, navigate, toast],
  )
}

function FeedBell({ feed, unavailableText }: { feed: NotificationFeed; unavailableText?: string }) {
  const { toast } = useToast()
  const markOne = useCallback((n: AppNotification) => feed.markRead([n.id]), [feed])
  const open = useOpenNotification(markOne)
  return (
    <NotificationPopover
      status={feed.status}
      error={feed.error}
      items={feed.items}
      unreadCount={feed.unreadCount}
      hasMore={feed.hasMore}
      loadingMore={feed.loadingMore}
      connection={feed.connection}
      unavailableText={unavailableText}
      onRetry={feed.retry}
      onLoadMore={feed.loadMore}
      onOpen={open}
      onMarkRead={(n) => markOne(n).catch((err: unknown) => toast(toFriendlyErrorMessage(err, 'บันทึกสถานะการอ่านไม่สำเร็จ')))}
      onMarkAllRead={() => feed.markAllRead().catch((err: unknown) => toast(toFriendlyErrorMessage(err, 'บันทึกสถานะการอ่านไม่สำเร็จ')))}
    />
  )
}

/** Real mode, teacher header. */
export function TeacherNotificationBell() {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const source = useMemo(() => (userId ? createSupabaseNotificationSource(userId) : null), [userId])
  const feed = useNotificationFeed(source)
  return <FeedBell feed={feed} unavailableText={TEACHER_UNAVAILABLE} />
}

/** Demo Mode, teacher header — sample feed from the demo store. */
export function DemoTeacherNotificationBell() {
  const { subjects, classrooms, allStudents, subjectAssignments } = useDemoClassroom()
  // Built once per page load so marking read sticks while browsing.
  const [source] = useState(() => createDemoNotificationSource(buildDemoTeacherNotifications({ subjects, classrooms, allStudents, subjectAssignments }, new Date())))
  const feed = useNotificationFeed(source)
  return <FeedBell feed={feed} />
}

/**
 * Real mode, student header: notifications from 0029 (account, new work,
 * grades, deadlines) merged with teacher messages from 0012 (the existing
 * StudentNotificationsProvider — its toast and dashboard widget are
 * unchanged). Works with either table missing.
 */
export function StudentNotificationBell() {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const source = useMemo(() => (userId ? createSupabaseNotificationSource(userId) : null), [userId])
  const feed = useNotificationFeed(source)
  const messages = useStudentNotificationsContext()
  const { toast } = useToast()

  const appItems = feed.status === 'ready' ? feed.items : NO_ITEMS
  const items = useMemo(() => mergeStudentFeeds(appItems, messages.notifications), [appItems, messages.notifications])
  const appUnread = feed.status === 'ready' ? feed.unreadCount : 0
  const loading = (feed.status === 'loading' && source !== null) || messages.loading
  const status = loading ? 'loading' : feed.status === 'error' && items.length === 0 ? 'error' : 'ready'
  const error = feed.status === 'error' ? feed.error : (feed.error ?? messages.error)

  const markOne = useCallback(
    (n: AppNotification) => (n.origin === 'message' ? messages.markRead(n.id) : feed.markRead([n.id])),
    [messages, feed],
  )
  const open = useOpenNotification(markOne)
  const fail = (err: unknown) => toast(toFriendlyErrorMessage(err, 'บันทึกสถานะการอ่านไม่สำเร็จ'))

  return (
    <NotificationPopover
      status={status}
      error={error}
      items={items}
      unreadCount={appUnread + messages.unreadCount}
      hasMore={feed.status === 'ready' && feed.hasMore}
      loadingMore={feed.loadingMore}
      connection={feed.connection}
      onRetry={feed.retry}
      onLoadMore={feed.loadMore}
      onOpen={open}
      onMarkRead={(n) => markOne(n).catch(fail)}
      onMarkAllRead={() => {
        const work: Promise<void>[] = []
        if (appUnread > 0) work.push(feed.markAllRead())
        if (messages.unreadCount > 0) work.push(messages.markAllRead())
        Promise.all(work).catch(fail)
      }}
    />
  )
}
