import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NoteAutosaver } from './note-autosave'
import { WorkspaceStore } from './workspace-store'
import type { NotePatch, NoteSaveResult, TaskPatch, WorkspaceNote, WorkspaceRepository, WorkspaceTask } from './workspace-types'
import { WorkspaceNotInstalledError } from './workspace-types'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const baseNote = (p: Partial<WorkspaceNote> = {}): WorkspaceNote => ({ id: 'n1', title: '', body: '', category: null, tags: [], pinned: false, archivedAt: null, revision: 1, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', ...p })
const baseTask = (p: Partial<WorkspaceTask> = {}): WorkspaceTask => ({ id: 't1', title: 'งาน', description: '', status: 'todo', priority: 'medium', dueDate: null, startDate: null, category: null, important: false, urgent: false, sortOrder: 0, completedAt: null, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', ...p })

/** A tiny in-memory server; every call can be held or failed by the test. */
function fakeRepo() {
  const server = { notes: [baseNote()], tasks: [baseTask()], links: [] as never[] }
  const calls: string[] = []
  const hold: { next: ReturnType<typeof deferred<void>> | null } = { next: null }
  let failNext = 0
  const gate = async (name: string) => {
    calls.push(name)
    if (hold.next) {
      const d = hold.next
      hold.next = null
      await d.promise
    }
    if (failNext > 0) {
      failNext -= 1
      throw new Error('network down')
    }
  }
  const repo: WorkspaceRepository = {
    load: async () => structuredClone(server),
    createNote: async (id, input) => {
      await gate('createNote')
      const n = baseNote({ id, ...input })
      server.notes.push(n)
      return structuredClone(n)
    },
    updateNote: async (id, patch: NotePatch, rev): Promise<NoteSaveResult> => {
      await gate(`updateNote:${JSON.stringify(patch)}@${rev}`)
      const n = server.notes.find((x) => x.id === id)
      if (!n || (rev !== undefined && n.revision !== rev)) return { ok: false, reason: 'conflict', latest: n ? structuredClone(n) : null }
      Object.assign(n, patch, { revision: n.revision + 1 })
      return { ok: true, note: structuredClone(n) }
    },
    deleteNote: async (id) => {
      await gate('deleteNote')
      server.notes = server.notes.filter((n) => n.id !== id)
    },
    createLink: async () => {
      throw new Error('unused')
    },
    updateLink: async () => {
      throw new Error('unused')
    },
    deleteLink: async () => undefined,
    linkOpened: async () => undefined,
    createTask: async (id, input) => {
      await gate('createTask')
      const t = baseTask({ id, ...input })
      server.tasks.push(t)
      return structuredClone(t)
    },
    updateTask: async (id, patch: TaskPatch) => {
      await gate(`updateTask:${JSON.stringify(patch)}`)
      const t = server.tasks.find((x) => x.id === id)!
      Object.assign(t, patch)
      return structuredClone(t)
    },
    deleteTask: async (id) => {
      await gate('deleteTask')
      server.tasks = server.tasks.filter((t) => t.id !== id)
    },
  }
  return { repo, server, calls, hold, fail: (n = 1) => (failNext = n) }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('NoteAutosaver', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('debounces rapid typing into one save with the latest text', async () => {
    const save = vi.fn(async (patch: NotePatch, rev: number): Promise<NoteSaveResult> => ({ ok: true, note: baseNote({ ...patch, revision: rev + 1 }) }))
    const s = new NoteAutosaver({ save, revision: 1, delayMs: 500 })
    for (const body of ['ส', 'สว', 'สวั', 'สวัส', 'สวัสดี']) {
      s.edit({ body })
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ body: 'สวัสดี' }, 1)
    expect(s.currentStatus.state).toBe('saved')
    expect(s.hasUnsaved()).toBe(false)
  })

  it('edits during a save wait for it; saves never overlap or arrive out of order', async () => {
    const first = deferred<NoteSaveResult>()
    const save = vi.fn((patch: NotePatch, rev: number) => (save.mock.calls.length === 1 ? first.promise : Promise.resolve<NoteSaveResult>({ ok: true, note: baseNote({ ...patch, revision: rev + 1 }) })))
    const s = new NoteAutosaver({ save, revision: 1, delayMs: 100 })
    s.edit({ body: 'a' })
    await vi.advanceTimersByTimeAsync(100)
    s.edit({ body: 'ab' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1) // still waiting for the first
    first.resolve({ ok: true, note: baseNote({ body: 'a', revision: 2 }) })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]).toEqual([{ body: 'ab' }, 2]) // based on the new revision
    expect(s.currentStatus.state).toBe('saved')
  })

  it('a failed save keeps the edit (newer typing wins) and retries', async () => {
    let n = 0
    const save = vi.fn(async (patch: NotePatch, rev: number): Promise<NoteSaveResult> => {
      n += 1
      if (n === 1) throw new Error('offline')
      return { ok: true, note: baseNote({ ...patch, revision: rev + 1 }) }
    })
    const s = new NoteAutosaver({ save, revision: 1, delayMs: 100, retryDelaysMs: [1000] })
    s.edit({ title: 'หัวข้อ', body: 'เก่า' })
    await vi.advanceTimersByTimeAsync(100)
    expect(s.currentStatus.state).toBe('error')
    expect(s.hasUnsaved()).toBe(true)
    s.edit({ body: 'ใหม่' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenLastCalledWith({ title: 'หัวข้อ', body: 'ใหม่' }, 1)
    expect(s.currentStatus.state).toBe('saved')
  })

  it('reports offline, and retries at once when the network returns', async () => {
    let online = false
    const save = vi.fn(async (patch: NotePatch, rev: number): Promise<NoteSaveResult> => {
      if (!online) throw new TypeError('Failed to fetch')
      return { ok: true, note: baseNote({ ...patch, revision: rev + 1 }) }
    })
    const s = new NoteAutosaver({ save, revision: 1, delayMs: 10, retryDelaysMs: [60_000], isOnline: () => online })
    s.edit({ body: 'x' })
    await vi.advanceTimersByTimeAsync(10)
    expect(s.currentStatus.state).toBe('offline')
    online = true
    s.online()
    await vi.advanceTimersByTimeAsync(0)
    expect(s.currentStatus.state).toBe('saved')
  })

  it('a save based on a stale revision stops in conflict instead of overwriting', async () => {
    const onConflict = vi.fn()
    const latest = baseNote({ body: 'จากอีกเครื่อง', revision: 5 })
    const save = vi.fn(async (patch: NotePatch, rev: number): Promise<NoteSaveResult> => (rev === 1 ? { ok: false, reason: 'conflict', latest } : { ok: true, note: baseNote({ ...patch, revision: rev + 1 }) }))
    const s = new NoteAutosaver({ save, revision: 1, delayMs: 10, onConflict })
    s.edit({ body: 'ของฉัน' })
    await vi.advanceTimersByTimeAsync(10)
    expect(s.currentStatus.state).toBe('conflict')
    expect(onConflict).toHaveBeenCalledWith(latest)
    s.edit({ body: 'ของฉัน 2' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1) // no further saves while in conflict
    s.keepMine(5, { title: '', body: 'ของฉัน 2' })
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenLastCalledWith({ title: '', body: 'ของฉัน 2' }, 5)
    expect(s.currentStatus.state).toBe('saved')
  })

  it('flush() saves immediately (leaving the page)', async () => {
    const save = vi.fn(async (patch: NotePatch, rev: number): Promise<NoteSaveResult> => ({ ok: true, note: baseNote({ ...patch, revision: rev + 1 }) }))
    const s = new NoteAutosaver({ save, revision: 1, delayMs: 10_000 })
    s.edit({ body: 'ก่อนออก' })
    await s.flush()
    expect(save).toHaveBeenCalledWith({ body: 'ก่อนออก' }, 1)
  })

  it('invalid content is not sent', async () => {
    const save = vi.fn()
    const s = new NoteAutosaver({ save, revision: 1, delayMs: 10, validate: (p) => ((p.title ?? '').length > 3 ? 'ยาวเกิน' : null) })
    s.edit({ title: 'ยาวมาก' })
    await vi.advanceTimersByTimeAsync(100)
    expect(save).not.toHaveBeenCalled()
    expect(s.currentStatus).toEqual({ state: 'invalid', message: 'ยาวเกิน' })
  })
})

describe('WorkspaceStore', () => {
  it('loads, and reports a missing migration distinctly', async () => {
    const { repo } = fakeRepo()
    const store = new WorkspaceStore(repo)
    await store.load()
    expect(store.getState().status).toBe('ready')
    const broken = new WorkspaceStore({ ...repo, load: async () => Promise.reject(new WorkspaceNotInstalledError()) })
    await broken.load()
    expect(broken.getState().status).toBe('not_installed')
  })

  it('optimistic task update shows at once; a failure rolls back and reports', async () => {
    const f = fakeRepo()
    const onError = vi.fn()
    const store = new WorkspaceStore(f.repo, { onError })
    await store.load()
    f.fail()
    const pending = store.setTaskStatus('t1', 'done')
    expect(store.getState().tasks[0].status).toBe('done') // immediately
    expect(store.getState().tasks[0].completedAt).not.toBeNull()
    expect(await pending).toBe(false)
    expect(store.getState().tasks[0].status).toBe('todo')
    expect(store.getState().tasks[0].completedAt).toBeNull()
    expect(onError).toHaveBeenCalledWith('บันทึกงานไม่สำเร็จ', expect.any(Error))
  })

  it('writes to one task are sent in order; an older response never overwrites a newer edit', async () => {
    const f = fakeRepo()
    const store = new WorkspaceStore(f.repo)
    await store.load()
    const held = deferred<void>()
    f.hold.next = held
    const a = store.updateTask('t1', { status: 'in_progress' })
    const b = store.updateTask('t1', { status: 'done' })
    await flush()
    expect(f.calls).toEqual(['updateTask:{"status":"in_progress"}']) // b waits for a
    held.resolve()
    await Promise.all([a, b])
    expect(f.calls[1]).toContain('"status":"done"')
    expect(store.getState().tasks[0].status).toBe('done')
    expect(f.server.tasks[0].status).toBe('done')
  })

  it('a failed earlier write does not undo a later one that succeeded', async () => {
    const f = fakeRepo()
    const store = new WorkspaceStore(f.repo)
    await store.load()
    f.fail(1)
    const a = store.updateTask('t1', { title: 'ล้มเหลว' })
    const b = store.updateTask('t1', { priority: 'high' })
    await Promise.all([a, b])
    const t = store.getState().tasks[0]
    expect(t.priority).toBe('high')
    expect(t.title).toBe('งาน') // the server's version, not the failed edit
  })

  it('create uses a client id (retry-safe) and delete rolls back on failure', async () => {
    const f = fakeRepo()
    const store = new WorkspaceStore(f.repo, { onError: () => undefined })
    await store.load()
    const created = await store.createTask({ title: 'งานใหม่', dueDate: '2026-11-03' })
    expect(created?.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(f.server.tasks.map((t) => t.id)).toContain(created!.id)
    f.fail()
    expect(await store.deleteTask(created!.id)).toBe(false)
    expect(store.getState().tasks.map((t) => t.id)).toContain(created!.id)
  })

  it('note edits autosave through the store and keep local text while typing', async () => {
    vi.useFakeTimers()
    try {
      const f = fakeRepo()
      const store = new WorkspaceStore(f.repo, { autosaveDelayMs: 50 })
      await store.load()
      store.editNote('n1', { body: 'สวัสดี' })
      expect(store.getState().notes[0].body).toBe('สวัสดี')
      expect(store.hasPendingWrites()).toBe(true)
      await vi.advanceTimersByTimeAsync(50)
      await vi.advanceTimersByTimeAsync(0)
      expect(f.server.notes[0].body).toBe('สวัสดี')
      expect(store.getState().noteStatus.n1.state).toBe('saved')
      expect(store.getState().notes[0].revision).toBe(2)
      expect(store.hasPendingWrites()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a note changed on another device is not overwritten; teacher chooses', async () => {
    vi.useFakeTimers()
    try {
      const f = fakeRepo()
      const store = new WorkspaceStore(f.repo, { autosaveDelayMs: 10 })
      await store.load()
      // Another device saves first.
      Object.assign(f.server.notes[0], { body: 'อุปกรณ์ B', revision: 2 })
      store.editNote('n1', { body: 'อุปกรณ์ A' })
      await vi.advanceTimersByTimeAsync(10)
      await vi.advanceTimersByTimeAsync(0)
      expect(f.server.notes[0].body).toBe('อุปกรณ์ B')
      expect(store.getState().noteConflicts.n1?.body).toBe('อุปกรณ์ B')
      store.resolveConflict('n1', 'mine')
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(0)
      expect(f.server.notes[0].body).toBe('อุปกรณ์ A')
      expect(store.getState().noteConflicts.n1).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps an unsaved draft locally and offers it again after a reload', async () => {
    vi.useFakeTimers()
    try {
      const mem = new Map<string, string>()
      const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }
      const f = fakeRepo()
      const store = new WorkspaceStore(f.repo, { storage, ownerKey: 'u1', autosaveDelayMs: 10 })
      await store.load()
      f.fail(99)
      store.editNote('n1', { body: 'ยังไม่ถึงเซิร์ฟเวอร์' })
      await vi.advanceTimersByTimeAsync(10)
      store.dispose() // the tab closes
      const again = new WorkspaceStore(f.repo, { storage, ownerKey: 'u1' })
      f.fail(0)
      await again.load()
      expect(again.getState().recoverableDrafts.n1?.fields.body).toBe('ยังไม่ถึงเซิร์ฟเวอร์')
      // Another account never sees it.
      const other = new WorkspaceStore(f.repo, { storage, ownerKey: 'u2' })
      await other.load()
      expect(other.getState().recoverableDrafts.n1).toBeUndefined()
      again.restoreDraft('n1')
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(0)
      expect(f.server.notes[0].body).toBe('ยังไม่ถึงเซิร์ฟเวอร์')
      expect(mem.size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a new note opens at once; typing before the insert lands is saved after it', async () => {
    vi.useFakeTimers()
    try {
      const f = fakeRepo()
      const store = new WorkspaceStore(f.repo, { autosaveDelayMs: 10 })
      await store.load()
      const held = deferred<void>()
      f.hold.next = held
      const note = store.createNote()
      expect(store.getState().notes.map((n) => n.id)).toContain(note.id) // immediately
      store.editNote(note.id, { title: 'พิมพ์ทันที' })
      await vi.advanceTimersByTimeAsync(50)
      expect(f.calls).toEqual(['createNote']) // the save waits for the insert
      held.resolve()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(20)
      expect(f.calls[1]).toContain('พิมพ์ทันที')
      expect(f.server.notes.find((n) => n.id === note.id)?.title).toBe('พิมพ์ทันที')
      expect(store.getState().notes.find((n) => n.id === note.id)?.title).toBe('พิมพ์ทันที')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a failed note insert removes the optimistic note and reports', async () => {
    const f = fakeRepo()
    const onError = vi.fn()
    const store = new WorkspaceStore(f.repo, { onError })
    await store.load()
    f.fail()
    const note = store.createNote()
    await flush()
    await flush()
    expect(store.getState().notes.map((n) => n.id)).not.toContain(note.id)
    expect(onError).toHaveBeenCalledWith('สร้างบันทึกไม่สำเร็จ', expect.any(Error))
  })

  it('a silent refresh keeps local rows that still have a write in flight', async () => {
    const f = fakeRepo()
    const store = new WorkspaceStore(f.repo)
    await store.load()
    const held = deferred<void>()
    f.hold.next = held
    const p = store.updateTask('t1', { title: 'กำลังบันทึก' })
    await store.load({ silent: true })
    expect(store.getState().tasks[0].title).toBe('กำลังบันทึก')
    held.resolve()
    await p
  })
})
