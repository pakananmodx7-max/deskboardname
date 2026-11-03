import type { NotePatch, NoteSaveResult, WorkspaceNote } from './workspace-types'

export type AutosaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'offline' | 'conflict' | 'invalid'

export interface AutosaveStatus {
  state: AutosaveState
  /** Validation message for 'invalid'. */
  message?: string
  lastSavedAt?: number
}

export interface NoteAutosaverOptions {
  /** Saves `patch` only if the note is still at `expectedRevision`. */
  save: (patch: NotePatch, expectedRevision: number) => Promise<NoteSaveResult>
  revision: number
  delayMs?: number
  /** Waits between retries after a failed save (the last one repeats). */
  retryDelaysMs?: number[]
  validate?: (pending: NotePatch) => string | null
  isOnline?: () => boolean
  onStatus?: (status: AutosaveStatus) => void
  onSaved?: (note: WorkspaceNote, stillPending: boolean) => void
  onConflict?: (latest: WorkspaceNote | null) => void
}

export const AUTOSAVE_DELAY_MS = 800
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000]

const isEmpty = (patch: NotePatch) => Object.keys(patch).length === 0

/**
 * Debounced, single-flight autosave for one note.
 *
 * - Edits are merged into one pending patch and saved after a pause in
 *   typing; edits made while a save is in flight wait for it and are
 *   saved next, so responses can never arrive out of order and an older
 *   save can never land after a newer one.
 * - Every save carries the revision it was based on; if another tab or
 *   device saved in between, nothing is overwritten — the saver stops
 *   in 'conflict' until the teacher picks a version.
 * - A failed save keeps its changes (merged under any newer ones) and is
 *   retried with back-off; going back online retries immediately.
 * - `flush()` saves right away (leaving the note, closing the tab).
 */
export class NoteAutosaver {
  private pending: NotePatch = {}
  private inflight: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private attempt = 0
  private revision: number
  private status: AutosaveStatus = { state: 'idle' }
  private readonly opts: NoteAutosaverOptions

  constructor(opts: NoteAutosaverOptions) {
    this.opts = opts
    this.revision = opts.revision
  }

  get currentStatus(): AutosaveStatus {
    return this.status
  }

  get currentRevision(): number {
    return this.revision
  }

  /** Unsaved changes exist (pending, saving, failed or in conflict). */
  hasUnsaved(): boolean {
    return !isEmpty(this.pending) || this.inflight !== null
  }

  /** Stops reporting to the editor (it unmounted); saving carries on. */
  detach() {
    this.opts.onStatus = undefined
    this.opts.onSaved = undefined
    this.opts.onConflict = undefined
  }

  edit(patch: NotePatch) {
    this.pending = { ...this.pending, ...patch }
    if (this.status.state === 'conflict') return
    const invalid = this.opts.validate?.(this.pending) ?? null
    if (invalid) {
      this.clearTimer()
      this.setStatus({ state: 'invalid', message: invalid })
      return
    }
    if (!this.inflight) this.setStatus({ state: 'pending' })
    this.schedule(this.opts.delayMs ?? AUTOSAVE_DELAY_MS)
  }

  /** Save now; resolves once everything pending so far is saved or failed. */
  async flush(): Promise<void> {
    this.clearTimer()
    if (this.inflight) await this.inflight
    if (!isEmpty(this.pending) && this.status.state !== 'conflict' && this.status.state !== 'invalid') await this.run()
  }

  /** The network came back: retry a failed save straight away. */
  online() {
    if ((this.status.state === 'offline' || this.status.state === 'error') && !isEmpty(this.pending)) this.schedule(0)
  }

  /** Conflict: overwrite the other version with this draft. */
  keepMine(latestRevision: number, draft: NotePatch) {
    this.revision = latestRevision
    this.pending = { ...draft }
    this.setStatus({ state: 'pending' })
    this.schedule(0)
  }

  /** Conflict: drop this draft and continue from the other version. */
  takeTheirs(latest: WorkspaceNote) {
    this.clearTimer()
    this.pending = {}
    this.revision = latest.revision
    this.setStatus({ state: 'saved', lastSavedAt: Date.now() })
  }

  dispose() {
    this.clearTimer()
    this.detach()
  }

  private setStatus(status: AutosaveStatus) {
    this.status = status
    this.opts.onStatus?.(status)
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(ms: number) {
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.run()
    }, ms)
  }

  private run(): Promise<void> {
    if (this.inflight) return this.inflight
    if (isEmpty(this.pending) || this.status.state === 'conflict' || this.status.state === 'invalid') return Promise.resolve()
    const patch = this.pending
    this.pending = {}
    this.setStatus({ state: 'saving' })
    this.inflight = (async () => {
      // The final status is reported after `inflight` is cleared, so
      // listeners see hasUnsaved() === false once everything is saved.
      let report: () => void
      try {
        const result = await this.opts.save(patch, this.revision)
        if (result.ok) {
          this.revision = result.note.revision
          this.attempt = 0
          const stillPending = !isEmpty(this.pending)
          this.opts.onSaved?.(result.note, stillPending)
          report = () => {
            if (stillPending || !isEmpty(this.pending)) {
              this.setStatus({ state: 'pending' })
              this.schedule(0)
            } else {
              this.setStatus({ state: 'saved', lastSavedAt: Date.now() })
            }
          }
        } else {
          this.pending = { ...patch, ...this.pending }
          report = () => {
            this.setStatus({ state: 'conflict' })
            this.opts.onConflict?.(result.latest)
          }
        }
      } catch {
        this.pending = { ...patch, ...this.pending }
        const online = this.opts.isOnline?.() ?? true
        const delays = this.opts.retryDelaysMs ?? RETRY_DELAYS_MS
        const wait = delays[Math.min(this.attempt, delays.length - 1)]
        this.attempt += 1
        report = () => {
          this.setStatus({ state: online ? 'error' : 'offline' })
          this.schedule(wait)
        }
      } finally {
        this.inflight = null
      }
      report()
    })()
    return this.inflight
  }
}
