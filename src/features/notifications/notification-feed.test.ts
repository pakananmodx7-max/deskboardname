import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NotificationsUnavailableError, type RealtimeStatus } from '@/services/app-notification-service'

import { buildDemoTeacherNotifications, createDemoNotificationSource } from './demo-notifications'
import { COUNT_RECONCILE_MS, createNotificationFeedController, LIVE_SAFETY_RESYNC_MS, LIVE_TIMEOUT_MS, OFFLINE_RESYNC_MS, STALE_AFTER_MS, type NotificationSource } from './notification-feed-controller'
import { compareNotifications, INITIAL_FEED_STATE, notificationFeedReducer, type AppNotification, type NotificationFeedAction, type NotificationFeedState } from './notification-model'

function n(id: string, minute: number, patch: Partial<AppNotification> = {}): AppNotification {
  return {
    id,
    type: 'assignment_submitted',
    title: 'ส่งงานใหม่ — รอตรวจ',
    body: null,
    entityType: 'assignment_submission',
    entityId: null,
    metadata: {},
    readAt: null,
    createdAt: `2026-10-10T03:${String(minute).padStart(2, '0')}:00.000Z`,
    origin: 'app',
    ...patch,
  }
}

/** In-memory "server" for one user, with a controllable Realtime channel. */
function fakeServer(initial: AppNotification[] = [], pageSize = 3) {
  let rows = [...initial]
  let handlers: { onChange: (n: AppNotification) => void; onStatus: (s: RealtimeStatus) => void } | null = null
  const calls = { loadPage: 0, countUnread: 0, unsubscribed: 0, markRead: [] as string[][], prepare: 0 }
  let failNext: unknown = null
  const source: NotificationSource = {
    key: 'teacher-a',
    prepare: async () => {
      calls.prepare += 1
    },
    loadPage: async (cursor) => {
      calls.loadPage += 1
      if (failNext) {
        const err = failNext
        failNext = null
        throw err
      }
      const sorted = [...rows].sort(compareNotifications)
      const start = cursor ? sorted.findIndex((r) => compareNotifications(r, { ...r, createdAt: cursor.createdAt, id: cursor.id }) > 0) : 0
      const from = start < 0 ? sorted.length : start
      return { items: sorted.slice(from, from + pageSize), hasMore: from + pageSize < sorted.length }
    },
    countUnread: async () => {
      calls.countUnread += 1
      return rows.filter((r) => r.readAt === null).length
    },
    markRead: async (ids) => {
      calls.markRead.push(ids)
      rows = rows.map((r) => (ids.includes(r.id) ? { ...r, readAt: 'read' } : r))
    },
    markAllRead: async () => {
      rows = rows.map((r) => ({ ...r, readAt: r.readAt ?? 'read' }))
    },
    subscribe: (h) => {
      handlers = h
      return () => {
        calls.unsubscribed += 1
        handlers = null
      }
    },
  }
  return {
    source,
    calls,
    /** Server-side insert; delivered live only if `live`. */
    insert(row: AppNotification, live = true) {
      rows = [...rows.filter((r) => r.id !== row.id), row]
      if (live) handlers?.onChange(row)
    },
    status(s: RealtimeStatus) {
      handlers?.onStatus(s)
    },
    deliver(row: AppNotification) {
      handlers?.onChange(row)
    },
    failNextLoad(err: unknown) {
      failNext = err
    },
    get subscribed() {
      return handlers !== null
    },
  }
}

function harness(source: NotificationSource) {
  let state: NotificationFeedState = INITIAL_FEED_STATE
  const reported: string[][] = []
  const dispatch = (a: NotificationFeedAction) => {
    state = notificationFeedReducer(state, a)
  }
  const controller = createNotificationFeedController(source, dispatch, { onNew: (items) => reported.push(items.map((i) => i.id)) })
  return {
    controller,
    reported,
    get state() {
      return state
    },
  }
}

const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-10T04:00:00.000Z'))
})
afterEach(() => vi.useRealTimers())

describe('feed lifecycle', () => {
  it('loads the first page and the exact unread count (after server-side deadline prep)', async () => {
    const server = fakeServer([n('a', 1), n('b', 2), n('c', 3), n('d', 4, { readAt: 'x' })])
    const h = harness(server.source)
    h.controller.start()
    await flush()
    expect(server.calls.prepare).toBe(1)
    expect(h.state.status).toBe('ready')
    expect(h.state.items.map((i) => i.id)).toEqual(['d', 'c', 'b'])
    expect(h.state.hasMore).toBe(true)
    expect(h.state.unreadCount).toBe(3)
  })

  it('pagination: older pages append without duplicates', async () => {
    const server = fakeServer([n('a', 1), n('b', 2), n('c', 3), n('d', 4), n('e', 5)])
    const h = harness(server.source)
    h.controller.start()
    await flush()
    const last = h.state.items[h.state.items.length - 1]
    await h.controller.loadMore({ createdAt: last.createdAt, id: last.id })
    expect(h.state.items.map((i) => i.id)).toEqual(['e', 'd', 'c', 'b', 'a'])
    expect(h.state.hasMore).toBe(false)
  })

  it('error state, then retry recovers', async () => {
    const server = fakeServer([n('a', 1)])
    server.failNextLoad(new Error('network down'))
    const h = harness(server.source)
    h.controller.start()
    await flush()
    expect(h.state.status).toBe('error')
    expect(h.state.error).toBeTruthy()
    await h.controller.reload()
    expect(h.state.status).toBe('ready')
    expect(h.state.items).toHaveLength(1)
  })

  it('0029 not applied → "unavailable", never an error loop', async () => {
    const server = fakeServer()
    server.failNextLoad(new NotificationsUnavailableError())
    const h = harness(server.source)
    h.controller.start()
    await flush()
    expect(h.state.status).toBe('unavailable')
  })

  it('empty feed', async () => {
    const h = harness(fakeServer().source)
    h.controller.start()
    await flush()
    expect(h.state).toMatchObject({ status: 'ready', items: [], unreadCount: 0 })
  })
})

describe('real-time updates', () => {
  it('a new submission appears immediately and the badge goes up without a refresh', async () => {
    const server = fakeServer([n('a', 1, { readAt: 'x' })])
    const h = harness(server.source)
    h.controller.start()
    await flush()
    server.status('live')
    expect(h.state.connection).toBe('live')
    server.insert(n('new', 30))
    expect(h.state.items[0].id).toBe('new')
    expect(h.state.unreadCount).toBe(1)
    // The exact count is re-read shortly after (one query, debounced).
    const before = server.calls.countUnread
    server.insert(n('new2', 31))
    await vi.advanceTimersByTimeAsync(COUNT_RECONCILE_MS + 1)
    expect(server.calls.countUnread).toBe(before + 1)
    expect(h.state.unreadCount).toBe(2)
  })

  it('the same event delivered twice (or live + resync) shows once and counts once', async () => {
    const server = fakeServer()
    const h = harness(server.source)
    h.controller.start()
    await flush()
    server.status('live')
    const row = n('dup', 10)
    server.insert(row)
    server.deliver(row)
    await h.controller.resync()
    expect(h.state.items.filter((i) => i.id === 'dup')).toHaveLength(1)
    expect(h.state.unreadCount).toBe(1)
  })

  it('a link request decided elsewhere updates the shown status in place', async () => {
    const req = n('req', 5, { type: 'link_request', metadata: { status: 'pending' } })
    const server = fakeServer([req])
    const h = harness(server.source)
    h.controller.start()
    await flush()
    server.status('live')
    server.insert({ ...req, metadata: { status: 'approved' } })
    expect(h.state.items).toHaveLength(1)
    expect(h.state.items[0].metadata.status).toBe('approved')
    expect(h.state.unreadCount).toBe(1)
  })
})

describe('reconnection', () => {
  it('after a drop, re-joining fetches what was missed while offline', async () => {
    const server = fakeServer([n('a', 1)])
    const h = harness(server.source)
    h.controller.start()
    await flush()
    server.status('live')
    server.status('offline')
    expect(h.state.connection).toBe('offline')
    server.insert(n('missed', 40), false) // created while disconnected
    server.status('live')
    await flush()
    expect(h.state.items.map((i) => i.id)).toContain('missed')
    expect(h.state.unreadCount).toBe(2)
  })

  it('refresh fallback: quiet resyncs only while offline, none while live (until the slow safety check)', async () => {
    const server = fakeServer([n('a', 1)])
    const h = harness(server.source)
    h.controller.start()
    await flush()
    server.status('live')
    const loadsLive = server.calls.loadPage
    await vi.advanceTimersByTimeAsync(OFFLINE_RESYNC_MS * 3)
    expect(server.calls.loadPage).toBe(loadsLive) // no polling while live
    server.status('offline')
    server.insert(n('late', 50), false)
    await vi.advanceTimersByTimeAsync(OFFLINE_RESYNC_MS + 1)
    expect(h.state.items.map((i) => i.id)).toContain('late')
    const loadsBack = server.calls.loadPage
    server.status('live')
    await vi.advanceTimersByTimeAsync(OFFLINE_RESYNC_MS * 2)
    expect(server.calls.loadPage).toBe(loadsBack + 1) // only the re-join resync
  })

  it('tab shown again resyncs only when stale', async () => {
    const server = fakeServer([n('a', 1)])
    const h = harness(server.source)
    h.controller.start()
    await flush()
    const loads = server.calls.loadPage
    h.controller.resyncIfStale(Date.now() + 1000)
    await flush()
    expect(server.calls.loadPage).toBe(loads)
    h.controller.resyncIfStale(Date.now() + STALE_AFTER_MS + 1)
    await flush()
    expect(server.calls.loadPage).toBe(loads + 1)
  })
})

describe('mark read', () => {
  it('one item: badge drops at once and the server call names only that id', async () => {
    const server = fakeServer([n('a', 1), n('b', 2)])
    const h = harness(server.source)
    h.controller.start()
    await flush()
    await h.controller.markRead(['a'])
    expect(h.state.unreadCount).toBe(1)
    expect(server.calls.markRead).toEqual([['a']])
  })

  it('all items', async () => {
    const server = fakeServer([n('a', 1), n('b', 2)])
    const h = harness(server.source)
    h.controller.start()
    await flush()
    await h.controller.markAllRead()
    expect(h.state.unreadCount).toBe(0)
    expect(await server.source.countUnread()).toBe(0)
  })

  it('a failed mark-read is reported and the feed resyncs to the server truth', async () => {
    const server = fakeServer([n('a', 1)])
    server.source.markRead = async () => {
      throw new Error('offline')
    }
    const h = harness(server.source)
    h.controller.start()
    await flush()
    await expect(h.controller.markRead(['a'])).rejects.toThrow('offline')
    await flush()
    expect(h.state.unreadCount).toBe(1)
  })
})

describe('cleanup', () => {
  it('stop removes the channel, clears timers and ignores late responses', async () => {
    const server = fakeServer([n('a', 1)])
    const h = harness(server.source)
    h.controller.start()
    expect(server.subscribed).toBe(true)
    h.controller.stop() // before the first load resolves
    await flush()
    expect(server.calls.unsubscribed).toBe(1)
    expect(server.subscribed).toBe(false)
    expect(h.state.status).toBe('loading') // late page ignored
    const loads = server.calls.loadPage
    await vi.advanceTimersByTimeAsync(OFFLINE_RESYNC_MS * 3)
    expect(server.calls.loadPage).toBe(loads)
  })
})

describe('Demo Mode feed', () => {
  const input = {
    subjects: [{ id: 'subject-science', name: 'วิทยาศาสตร์', code: 'ว1', academicYear: '2569', semester: '1', description: '', classroomIds: ['classroom-1'] }],
    classrooms: [{ id: 'classroom-1', name: 'ม.5/1', studentIds: ['s1', 's2'] }],
    allStudents: [
      { id: 's1', number: 1, studentCode: '1', firstName: 'ณัฐพล', lastName: 'มงคลชัย', nickname: '', classroom: 'ม.5/1', status: 'active' as const },
      { id: 's2', number: 2, studentCode: '2', firstName: 'ชนิสรา', lastName: 'พูนสิน', nickname: '', classroom: 'ม.5/1', status: 'active' as const },
    ],
    subjectAssignments: [
      {
        id: 'as1',
        subjectId: 'subject-science',
        classroomId: 'classroom-1',
        topicId: null,
        title: 'ใบงานที่ 1',
        type: 'homework' as const,
        maxScore: 10,
        dueDate: '2026-10-20',
        description: '',
        isArchived: false,
        submissions: { s1: { status: 'submitted' as const, score: null, note: '' }, s2: { status: 'not_submitted' as const, score: null, note: '' } },
      },
    ],
  }

  it('built from demo data, links to real demo pages, mark read works in memory', async () => {
    const seed = buildDemoTeacherNotifications(input as never, new Date('2026-10-10T04:00:00Z'))
    const submission = seed.find((x) => x.type === 'assignment_submitted')
    expect(submission?.metadata).toMatchObject({ student_name: 'ณัฐพล มงคลชัย', assignment_title: 'ใบงานที่ 1', subject_name: 'วิทยาศาสตร์', classroom_name: 'ม.5/1' })
    expect(seed.some((x) => x.type === 'link_request')).toBe(true)
    expect(seed.every((x) => x.origin === 'demo')).toBe(true)
    const source = createDemoNotificationSource(seed)
    expect(source.subscribe).toBeUndefined()
    const before = await source.countUnread()
    await source.markRead([submission!.id])
    expect(await source.countUnread()).toBe(before - 1)
    await source.markAllRead()
    expect(await source.countUnread()).toBe(0)
  })
})

describe('teacher bell stays current while Class N is open', () => {
  it('a channel that never becomes live (stuck join) falls back to resyncs instead of waiting forever', async () => {
    const server = fakeServer([n('a', 1)])
    const h = harness(server.source)
    h.controller.start()
    await flush()
    expect(h.state.connection).toBe('connecting')
    await vi.advanceTimersByTimeAsync(LIVE_TIMEOUT_MS + 1)
    expect(h.state.connection).toBe('offline')
    server.insert(n('req', 20, { type: 'link_request' }), false) // never delivered live
    await vi.advanceTimersByTimeAsync(OFFLINE_RESYNC_MS + 1)
    expect(h.state.items.map((i) => i.id)).toContain('req')
    expect(h.state.unreadCount).toBe(2)
  })

  it('a row created between the first load and the channel going live is not missed', async () => {
    const server = fakeServer([n('a', 1)])
    const h = harness(server.source)
    h.controller.start()
    await flush()
    server.insert(n('gap', 15), false) // committed before the join finished
    server.status('live')
    await flush()
    expect(h.state.items.map((i) => i.id)).toContain('gap')
  })

  it('onNew: reports each new unread row once (live, duplicate delivery, resync) — never the first load', async () => {
    const server = fakeServer([n('old', 1)])
    const h = harness(server.source)
    h.controller.start()
    await flush()
    server.status('live')
    await flush()
    expect(h.reported).toEqual([])
    const r1 = n('r1', 59, { type: 'link_request', createdAt: new Date().toISOString() })
    server.insert(r1)
    server.deliver(r1)
    await h.controller.resync()
    expect(h.reported).toEqual([['r1']])
  })

  it('several students submitting close together: every request shows, counted once each', async () => {
    const server = fakeServer()
    const h = harness(server.source)
    h.controller.start()
    await flush()
    server.status('live')
    const now = new Date().toISOString()
    for (const id of ['s1', 's2', 's3']) server.insert(n(id, 59, { type: 'link_request', createdAt: now, id }))
    await vi.advanceTimersByTimeAsync(COUNT_RECONCILE_MS + 1)
    expect(h.state.items.map((i) => i.id).sort()).toEqual(['s1', 's2', 's3'])
    expect(h.state.unreadCount).toBe(3)
    expect(h.reported.flat().sort()).toEqual(['s1', 's2', 's3'])
  })

  it('returning to the tab after 10 s catches up (the socket may have been dropped in the background)', async () => {
    expect(STALE_AFTER_MS).toBe(10_000)
    expect(OFFLINE_RESYNC_MS).toBe(20_000)
    const server = fakeServer([n('a', 1)])
    const h = harness(server.source)
    h.controller.start()
    await flush()
    server.status('live')
    await flush()
    server.insert(n('bg', 30, { type: 'link_request', createdAt: new Date().toISOString() }), false)
    h.controller.resyncIfStale(Date.now() + STALE_AFTER_MS + 1)
    await flush()
    expect(h.state.items.map((i) => i.id)).toContain('bg')
    expect(h.reported).toEqual([['bg']])
  })

  it('stop also clears the live-timeout watchdog', async () => {
    const server = fakeServer()
    const h = harness(server.source)
    h.controller.start()
    await flush()
    h.controller.stop()
    const loads = server.calls.loadPage
    await vi.advanceTimersByTimeAsync(LIVE_TIMEOUT_MS + OFFLINE_RESYNC_MS * 2)
    expect(server.calls.loadPage).toBe(loads)
  })
})

describe('live but silent (Realtime subscribed, nothing delivered)', () => {
  it('a slow safety re-read every 90 s while live and visible bounds the staleness', async () => {
    const server = fakeServer([n('a', 1)])
    const h = harness(server.source)
    h.controller.start()
    await flush()
    server.status('live')
    await flush()
    server.insert(n('silent', 30, { type: 'link_request' }), false) // never delivered live
    await vi.advanceTimersByTimeAsync(LIVE_SAFETY_RESYNC_MS - 5_000)
    expect(h.state.items.map((i) => i.id)).not.toContain('silent')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(h.state.items.map((i) => i.id)).toContain('silent')
    h.controller.stop()
  })
})
