import { useCallback, useEffect, useRef, useState } from 'react'

import { getSupabaseClient } from '@/lib/supabase'
import {
  getMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/services/student-portal-service'
import type { MyNotification } from '@/types/student-portal'

interface NotificationInsertPayload {
  id: string
  teacher_id: string
  title: string | null
  message: string
  read_at: string | null
  created_at: string
}

export interface UseStudentNotificationsResult {
  notifications: MyNotification[]
  unreadCount: number
  loading: boolean
  error: string | null
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
}

/**
 * The DB row (teacher_student_notifications, 0012) is the source of
 * truth end to end — the initial getMyNotifications() fetch below is
 * what a page refresh or a fresh mount always falls back to, so a
 * notification sent while the student was offline/the tab was closed is
 * never lost regardless of what Realtime does or doesn't deliver.
 * Realtime (postgres_changes on INSERT, RLS-filtered to this student's
 * own rows by teacher_student_notifications_select_own_student, 0012) is
 * strictly an enhancement layered on top: it's what makes a message that
 * arrives while the tab is OPEN show up immediately (live badge count +
 * the onNewNotification callback, used for the top-right toast) without
 * polling.
 *
 * Dedup against reconnect/re-subscribe (a real Realtime behavior: the
 * channel can drop and silently re-subscribe, and a resync after that
 * can hand back rows already known): every id this hook has ever added
 * is tracked in seenIds, and BOTH the live INSERT handler and the
 * on-(re)subscribe reconciliation refresh below check it before adding a
 * row to state — so the same notification can arrive twice (or the
 * reconciliation and a live event can race) without ever appearing
 * twice, and the reconciliation pass never re-announces (toasts) a
 * notification the live handler already announced.
 */
export function useStudentNotifications(
  studentId: string | null,
  onNewNotification?: (notification: MyNotification) => void,
): UseStudentNotificationsResult {
  const [notifications, setNotifications] = useState<MyNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seenIds = useRef<Set<string>>(new Set())
  const onNewNotificationRef = useRef(onNewNotification)
  onNewNotificationRef.current = onNewNotification

  useEffect(() => {
    if (!studentId) {
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)
    setError(null)

    getMyNotifications()
      .then((rows) => {
        if (!active) return
        seenIds.current = new Set(rows.map((r) => r.id))
        setNotifications(rows)
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'ไม่สามารถโหลดข้อความจากครูได้')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [studentId])

  useEffect(() => {
    if (!studentId) return

    let disposed = false
    const supabase = getSupabaseClient()

    async function resolveSenderName(teacherId: string): Promise<string> {
      const { data } = await supabase.from('profiles').select('display_name').eq('id', teacherId).maybeSingle()
      return (data as { display_name: string | null } | null)?.display_name ?? 'ครู'
    }

    const channel = supabase
      .channel(`student-notifications-${studentId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'teacher_student_notifications',
          filter: `student_id=eq.${studentId}`,
        },
        (payload) => {
          const row = payload.new as NotificationInsertPayload
          if (seenIds.current.has(row.id)) return
          seenIds.current.add(row.id)

          resolveSenderName(row.teacher_id)
            .then((senderName) => {
              if (disposed) return
              const notification: MyNotification = {
                id: row.id,
                senderName,
                title: row.title,
                message: row.message,
                readAt: row.read_at,
                createdAt: row.created_at,
              }
              setNotifications((prev) => [notification, ...prev])
              onNewNotificationRef.current?.(notification)
            })
            .catch(() => {
              // Sender-name lookup failing shouldn't drop the notification
              // itself — fall back to a generic label.
              if (disposed) return
              const notification: MyNotification = {
                id: row.id,
                senderName: 'ครู',
                title: row.title,
                message: row.message,
                readAt: row.read_at,
                createdAt: row.created_at,
              }
              setNotifications((prev) => [notification, ...prev])
              onNewNotificationRef.current?.(notification)
            })
        },
      )
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED' || disposed) return
        // Reconciliation pass on every (re)subscribe — silently backfills
        // anything missed while disconnected, without re-announcing
        // (toasting) rows the live handler already added.
        getMyNotifications()
          .then((rows) => {
            if (disposed) return
            const newRows = rows.filter((r) => !seenIds.current.has(r.id))
            if (newRows.length === 0) return
            for (const r of newRows) seenIds.current.add(r.id)
            setNotifications((prev) => {
              const byId = new Map(prev.map((n) => [n.id, n]))
              for (const r of newRows) byId.set(r.id, r)
              return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            })
          })
          .catch(() => {
            // Best-effort reconciliation only — the next mount's full
            // fetch is the real backstop.
          })
      })

    return () => {
      disposed = true
      supabase.removeChannel(channel)
    }
  }, [studentId])

  const markRead = useCallback(async (id: string) => {
    await markNotificationRead(id)
    setNotifications((prev) => prev.map((n) => (n.id === id && n.readAt === null ? { ...n, readAt: new Date().toISOString() } : n)))
  }, [])

  const markAllRead = useCallback(async () => {
    await markAllNotificationsRead()
    const now = new Date().toISOString()
    setNotifications((prev) => prev.map((n) => (n.readAt === null ? { ...n, readAt: now } : n)))
  }, [])

  const unreadCount = notifications.filter((n) => n.readAt === null).length

  return { notifications, unreadCount, loading, error, markRead, markAllRead }
}
