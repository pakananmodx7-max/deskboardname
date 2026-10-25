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

/** Refresh fallback while Realtime is down: a quiet resync this often (only
 * while not live — never polling while live). */
export const OFFLINE_RESYNC_MS = 20_000
/** Resync when the tab is shown again after this long (background tabs and
 * phones may drop the socket without telling us). */
export const STALE_AFTER_MS = 10_000
/** A channel that has not become live by then is treated as offline, so
 * the fallback starts instead of waiting on a join that never answers. */
export const LIVE_TIMEOUT_MS = 10_000
/** While live and visible, a slow safety re-read: Realtime can report
 * "subscribed" yet deliver nothing (e.g. the table missing from the
 * project's realtime publication) — this bounds how stale the bell gets. */
export const LIVE_SAFETY_RESYNC_MS = 90_000
/** Rows newer than the feed's start (minus this clock-skew allowance) that
 * appear later count as "new" for onNew. */
const NEW_SKEW_MS = 120_000
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
export interface NotificationFeedOptions {
  /** Unread notifications that arrived after the feed started (live or
   * found by a resync) — each id is reported once. Never called for the
   * first load or older pages. */
  onNew?: (items: AppNotification[]) => void
}

export function createNotificationFeedController(
  source: NotificationSource,
  dispatch: (action: NotificationFeedAction) => void,
  options: NotificationFeedOptions = {},
): NotificationFeedController {
  let generation = 0
  let stopped = false
  let wasLive = false
  let live = false
  let lastSync = 0
  let startedAt = Date.now()
  let unsubscribe: (() => void) | null = null
  let offlineTimer: ReturnType<typeof setInterval> | null = null
  let countTimer: ReturnType<typeof setTimeout> | null = null
  let liveTimer: ReturnType<typeof setTimeout> | null = null
  let safetyTimer: ReturnType<typeof setInterval> | null = null
  const known = new Set<string>()
  const pageVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'

  const current = (gen: number) => !stopped && gen === generation

  function stopOfflineTimer() {
    if (offlineTimer) clearInterval(offlineTimer)
    offlineTimer = null
  }

  function startOfflineTimer() {
    if (!offlineTimer) offlineTimer = setInterval(() => void resync(), OFFLINE_RESYNC_MS)
  }

  /** Remember ids; report the unread ones that are genuinely new. */
  function noteItems(items: AppNotification[], report: boolean) {
    const fresh: AppNotification[] = []
    for (const item of items) {
      if (known.has(item.id)) continue
      known.add(item.id)
      if (report && item.readAt === null && Date.parse(item.createdAt) >= startedAt - NEW_SKEW_MS) fresh.push(item)
    }
    if (fresh.length > 0) options.onNew?.(fresh)
  }

  async function reload() {
    const gen = ++generation
    dispatch({ type: 'reset' })
    try {
      await source.prepare?.().catch(() => undefined)
      const [page, unread] = await Promise.all([source.loadPage(null), source.countUnread()])
      if (!current(gen)) return
      lastSync = Date.now()
      noteItems(page.items, false)
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
      noteItems(page.items, true)
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
    // Not live in time (join never answered, project refuses the channel,
    // socket blocked) → behave as offline: fallback resyncs until live.
    liveTimer = setTimeout(() => {
      liveTimer = null
      if (stopped || live) return
      dispatch({ type: 'connection', value: 'offline' })
      startOfflineTimer()
    }, LIVE_TIMEOUT_MS)
    const handlers = {
      onChange: (n: AppNotification) => {
        if (stopped) return
        noteItems([n], true)
        dispatch({ type: 'upsert', items: [n], adjustCount: true })
        reconcileCountSoon()
      },
      onStatus: (status: RealtimeStatus) => {
        if (stopped) return
        dispatch({ type: 'connection', value: status })
        live = status === 'live'
        if (status === 'live') {
          stopOfflineTimer()
          // Back after a drop (or live only after the fallback started):
          // fetch whatever arrived meanwhile.
          if (wasLive || lastSync > 0) void resync()
          wasLive = true
        } else if (status === 'offline') {
          startOfflineTimer()
        }
      },
    }
    try {
      unsubscribe = source.subscribe(handlers)
    } catch {
      handlers.onStatus('offline')
    }
  }

  return {
    start() {
      stopped = false
      startedAt = Date.now()
      void reload()
      subscribe()
      if (source.subscribe && !safetyTimer) {
        safetyTimer = setInterval(() => {
          if (live && pageVisible() && Date.now() - lastSync >= LIVE_SAFETY_RESYNC_MS - 1000) void resync()
        }, LIVE_SAFETY_RESYNC_MS)
      }
    },
    stop() {
      stopped = true
      generation += 1
      stopOfflineTimer()
      if (liveTimer) clearTimeout(liveTimer)
      liveTimer = null
      if (safetyTimer) clearInterval(safetyTimer)
      safetyTimer = null
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
        if (!current(gen)) return
        noteItems(page.items, false)
        dispatch({ type: 'pageLoaded', items: page.items, hasMore: page.hasMore })
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
