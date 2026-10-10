import { useCallback, useEffect, useReducer, useRef } from 'react'

import { createNotificationFeedController, type NotificationFeedController, type NotificationSource } from './notification-feed-controller'
import { INITIAL_FEED_STATE, notificationFeedReducer, type AppNotification, type NotificationFeedState } from './notification-model'

export interface NotificationFeed extends NotificationFeedState {
  retry: () => void
  loadMore: () => void
  markRead: (ids: string[]) => Promise<void>
  markAllRead: () => Promise<void>
}

/**
 * React wiring for createNotificationFeedController (see that file for
 * the load / live / reconnect / fallback rules). `source` must be stable
 * per signed-in user (memoise it): a new source starts a fresh feed and
 * the previous one is torn down (channel removed, timers cleared).
 */
export function useNotificationFeed(source: NotificationSource | null): NotificationFeed {
  const [state, dispatch] = useReducer(notificationFeedReducer, INITIAL_FEED_STATE)
  const controller = useRef<NotificationFeedController | null>(null)
  const items = useRef<AppNotification[]>([])

  useEffect(() => {
    items.current = state.items
  })

  useEffect(() => {
    if (!source) return
    const c = createNotificationFeedController(source, dispatch)
    controller.current = c
    c.start()
    return () => {
      c.stop()
      if (controller.current === c) controller.current = null
      dispatch({ type: 'connection', value: 'none' })
    }
  }, [source])

  // Back online / tab shown again → catch up.
  useEffect(() => {
    if (!source || typeof window === 'undefined') return
    const onOnline = () => void controller.current?.resync()
    const onVisible = () => {
      if (document.visibilityState === 'visible') controller.current?.resyncIfStale()
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [source])

  const retry = useCallback(() => void controller.current?.reload(), [])
  const loadMore = useCallback(() => {
    const last = items.current[items.current.length - 1]
    if (last) void controller.current?.loadMore({ createdAt: last.createdAt, id: last.id })
  }, [])
  const markRead = useCallback(async (ids: string[]) => {
    await controller.current?.markRead(ids)
  }, [])
  const markAllRead = useCallback(async () => {
    await controller.current?.markAllRead()
  }, [])

  return { ...state, retry, loadMore, markRead, markAllRead }
}
