import { toFriendlyErrorMessage } from '@/lib/errors'
import {
  countMyUnreadNotifications,
  listMyNotifications,
  markAllMyNotificationsRead,
  markMyNotificationsRead,
  NotificationsUnavailableError,
  refreshMyDeadlineNotifications,
  subscribeToMyNotifications,
  type NotificationCursor,
  type NotificationPage,
  type RealtimeStatus,
} from '@/services/app-notification-service'

import type { AppNotification, NotificationFeedAction } from './notification-model'

/** Everything the feed needs from a backend — Supabase (real mode) or the
 * in-memory Demo Mode feed. */
export interface NotificationSource {
  /** Identifies the signed-in user. */
  key: string
  loadPage: (cursor: NotificationCursor | null) => Promise<NotificationPage>
  countUnread: () => Promise<number>
  markRead: (ids: string[]) => Promise<void>
  markAllRead: () => Promise<void>
  /** Live updates; omitted in Demo Mode. Returns the cleanup function. */
  subscribe?: (handlers: { onChange: (n: AppNotification) => void; onStatus: (s: RealtimeStatus) => void }) => () => void
  /** Server-side extras created before the first load (deadline reminders). */
  prepare?: () => Promise<void>
}

export function createSupabaseNotificationSource(userId: string): NotificationSource {
  return {
    key: userId,
    loadPage: (cursor) => listMyNotifications(userId, cursor),
    countUnread: () => countMyUnreadNotifications(userId),
    markRead: markMyNotificationsRead,
    markAllRead: markAllMyNotificationsRead,
    subscribe: (handlers) => subscribeToMyNotifications(userId, handlers),
    prepare: refreshMyDeadlineNotifications,
  }
}

/** Refresh fallback while Realtime is down: one quiet resync per minute
 * (only while offline — never polling while live). */
export const OFFLINE_RESYNC_MS = 60_000
/** Resync when the tab is shown again after this long. */
export const STALE_AFTER_MS = 60_000
/** Exact unread count re-read shortly after live events. */
export const COUNT_RECONCILE_MS = 400

export interface NotificationFeedController {
  start: () => void
  stop: () => void
  reload: () => Promise<void>
  resync: () => Promise<void>
  resyncIfStale: (now?: number) => void
  loadMore: (after: NotificationCursor) => Promise<void>
  markRead: (ids: string[]) => Promise<void>
  markAllRead: () => Promise<void>
}

/**
 * The bell's lifecycle, framework-free (the hook only wires it to React):
 *   start  → first page + unread count (after `prepare`), then subscribe.
 *   live events → upsert (deduped by id) + exact count shortly after.
 *   reconnect (live again after a drop), browser back online, tab shown
 *          again when stale → quiet resync of the newest page + count.
 *   offline → resync once a minute until live again (refresh fallback).
 *   stop   → unsubscribe, clear timers, ignore every late response.
 */
export function createNotificationFeedController(source: NotificationSource, dispatch: (action: NotificationFeedAction) => void): NotificationFeedController {
  let generation = 0
  let stopped = false
  let wasLive = false
  let lastSync = 0
  let unsubscribe: (() => void) | null = null
  let offlineTimer: ReturnType<typeof setInterval> | null = null
  let countTimer: ReturnType<typeof setTimeout> | null = null

  const current = (gen: number) => !stopped && gen === generation

  function stopOfflineTimer() {
    if (offlineTimer) clearInterval(offlineTimer)
    offlineTimer = null
  }

  async function reload() {
    const gen = ++generation
    dispatch({ type: 'reset' })
    try {
      await source.prepare?.().catch(() => undefined)
      const [page, unread] = await Promise.all([source.loadPage(null), source.countUnread()])
      if (!current(gen)) return
      lastSync = Date.now()
      dispatch({ type: 'loaded', items: page.items, hasMore: page.hasMore, unreadCount: unread })
    } catch (err) {
      if (!current(gen)) return
      if (err instanceof NotificationsUnavailableError) dispatch({ type: 'unavailable' })
      else dispatch({ type: 'failed', error: toFriendlyErrorMessage(err, 'โหลดการแจ้งเตือนไม่สำเร็จ') })
    }
  }

  async function resync() {
    const gen = generation
    try {
      const [page, unread] = await Promise.all([source.loadPage(null), source.countUnread()])
      if (!current(gen)) return
      lastSync = Date.now()
      dispatch({ type: 'upsert', items: page.items, adjustCount: false })
      dispatch({ type: 'setUnread', count: unread })
    } catch {
      // Keep what is shown; the next trigger tries again.
    }
  }

  function reconcileCountSoon() {
    if (countTimer) clearTimeout(countTimer)
    const gen = generation
    countTimer = setTimeout(() => {
      source
        .countUnread()
        .then((count) => {
          if (current(gen)) dispatch({ type: 'setUnread', count })
        })
        .catch(() => undefined)
    }, COUNT_RECONCILE_MS)
  }

  function subscribe() {
    if (!source.subscribe) return
    dispatch({ type: 'connection', value: 'connecting' })
    unsubscribe = source.subscribe({
      onChange: (n) => {
        if (stopped) return
        dispatch({ type: 'upsert', items: [n], adjustCount: true })
        reconcileCountSoon()
      },
      onStatus: (status) => {
        if (stopped) return
        dispatch({ type: 'connection', value: status })
        if (status === 'live') {
          stopOfflineTimer()
          // Back after a drop: fetch whatever arrived meanwhile.
          if (wasLive) void resync()
          wasLive = true
        } else if (status === 'offline' && !offlineTimer) {
          offlineTimer = setInterval(() => void resync(), OFFLINE_RESYNC_MS)
        }
      },
    })
  }

  return {
    start() {
      stopped = false
      void reload()
      subscribe()
    },
    stop() {
      stopped = true
      generation += 1
      stopOfflineTimer()
      if (countTimer) clearTimeout(countTimer)
      countTimer = null
      unsubscribe?.()
      unsubscribe = null
    },
    reload,
    resync,
    resyncIfStale(now = Date.now()) {
      if (!stopped && now - lastSync > STALE_AFTER_MS) void resync()
    },
    async loadMore(after) {
      const gen = generation
      dispatch({ type: 'loadingMore', value: true })
      try {
        const page = await source.loadPage(after)
        if (current(gen)) dispatch({ type: 'pageLoaded', items: page.items, hasMore: page.hasMore })
      } catch (err) {
        if (current(gen)) dispatch({ type: 'failed', error: toFriendlyErrorMessage(err, 'โหลดการแจ้งเตือนเพิ่มไม่สำเร็จ') })
      }
    },
    async markRead(ids) {
      if (ids.length === 0) return
      dispatch({ type: 'markRead', ids, at: new Date().toISOString() })
      try {
        await source.markRead(ids)
      } catch (err) {
        void resync()
        throw err
      }
    },
    async markAllRead() {
      dispatch({ type: 'markAllRead', at: new Date().toISOString() })
      try {
        await source.markAllRead()
      } catch (err) {
        void resync()
        throw err
      }
    },
  }
}
