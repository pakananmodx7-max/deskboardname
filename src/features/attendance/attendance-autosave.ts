import type { AttendanceRecord } from '@/types/attendance'

import { encodeEntry, entriesEqual, type BoardEntries, type BoardEntry } from './attendance-board-model'

/**
 * Auto-save engine for one attendance session (classroom + date + subject
 * + คาบ). Framework-free so every ordering rule is unit-testable.
 *
 *   desired   — what the teacher sees (updated instantly on every click)
 *   confirmed — what the server has confirmed it stored
 *
 * Rules:
 *   - Changes are batched for `debounceMs`, then sent as ONE request
 *     (save_attendance_session takes the whole list, so a bulk
 *     "มาครบทุกคน" is a single round trip).
 *   - Never more than one request in flight. Edits made meanwhile are
 *     sent by the next request, which always carries the latest value
 *     for every changed student — so the database receives writes in
 *     click order and the latest intended status always wins.
 *   - A response only confirms exactly what that request sent. It never
 *     overwrites `desired`, so a slow (stale) response can never undo a
 *     newer click; that student simply stays pending until the next
 *     request confirms the newer value.
 *   - A failed request leaves every change pending and marked failed;
 *     nothing is dropped and nothing is shown as saved. `retry()` (or
 *     the next edit) sends them again.
 *   - `reset()` starts a new session (date/คาบ/classroom switch);
 *     responses from the previous session are ignored.
 */

export type AutoSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export interface AutoSaveSnapshot {
  desired: BoardEntries
  confirmed: BoardEntries
  status: AutoSaveStatus
  /** Students whose on-screen entry is not yet confirmed by the server. */
  pendingIds: ReadonlySet<string>
  /** Pending students whose last save attempt failed. */
  failedIds: ReadonlySet<string>
  error: string | null
  /** Any unconfirmed change (pending, in flight or failed). */
  hasUnsaved: boolean
}

export interface AutoSaverOptions {
  save: (records: AttendanceRecord[]) => Promise<void>
  /** Called after every state change with a fresh snapshot. */
  onChange?: (snapshot: AutoSaveSnapshot) => void
  /** Called with the records the server confirmed. */
  onSaved?: (records: AttendanceRecord[]) => void
  errorMessage?: (error: unknown) => string
  debounceMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export const AUTOSAVE_DEBOUNCE_MS = 500

export class AttendanceAutoSaver {
  private desired: BoardEntries = {}
  private confirmed: BoardEntries = {}
  private ids: string[] = []
  private inFlight: Map<string, BoardEntry> | null = null
  private inFlightPromise: Promise<void> | null = null
  private error: string | null = null
  private failed = new Set<string>()
  private timer: unknown = null
  private generation = 0
  private everSaved = false
  private waiters: ((ok: boolean) => void)[] = []
  private readonly opts: Required<Pick<AutoSaverOptions, 'debounceMs' | 'setTimer' | 'clearTimer'>> & AutoSaverOptions

  constructor(options: AutoSaverOptions) {
    this.opts = {
      debounceMs: AUTOSAVE_DEBOUNCE_MS,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...options,
    }
  }

  /** New session: `confirmed` is what was just loaded from the server. */
  reset(studentIds: string[], confirmed: BoardEntries): void {
    this.cancelTimer()
    this.generation += 1
    this.ids = [...studentIds]
    this.confirmed = { ...confirmed }
    this.desired = { ...confirmed }
    this.inFlight = null
    this.inFlightPromise = null
    this.error = null
    this.failed = new Set()
    this.everSaved = false
    this.settleWaiters(true)
    this.emit()
  }

  /** The teacher changed something: show it now, save it shortly. */
  update(next: BoardEntries): void {
    this.desired = { ...next }
    for (const id of Object.keys(next)) if (!this.ids.includes(id)) this.ids.push(id)
    // A new edit is a fresh attempt for everything still pending.
    this.error = null
    this.failed = new Set()
    this.schedule()
    this.emit()
  }

  /** Save now, skipping the debounce. */
  retry(): void {
    this.error = null
    this.failed = new Set()
    this.cancelTimer()
    void this.flush()
    this.emit()
  }

  /**
   * Saves everything pending and resolves once nothing is unsaved (true),
   * or as soon as a save fails (false). Used before switching date/คาบ.
   */
  flushNow(): Promise<boolean> {
    if (!this.hasUnsaved()) return Promise.resolve(true)
    if (this.error) return Promise.resolve(false)
    const promise = new Promise<boolean>((resolve) => this.waiters.push(resolve))
    this.cancelTimer()
    void this.flush()
    return promise
  }

  /** Teacher chose to drop unsaved changes (e.g. switch date anyway). */
  discard(): void {
    this.cancelTimer()
    this.desired = { ...this.confirmed }
    this.error = null
    this.failed = new Set()
    this.settleWaiters(false)
    this.emit()
  }

  /** Component going away: send anything pending (best effort), stop updates. */
  dispose(): void {
    this.cancelTimer()
    // Latest value of every unconfirmed student (including any in flight),
    // sent after the running request so the order is still preserved.
    const pending = this.pendingRecords()
    const running = this.inFlightPromise ?? Promise.resolve()
    this.generation += 1
    if (pending.length > 0) {
      void running.then(() => this.opts.save(pending)).catch(() => undefined)
    }
    this.settleWaiters(false)
  }

  snapshot(): AutoSaveSnapshot {
    const pendingIds = new Set(this.pendingIdList())
    const hasUnsaved = pendingIds.size > 0 || this.inFlight !== null
    let status: AutoSaveStatus
    if (this.error) status = 'error'
    else if (this.inFlight) status = 'saving'
    else if (pendingIds.size > 0) status = 'pending'
    else status = this.everSaved ? 'saved' : 'idle'
    return {
      desired: this.desired,
      confirmed: this.confirmed,
      status,
      pendingIds,
      failedIds: this.error ? new Set([...this.failed].filter((id) => pendingIds.has(id))) : new Set(),
      error: this.error,
      hasUnsaved,
    }
  }

  hasUnsaved(): boolean {
    return this.inFlight !== null || this.pendingIdList().length > 0
  }

  // ------------------------------------------------------------------

  private pendingIdList(): string[] {
    return this.ids.filter((id) => !entriesEqual(this.desired[id], this.confirmed[id]) && encodeEntry(id, this.desired[id] ?? { status: 'unchecked', note: '' }) !== null)
  }

  private pendingRecords(): AttendanceRecord[] {
    const records: AttendanceRecord[] = []
    for (const id of this.pendingIdList()) {
      const record = encodeEntry(id, this.desired[id])
      if (record) records.push(record)
    }
    return records
  }

  private schedule(): void {
    this.cancelTimer()
    this.timer = this.opts.setTimer(() => {
      this.timer = null
      void this.flush()
    }, this.opts.debounceMs)
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.opts.clearTimer(this.timer)
      this.timer = null
    }
  }

  private flush(): Promise<void> {
    // One request at a time; the running one re-flushes when it settles.
    if (this.inFlightPromise) return this.inFlightPromise
    const records = this.pendingRecords()
    if (records.length === 0) {
      this.settleWaiters(true)
      return Promise.resolve()
    }
    const generation = this.generation
    const sent = new Map(records.map((r) => [r.studentId, { ...this.desired[r.studentId] }]))
    this.inFlight = sent
    this.emit()

    const run = this.opts.save(records).then(
      () => {
        if (generation !== this.generation) return
        for (const [id, entry] of sent) this.confirmed = { ...this.confirmed, [id]: entry }
        this.everSaved = true
        this.finishRequest()
        this.opts.onSaved?.(records)
        if (this.pendingIdList().length > 0 && !this.error) {
          // Edits made while this request was in flight: send them now.
          void this.flush()
        } else {
          this.settleWaiters(true)
        }
        this.emit()
      },
      (err: unknown) => {
        if (generation !== this.generation) return
        this.finishRequest()
        this.error = this.opts.errorMessage?.(err) ?? 'บันทึกไม่สำเร็จ'
        this.failed = new Set(this.pendingIdList())
        this.settleWaiters(false)
        this.emit()
      },
    )
    this.inFlightPromise = run
    return run
  }

  private finishRequest(): void {
    this.inFlight = null
    this.inFlightPromise = null
  }

  private settleWaiters(ok: boolean): void {
    const waiters = this.waiters
    this.waiters = []
    for (const resolve of waiters) resolve(ok)
  }

  private emit(): void {
    this.opts.onChange?.(this.snapshot())
  }
}
