import { describe, expect, it } from 'vitest'

import type { AttendanceRecord } from '@/types/attendance'

import { AttendanceAutoSaver, type AutoSaveSnapshot } from './attendance-autosave'
import { markAllPresent, UNCHECKED_ENTRY, withNote, withStatus, type BoardEntries, type BoardStatus } from './attendance-board-model'

/** A fake server: each save() call is a request the test resolves/rejects by hand. */
function harness(initial: BoardEntries = {}, ids = ['a', 'b', 'c']) {
  const requests: { records: AttendanceRecord[]; resolve: () => void; reject: (e: unknown) => void }[] = []
  /** What the database holds, applied in the order requests complete. */
  const db: Record<string, string> = {}
  const timers: { fn: () => void; ms: number }[] = []
  const snapshots: AutoSaveSnapshot[] = []
  const saved: AttendanceRecord[][] = []
  let inFlight = 0
  let maxInFlight = 0
  const saver = new AttendanceAutoSaver({
    save: (records) =>
      new Promise<void>((resolve, reject) => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        requests.push({
          records,
          resolve: () => {
            for (const r of records) db[r.studentId] = r.status + (r.note ? `:${r.note}` : '')
            inFlight -= 1
            resolve()
          },
          reject: (e) => {
            inFlight -= 1
            reject(e)
          },
        })
      }),
    onChange: (s) => snapshots.push(s),
    onSaved: (r) => saved.push(r),
    errorMessage: (e) => `ERR:${String((e as Error).message)}`,
    setTimer: (fn, ms) => {
      const t = { fn, ms }
      timers.push(t)
      return t
    },
    clearTimer: (h) => {
      const i = timers.indexOf(h as { fn: () => void; ms: number })
      if (i >= 0) timers.splice(i, 1)
    },
  })
  saver.reset(ids, initial)
  let entries: BoardEntries = { ...initial }
  const tick = () => {
    const due = timers.splice(0)
    for (const t of due) t.fn()
  }
  const settle = () => new Promise((r) => setTimeout(r, 0))
  return {
    saver,
    requests,
    db,
    saved,
    snap: () => saver.snapshot(),
    get maxInFlight() {
      return maxInFlight
    },
    set: (id: string, status: BoardStatus) => {
      entries = withStatus(entries, id, status)
      saver.update(entries)
    },
    note: (id: string, note: string) => {
      entries = withNote(entries, id, note)
      saver.update(entries)
    },
    all: (list: string[]) => {
      entries = markAllPresent(entries, list)
      saver.update(entries)
    },
    tick,
    settle,
    timers,
  }
}

describe('AttendanceAutoSaver', () => {
  it('a single change is shown at once, saved after the debounce, then confirmed', async () => {
    const h = harness()
    h.set('a', 'present')
    expect(h.snap().desired.a.status).toBe('present')
    expect(h.snap().status).toBe('pending')
    expect(h.snap().hasUnsaved).toBe(true)
    expect(h.requests).toHaveLength(0)
    h.tick()
    expect(h.requests).toHaveLength(1)
    expect(h.requests[0].records).toEqual([{ studentId: 'a', status: 'present', note: null }])
    expect(h.snap().status).toBe('saving')
    h.requests[0].resolve()
    await h.settle()
    expect(h.snap().status).toBe('saved')
    expect(h.snap().confirmed.a.status).toBe('present')
    expect(h.snap().hasUnsaved).toBe(false)
    expect(h.db.a).toBe('present')
  })

  it('rapid repeated clicks are coalesced: one request with the latest status', async () => {
    const h = harness()
    for (const s of ['present', 'late', 'absent', 'leave', 'sick', 'present', 'late'] as BoardStatus[]) h.set('a', s)
    h.tick()
    expect(h.requests).toHaveLength(1)
    expect(h.requests[0].records[0].status).toBe('late')
    h.requests[0].resolve()
    await h.settle()
    expect(h.db.a).toBe('late')
  })

  it('clicks during an in-flight save never overlap requests; the latest status wins in the database', async () => {
    const h = harness()
    h.set('a', 'present')
    h.tick()
    h.set('a', 'absent') // while request 1 is in flight
    h.set('a', 'late')
    h.tick() // debounce fires but must wait for request 1
    expect(h.requests).toHaveLength(1)
    h.requests[0].resolve()
    await h.settle()
    expect(h.requests).toHaveLength(2)
    expect(h.requests[1].records).toEqual([{ studentId: 'a', status: 'late', note: null }])
    expect(h.maxInFlight).toBe(1)
    h.requests[1].resolve()
    await h.settle()
    expect(h.db.a).toBe('late')
    expect(h.snap().status).toBe('saved')
  })

  it('a stale response never overwrites a newer selection on screen', async () => {
    const h = harness()
    h.set('a', 'present')
    h.tick()
    h.set('a', 'absent')
    h.requests[0].resolve() // confirms "present", the OLD value
    await h.settle()
    expect(h.snap().desired.a.status).toBe('absent')
    expect(h.snap().confirmed.a.status).toBe('present')
    expect(h.snap().pendingIds.has('a')).toBe(true)
    expect(h.snap().status).not.toBe('saved')
  })

  it('bulk "มาครบทุกคน" is one batched request for every student', async () => {
    const h = harness()
    h.all(['a', 'b', 'c'])
    h.tick()
    expect(h.requests).toHaveLength(1)
    expect(h.requests[0].records.map((r) => r.studentId).sort()).toEqual(['a', 'b', 'c'])
    h.requests[0].resolve()
    await h.settle()
    expect(h.db).toEqual({ a: 'present', b: 'present', c: 'present' })
  })

  it('only changed students are sent; unchanged history is never rewritten', async () => {
    const h = harness({ a: { status: 'late', note: '' }, b: { status: 'present', note: '' }, c: UNCHECKED_ENTRY })
    h.set('c', 'absent')
    h.tick()
    expect(h.requests[0].records).toEqual([{ studentId: 'c', status: 'absent', note: null }])
  })

  it('setting a student back to the saved value cancels the pending write', () => {
    const h = harness({ a: { status: 'present', note: '' } })
    h.set('a', 'late')
    h.set('a', 'present')
    h.tick()
    expect(h.requests).toHaveLength(0)
    expect(h.snap().hasUnsaved).toBe(false)
  })

  it('notes and sick leave are encoded exactly like the old manual save', () => {
    const h = harness()
    h.set('a', 'sick')
    h.note('a', 'ไข้')
    h.tick()
    expect(h.requests[0].records).toEqual([{ studentId: 'a', status: 'leave', note: '[ลาป่วย] ไข้' }])
  })

  it('failure: change kept and marked failed, never shown as saved; retry sends it again', async () => {
    const h = harness()
    h.set('a', 'absent')
    h.tick()
    h.requests[0].reject(new Error('offline'))
    await h.settle()
    let s = h.snap()
    expect(s.status).toBe('error')
    expect(s.error).toBe('ERR:offline')
    expect(s.desired.a.status).toBe('absent')
    expect(s.failedIds.has('a')).toBe(true)
    expect(s.hasUnsaved).toBe(true)
    expect(h.saved).toHaveLength(0)
    h.saver.retry()
    expect(h.requests).toHaveLength(2)
    expect(h.requests[1].records).toEqual([{ studentId: 'a', status: 'absent', note: null }])
    h.requests[1].resolve()
    await h.settle()
    s = h.snap()
    expect(s.status).toBe('saved')
    expect(s.failedIds.size).toBe(0)
    expect(h.db.a).toBe('absent')
  })

  it('a new edit after a failure re-sends everything still pending, with the latest values', async () => {
    const h = harness()
    h.set('a', 'absent')
    h.tick()
    h.requests[0].reject(new Error('500'))
    await h.settle()
    h.set('b', 'late')
    h.tick()
    expect(h.requests[1].records.map((r) => `${r.studentId}:${r.status}`).sort()).toEqual(['a:absent', 'b:late'])
  })

  it('unauthorized (permission error) is a failure, not a success', async () => {
    const h = harness()
    h.set('a', 'present')
    h.tick()
    h.requests[0].reject(Object.assign(new Error('ไม่พบห้องเรียนนี้ หรือคุณไม่มีสิทธิ์เข้าถึง'), { code: '42501' }))
    await h.settle()
    expect(h.snap().status).toBe('error')
    expect(h.snap().error).toContain('ไม่มีสิทธิ์')
    expect(h.db.a).toBeUndefined()
  })

  it('flushNow saves immediately and resolves true; false when the save fails', async () => {
    const h = harness()
    h.set('a', 'present')
    const done = h.saver.flushNow()
    expect(h.requests).toHaveLength(1)
    expect(h.timers).toHaveLength(0)
    h.requests[0].resolve()
    expect(await done).toBe(true)

    h.set('b', 'late')
    const failed = h.saver.flushNow()
    h.requests[1].reject(new Error('x'))
    expect(await failed).toBe(false)
  })

  it('switching session (reset) ignores late responses from the previous session', async () => {
    const h = harness()
    h.set('a', 'absent')
    h.tick()
    h.saver.reset(['a', 'b'], { a: { status: 'present', note: '' } }) // another date
    h.requests[0].resolve()
    await h.settle()
    expect(h.snap().confirmed.a.status).toBe('present')
    expect(h.snap().desired.a.status).toBe('present')
    expect(h.snap().hasUnsaved).toBe(false)
  })

  it('discard drops unsaved changes (teacher confirmed) and nothing is sent afterwards', async () => {
    const h = harness()
    h.set('a', 'absent')
    h.tick()
    h.requests[0].reject(new Error('x'))
    await h.settle()
    h.saver.discard()
    expect(h.snap().hasUnsaved).toBe(false)
    h.saver.dispose()
    await h.settle()
    expect(h.requests).toHaveLength(1)
  })

  it('dispose (leaving the page) still sends pending changes, after any in-flight request', async () => {
    const h = harness()
    h.set('a', 'present')
    h.tick()
    h.set('a', 'late')
    h.saver.dispose()
    expect(h.requests).toHaveLength(1)
    h.requests[0].resolve()
    await h.settle()
    expect(h.requests).toHaveLength(2)
    expect(h.requests[1].records).toEqual([{ studentId: 'a', status: 'late', note: null }])
    expect(h.maxInFlight).toBe(1)
  })

  it('an unchecked student is never sent', () => {
    const h = harness()
    h.set('a', 'unchecked')
    h.tick()
    expect(h.requests).toHaveLength(0)
  })
})
