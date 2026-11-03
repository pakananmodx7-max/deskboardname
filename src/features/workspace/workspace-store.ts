import { NoteAutosaver, type AutosaveStatus } from './note-autosave'
import { validateNoteFields } from './workspace-notes-model'
import { edgeSortOrder, statusChangePatch } from './workspace-tasks-model'
import {
  newId,
  WorkspaceNotInstalledError,
  type LinkInput,
  type LinkPatch,
  type NoteFields,
  type NotePatch,
  type TaskInput,
  type TaskPatch,
  type TaskStatus,
  type WorkspaceLink,
  type WorkspaceNote,
  type WorkspaceRepository,
  type WorkspaceTask,
} from './workspace-types'

export type WorkspaceLoadStatus = 'loading' | 'ready' | 'error' | 'not_installed'

export interface NoteDraft {
  fields: NoteFields
  savedAt: number
}

export interface WorkspaceState {
  status: WorkspaceLoadStatus
  error: string | null
  notes: WorkspaceNote[]
  links: WorkspaceLink[]
  tasks: WorkspaceTask[]
  /** Autosave state per note id (only notes edited this visit). */
  noteStatus: Record<string, AutosaveStatus>
  /** Notes whose save hit a newer version: the other version (null = deleted). */
  noteConflicts: Record<string, WorkspaceNote | null>
  /** Unsaved text found from an earlier visit (e.g. the tab closed offline). */
  recoverableDrafts: Record<string, NoteDraft>
  loadedAt: number | null
}

export interface WorkspaceStoreOptions {
  /** User-facing error (toast). */
  onError?: (message: string, error: unknown) => void
  /** Scopes the local draft backup to one account. */
  ownerKey?: string
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
  isOnline?: () => boolean
  autosaveDelayMs?: number
}

type Kind = 'tasks' | 'links' | 'notes'
type Row = WorkspaceTask | WorkspaceLink | WorkspaceNote

const INITIAL: WorkspaceState = {
  status: 'loading',
  error: null,
  notes: [],
  links: [],
  tasks: [],
  noteStatus: {},
  noteConflicts: {},
  recoverableDrafts: {},
  loadedAt: null,
}

const DRAFT_PREFIX = 'kc-workspace-draft'

function pickNoteFields(n: WorkspaceNote): NoteFields {
  return { title: n.title, body: n.body, category: n.category, tags: n.tags, pinned: n.pinned, archivedAt: n.archivedAt }
}

function sameFields(a: NoteFields, b: NoteFields): boolean {
  return a.title === b.title && a.body === b.body && (a.category ?? null) === (b.category ?? null) && a.tags.join('\u0001') === b.tags.join('\u0001')
}

/**
 * The single source of truth for every workspace view. All task views
 * (list, matrix, calendar, board) read `tasks` from here, so a change in
 * one shows in the others immediately.
 *
 * Writes are optimistic with a correct rollback:
 * - writes to the same record are queued, so the server receives them in
 *   order;
 * - a response is applied only if no newer local change to that record
 *   exists (a stale response never overwrites a newer edit);
 * - a failure restores the last version the server confirmed.
 * Note text goes through one NoteAutosaver per note (see note-autosave.ts).
 */
export class WorkspaceStore {
  private state: WorkspaceState = INITIAL
  private readonly listeners = new Set<() => void>()
  private readonly repo: WorkspaceRepository
  private readonly opts: WorkspaceStoreOptions
  private readonly versions = new Map<string, number>()
  private readonly confirmed = new Map<string, Row | null>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly savers = new Map<string, NoteAutosaver>()
  private inFlight = 0
  private loadSeq = 0

  constructor(repo: WorkspaceRepository, opts: WorkspaceStoreOptions = {}) {
    this.repo = repo
    this.opts = opts
  }

  // ---------------------------------------------------------------- state

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  getState = () => this.state

  private set(patch: Partial<WorkspaceState>) {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn()
  }

  private rows<K extends Kind>(kind: K): WorkspaceState[K] {
    return this.state[kind]
  }

  private replaceRow(kind: Kind, id: string, row: Row | null) {
    const list = this.rows(kind) as Row[]
    const exists = list.some((r) => r.id === id)
    const next = row === null ? list.filter((r) => r.id !== id) : exists ? list.map((r) => (r.id === id ? row : r)) : [...list, row]
    this.set({ [kind]: next } as Partial<WorkspaceState>)
  }

  private find<K extends Kind>(kind: K, id: string): WorkspaceState[K][number] | undefined {
    return (this.rows(kind) as Row[]).find((r) => r.id === id) as WorkspaceState[K][number] | undefined
  }

  /** Writes not yet answered (or notes not yet saved). */
  hasPendingWrites(): boolean {
    return this.inFlight > 0 || [...this.savers.values()].some((s) => s.hasUnsaved())
  }

  // ----------------------------------------------------------------- load

  async load(options: { silent?: boolean } = {}) {
    const seq = ++this.loadSeq
    if (!options.silent) this.set({ status: this.state.loadedAt ? this.state.status : 'loading', error: null })
    try {
      const data = await this.repo.load()
      if (seq !== this.loadSeq) return
      // Keep local versions of anything with a write still in flight.
      const keep = <T extends Row>(kind: Kind, fresh: T[]): T[] => {
        const busy = new Set([...this.queues.keys()].filter((id) => this.find(kind, id)))
        if (kind === 'notes') for (const [id, s] of this.savers) if (s.hasUnsaved()) busy.add(id)
        const local = (this.rows(kind) as T[]).filter((r) => busy.has(r.id))
        return [...fresh.filter((r) => !busy.has(r.id)), ...local]
      }
      for (const row of [...data.tasks, ...data.links, ...data.notes]) if (!this.queues.has(row.id)) this.confirmed.set(row.id, row)
      const notes = keep('notes', data.notes)
      this.set({
        status: 'ready',
        error: null,
        tasks: keep('tasks', data.tasks),
        links: keep('links', data.links),
        notes,
        recoverableDrafts: this.findDrafts(notes),
        loadedAt: Date.now(),
      })
    } catch (error) {
      if (seq !== this.loadSeq) return
      if (options.silent && this.state.loadedAt) return // keep showing what we have
      if (error instanceof WorkspaceNotInstalledError) this.set({ status: 'not_installed', error: error.message })
      else this.set({ status: 'error', error: this.message(error, 'โหลดพื้นที่ทำงานไม่สำเร็จ') })
    }
  }

  private message(error: unknown, fallback: string): string {
    const msg = (error as { message?: string } | null)?.message
    return msg && /[฀-๿]/.test(msg) ? msg : fallback
  }

  private fail(error: unknown, fallback: string) {
    this.opts.onError?.(this.message(error, fallback), error)
  }

  // ------------------------------------------------------ write machinery

  private enqueue<T>(id: string, job: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(id) ?? Promise.resolve()
    const run = prev.then(job, job)
    const tail = run.catch(() => undefined)
    this.queues.set(id, tail)
    void tail.then(() => {
      if (this.queues.get(id) === tail) this.queues.delete(id)
    })
    return run
  }

  private bump(id: string): number {
    const v = (this.versions.get(id) ?? 0) + 1
    this.versions.set(id, v)
    return v
  }

  /**
   * Applies `optimistic` now, sends `send` (queued per record), then
   * applies the server row — or rolls back — if nothing newer happened.
   */
  private async mutate<T extends Row>(kind: Kind, id: string, optimistic: T | null, send: () => Promise<T | null>, fallback: string): Promise<boolean> {
    if (!this.confirmed.has(id)) this.confirmed.set(id, (this.find(kind, id) as T | undefined) ?? null)
    const v = this.bump(id)
    this.replaceRow(kind, id, optimistic)
    this.inFlight += 1
    try {
      const server = await this.enqueue(id, send)
      this.confirmed.set(id, server)
      if (this.versions.get(id) === v) {
        const local = this.find(kind, id) as WorkspaceNote | undefined
        // A note being typed in keeps its text; it only takes the server's revision/timestamps.
        if (kind === 'notes' && server && local && this.savers.get(id)?.hasUnsaved()) this.replaceRow(kind, id, { ...local, revision: (server as WorkspaceNote).revision, createdAt: server.createdAt })
        else this.replaceRow(kind, id, server)
      }
      return true
    } catch (error) {
      if (this.versions.get(id) === v) this.replaceRow(kind, id, this.confirmed.get(id) ?? null)
      this.fail(error, fallback)
      return false
    } finally {
      this.inFlight -= 1
      this.set({})
    }
  }

  // ---------------------------------------------------------------- tasks

  async createTask(input: TaskInput): Promise<WorkspaceTask | null> {
    const id = newId()
    const t = new Date().toISOString()
    const status = input.status ?? 'todo'
    const draft: WorkspaceTask = {
      id,
      title: input.title.trim(),
      description: input.description ?? '',
      status,
      priority: input.priority ?? 'medium',
      dueDate: input.dueDate ?? null,
      startDate: input.startDate ?? null,
      category: input.category?.trim() || null,
      important: input.important ?? false,
      urgent: input.urgent ?? false,
      sortOrder: input.sortOrder ?? edgeSortOrder(this.state.tasks, status, 'start'),
      completedAt: status === 'done' ? t : null,
      createdAt: t,
      updatedAt: t,
    }
    this.confirmed.set(id, null)
    const ok = await this.mutate('tasks', id, draft, () => this.repo.createTask(id, { ...input, sortOrder: draft.sortOrder }), 'เพิ่มงานไม่สำเร็จ')
    return ok ? (this.find('tasks', id) ?? draft) : null
  }

  updateTask(id: string, patch: TaskPatch): Promise<boolean> {
    const current = this.find('tasks', id)
    if (!current) return Promise.resolve(false)
    const next: WorkspaceTask = { ...current, ...patch, updatedAt: new Date().toISOString() }
    if (patch.status !== undefined) next.completedAt = patch.status === 'done' ? (current.status === 'done' ? current.completedAt : next.updatedAt) : null
    return this.mutate('tasks', id, next, () => this.repo.updateTask(id, patch), 'บันทึกงานไม่สำเร็จ')
  }

  async updateTasks(changes: { id: string; patch: TaskPatch }[]): Promise<boolean> {
    const results = await Promise.all(changes.map((c) => this.updateTask(c.id, c.patch)))
    return results.every(Boolean)
  }

  /** Status change from a list/matrix/calendar (card goes to the top of its new column). */
  setTaskStatus(id: string, status: TaskStatus): Promise<boolean> {
    const task = this.find('tasks', id)
    if (!task) return Promise.resolve(false)
    const patch = statusChangePatch(this.state.tasks, task, status)
    return Object.keys(patch).length ? this.updateTask(id, patch) : Promise.resolve(true)
  }

  deleteTask(id: string): Promise<boolean> {
    return this.mutate('tasks', id, null, async () => {
      await this.repo.deleteTask(id)
      return null
    }, 'ลบงานไม่สำเร็จ')
  }

  // ---------------------------------------------------------------- links

  async createLink(input: LinkInput): Promise<WorkspaceLink | null> {
    const id = newId()
    const t = new Date().toISOString()
    const draft: WorkspaceLink = { id, title: input.title.trim(), url: input.url, description: input.description ?? '', category: input.category?.trim() || null, pinned: input.pinned ?? false, openCount: 0, lastOpenedAt: null, createdAt: t, updatedAt: t }
    this.confirmed.set(id, null)
    const ok = await this.mutate('links', id, draft, () => this.repo.createLink(id, input), 'เพิ่มลิงก์ไม่สำเร็จ')
    return ok ? (this.find('links', id) ?? draft) : null
  }

  updateLink(id: string, patch: LinkPatch): Promise<boolean> {
    const current = this.find('links', id)
    if (!current) return Promise.resolve(false)
    return this.mutate('links', id, { ...current, ...patch, updatedAt: new Date().toISOString() }, () => this.repo.updateLink(id, patch), 'บันทึกลิงก์ไม่สำเร็จ')
  }

  deleteLink(id: string): Promise<boolean> {
    return this.mutate('links', id, null, async () => {
      await this.repo.deleteLink(id)
      return null
    }, 'ลบลิงก์ไม่สำเร็จ')
  }

  /** Counts a visit (best effort: a failure is not worth an error). */
  linkOpened(id: string) {
    const current = this.find('links', id)
    if (!current) return
    const t = new Date().toISOString()
    const bumped = { ...current, openCount: current.openCount + 1, lastOpenedAt: t }
    this.replaceRow('links', id, bumped)
    void this.enqueue(id, () => this.repo.linkOpened(id)).then(
      () => {
        const base = this.confirmed.get(id) as WorkspaceLink | null | undefined
        if (base) this.confirmed.set(id, { ...base, openCount: base.openCount + 1, lastOpenedAt: t })
      },
      () => undefined,
    )
  }

  // ---------------------------------------------------------------- notes

  /**
   * Creates a note and returns it at once, so the editor can open it
   * before the server answers; edits made meanwhile are saved after the
   * insert (same queue). A failed insert removes it again and reports.
   */
  createNote(input: NotePatch = {}): WorkspaceNote {
    const id = newId()
    const t = new Date().toISOString()
    const draft: WorkspaceNote = { id, title: '', body: '', category: null, tags: [], pinned: false, archivedAt: null, ...input, revision: 1, createdAt: t, updatedAt: t }
    this.confirmed.set(id, null)
    void this.mutate('notes', id, draft, () => this.repo.createNote(id, input), 'สร้างบันทึกไม่สำเร็จ')
    return draft
  }

  private saver(id: string): NoteAutosaver | null {
    const existing = this.savers.get(id)
    if (existing) return existing
    const note = this.find('notes', id)
    if (!note) return null
    const saver = new NoteAutosaver({
      revision: note.revision,
      delayMs: this.opts.autosaveDelayMs,
      isOnline: this.opts.isOnline,
      validate: (p) => validateNoteFields(p),
      // Waits for the note's own create/delete queue, so a save never
      // races the insert that created it.
      save: (patch, revision) => this.enqueue(id, () => this.repo.updateNote(id, patch, revision)),
      onStatus: (status) => {
        this.set({ noteStatus: { ...this.state.noteStatus, [id]: status } })
        if (status.state === 'saved') this.clearDraft(id)
      },
      onSaved: (server, stillPending) => {
        this.confirmed.set(id, server)
        const local = this.find('notes', id)
        // Keep the text being typed; take the server's revision/timestamps.
        if (local) this.replaceRow('notes', id, stillPending ? { ...local, revision: server.revision, updatedAt: server.updatedAt } : server)
      },
      onConflict: (latest) => this.set({ noteConflicts: { ...this.state.noteConflicts, [id]: latest } }),
    })
    this.savers.set(id, saver)
    return saver
  }

  /** Edits a note (title, body, pin, archive …): shown now, autosaved shortly. */
  editNote(id: string, patch: NotePatch, options: { immediate?: boolean } = {}) {
    const local = this.find('notes', id)
    const saver = this.saver(id)
    if (!local || !saver) return
    const next = { ...local, ...patch, updatedAt: new Date().toISOString() }
    this.replaceRow('notes', id, next)
    this.writeDraft(id, pickNoteFields(next))
    saver.edit(patch)
    if (options.immediate) void saver.flush()
  }

  flushNote(id: string): Promise<void> {
    return this.savers.get(id)?.flush() ?? Promise.resolve()
  }

  flushAll(): Promise<void> {
    return Promise.all([...this.savers.values()].map((s) => s.flush())).then(() => undefined)
  }

  /** Back online: retry failed note saves now. */
  online() {
    for (const s of this.savers.values()) s.online()
  }

  resolveConflict(id: string, choice: 'mine' | 'theirs') {
    const latest = this.state.noteConflicts[id]
    const saver = this.savers.get(id)
    const local = this.find('notes', id)
    const { [id]: _, ...rest } = this.state.noteConflicts
    this.set({ noteConflicts: rest })
    if (!saver || latest === undefined) return
    if (latest === null) {
      // Deleted elsewhere: "keep mine" recreates it as a new note.
      saver.dispose()
      this.savers.delete(id)
      if (choice === 'mine' && local) {
        this.replaceRow('notes', id, null)
        void this.createNote(pickNoteFields(local))
      } else {
        this.replaceRow('notes', id, null)
        this.clearDraft(id)
      }
      return
    }
    if (choice === 'mine' && local) {
      saver.keepMine(latest.revision, pickNoteFields(local))
    } else {
      saver.takeTheirs(latest)
      this.confirmed.set(id, latest)
      this.replaceRow('notes', id, latest)
      this.clearDraft(id)
    }
  }

  async deleteNote(id: string): Promise<boolean> {
    const saver = this.savers.get(id)
    saver?.dispose()
    this.savers.delete(id)
    const ok = await this.mutate('notes', id, null, async () => {
      await this.repo.deleteNote(id)
      return null
    }, 'ลบบันทึกไม่สำเร็จ')
    if (ok) this.clearDraft(id)
    return ok
  }

  restoreDraft(id: string) {
    const draft = this.state.recoverableDrafts[id]
    if (!draft) return
    this.dismissDraft(id, false)
    this.editNote(id, draft.fields, { immediate: true })
  }

  dismissDraft(id: string, clearStored = true) {
    const { [id]: _, ...rest } = this.state.recoverableDrafts
    this.set({ recoverableDrafts: rest })
    if (clearStored) this.clearDraft(id)
  }

  dispose() {
    for (const s of this.savers.values()) s.detach()
  }

  // ---------------------------------------------------- local draft backup

  private draftKey(id: string) {
    return `${DRAFT_PREFIX}:${this.opts.ownerKey ?? 'anon'}:${id}`
  }

  private writeDraft(id: string, fields: NoteFields) {
    try {
      this.opts.storage?.setItem(this.draftKey(id), JSON.stringify({ fields, savedAt: Date.now() } satisfies NoteDraft))
    } catch {
      /* storage full or blocked: the autosave itself still runs */
    }
  }

  private clearDraft(id: string) {
    try {
      this.opts.storage?.removeItem(this.draftKey(id))
    } catch {
      /* ignore */
    }
  }

  private findDrafts(notes: WorkspaceNote[]): Record<string, NoteDraft> {
    const out: Record<string, NoteDraft> = {}
    if (!this.opts.storage) return out
    for (const note of notes) {
      if (this.savers.get(note.id)?.hasUnsaved()) continue
      try {
        const raw = this.opts.storage.getItem(this.draftKey(note.id))
        if (!raw) continue
        const draft = JSON.parse(raw) as NoteDraft
        if (draft?.fields && typeof draft.fields.body === 'string' && !sameFields(draft.fields, pickNoteFields(note))) out[note.id] = draft
        else this.clearDraft(note.id)
      } catch {
        this.clearDraft(note.id)
      }
    }
    return out
  }
}
