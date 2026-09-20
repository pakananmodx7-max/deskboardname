/**
 * TRUE unattended auto-run — background.js's pure state reducer. Every
 * function here is a plain `(state, ...) => newState` transition with no
 * chrome.* API, no DOM, and no I/O of any kind, so the exact same
 * transitions this codebase's turn-by-turn message protocol drives can be
 * unit-tested without a browser or an extension runtime at all.
 *
 * background.js is the ONLY place that ever calls these functions live
 * (persisting the returned state to chrome.storage.session after every
 * call); content-script.js and popup.js never import this module — they
 * only ever send/receive plain messages (see the AR_* message-type
 * constants below) and let background.js be the single source of truth,
 * per item 3's "popup becomes only preview/confirmation/progress-viewer/
 * Stop control" and "content script + background continue even if popup
 * closes."
 *
 * Reuses emptyAutoRunSummary/mergeAutoRunSummaries from auto-run.js
 * UNCHANGED — this module never re-implements the six-bucket summary
 * shape, so the already-shipped/already-tested summary math can never
 * drift between the old popup-driven loop and this new background-driven
 * one.
 */

import { emptyAutoRunSummary, mergeAutoRunSummaries } from './auto-run.js'

/** FINAL AUTO-RUN STATE BUG FIX — the exact Thai message shown by BOTH
 * required guards (item 6): popup.js's own AR_START click handler (a
 * fresh pagination inspection, taken at the moment "เริ่ม..." is
 * clicked) and background.js's handleStart (isPaginationHydrationValid,
 * below). Kept as one shared constant so neither guard can drift from
 * the other's wording. */
export const PAGINATION_HYDRATION_FAILED_MESSAGE = 'ยังอ่านข้อมูลหน้าของ SGS ไม่สำเร็จ'

export const AUTO_RUN_STATUS = {
  RUNNING: 'running',
  PAUSED_MANUAL: 'paused_manual',
  COMPLETED: 'completed',
  STOPPED_BY_USER: 'stopped_by_user',
  ABORTED: 'aborted',
}

/** The full message-type vocabulary between popup.js, background.js, and
 * content-script.js — kept as one shared list so every sender/receiver
 * pair in this codebase refers to the exact same string, never a
 * hand-typed literal that could silently drift. */
export const AR_MESSAGE = {
  // popup -> background
  START: 'AR_START',
  STOP: 'AR_STOP',
  GET_STATE: 'AR_GET_STATE',
  MANUAL_CONTINUE: 'AR_MANUAL_CONTINUE',
  // content-script -> background
  CHECK_ACTIVE: 'AR_CHECK_ACTIVE',
  PENDING_ADVANCE: 'AR_PENDING_ADVANCE',
  PAGE_PROGRESS: 'AR_PAGE_PROGRESS',
  PAGE_COMPLETE: 'AR_PAGE_COMPLETE',
  ADVANCE_CONFIRMED: 'AR_ADVANCE_CONFIRMED',
  MANUAL_PAUSE: 'AR_MANUAL_PAUSE',
  ABORT: 'AR_ABORT',
  STOPPED: 'AR_STOPPED',
  COMPLETE: 'AR_COMPLETE',
  // background -> content-script
  KICKOFF: 'AR_KICKOFF',
  RESUME: 'AR_RESUME',
  // background -> popup (broadcast)
  STATE_CHANGED: 'AR_STATE_CHANGED',
}

/**
 * item 3's exact stored-state field list (runId, tabId, subject,
 * classroom, targetColumn, payload, overwriteMode, currentPage,
 * totalPages, summary, approved) plus the bookkeeping this reducer needs
 * to make every later transition safe: pagesProcessed/allStudentResults/
 * failedStudents (item 9's final report), stopRequested (item 6),
 * status/pauseReason/abortReason (item 7's finish + item 6's fallback),
 * confirmedContext (the FIRST page's own subject/classroom/column
 * snapshot every later page is revalidated against — never the previous
 * page's own values, same rule the old popup-driven loop used).
 *
 * FINAL AUTO-RUN STATE BUG FIX — `currentPage`/`totalPages` (and
 * `totalStudentRows`/`pageSize`, the SAME canonical field names
 * detectPagination/buildPaginationHintsFromInspection already use) are
 * now accepted here and set IMMEDIATELY, never hardcoded to `null` and
 * "fixed later" by the first AR_PAGE_PROGRESS message. The caller
 * (background.js's handleStart) is responsible for having ALREADY run a
 * fresh pagination inspection and refused to call this at all if it
 * came back incomplete — see handleStart's own guard — so by the time a
 * state with `status: 'running'` exists, its pagination fields are
 * never null. `expectedNextPage` starts at that SAME confirmed
 * `currentPage` (never `null`), so content-script.js's very first
 * page-gate check also verifies the page it actually re-scans on
 * kickoff still matches what was inspected the moment the teacher
 * clicked start — never trusting that snapshot to still be true by the
 * time the kickoff message is handled.
 */
export function createInitialRunState({
  runId,
  tabId,
  subject,
  classroom,
  targetColumn,
  payload,
  overwriteMode,
  currentPage,
  totalPages,
  totalStudentRows,
  pageSize,
}) {
  const initialCurrentPage = currentPage ?? null
  return {
    runId,
    tabId,
    subject,
    classroom,
    targetColumn,
    payload,
    overwriteMode,
    currentPage: initialCurrentPage,
    totalPages: totalPages ?? null,
    totalStudentRows: totalStudentRows ?? null,
    pageSize: pageSize ?? null,
    summary: emptyAutoRunSummary(),
    pagesProcessed: [],
    allStudentResults: [],
    failedStudents: [],
    approved: true,
    active: true,
    stopRequested: false,
    status: AUTO_RUN_STATUS.RUNNING,
    pauseReason: null,
    abortReason: null,
    confirmedContext: null,
    expectedNextPage: initialCurrentPage,
    pendingAdvance: null,
  }
}

/**
 * FINAL AUTO-RUN STATE BUG FIX (item 6's hard guard) — the ONE place
 * both popup.js and background.js check before ever calling
 * createInitialRunState: a fresh pagination inspection that couldn't
 * confidently read BOTH currentPage and totalPages must never become a
 * running run. Pure so both call sites — and this exact rule's own
 * regression test — share the ONE definition, never two copies that
 * could drift.
 */
export function isPaginationHydrationValid(pagination) {
  return Boolean(
    pagination &&
      pagination.currentPage !== null &&
      pagination.currentPage !== undefined &&
      pagination.totalPages !== null &&
      pagination.totalPages !== undefined,
  )
}

/** item 6: only ever sets a flag — never itself stops anything in
 * flight. The content script is what checks this flag (via a fresh
 * AR_CHECK_ACTIVE/AR_GET_STATE round trip) between atomic cell writes and
 * decides to finish the current cell then stop. */
export function applyStopRequested(state) {
  if (!state) return state
  return { ...state, stopRequested: true }
}

/** The FIRST successful page scan of the run becomes the fixed baseline
 * every later page is compared against (see the module doc comment) —
 * never overwritten once set. */
export function withConfirmedContext(state, confirmedContext) {
  if (!state || state.confirmedContext) return state
  return { ...state, confirmedContext }
}

export function applyPageProgress(state, { pageNumber, totalPages, totalStudentRows, pageSize, runningSummary }) {
  if (!state) return state
  return {
    ...state,
    currentPage: pageNumber,
    totalPages: totalPages ?? state.totalPages,
    totalStudentRows: totalStudentRows ?? state.totalStudentRows,
    pageSize: pageSize ?? state.pageSize,
    summary: runningSummary ?? state.summary,
    status: AUTO_RUN_STATUS.RUNNING,
  }
}

/** item 9: accumulates one page's verified result into the run's running
 * total — never resets anything already accumulated (only a brand-new
 * AR_START, i.e. createInitialRunState, ever does that). */
export function applyPageComplete(state, { pageNumber, pageSummary, failedStudents, studentResults }) {
  if (!state) return state
  return {
    ...state,
    summary: mergeAutoRunSummaries(state.summary, pageSummary),
    pagesProcessed: [...state.pagesProcessed, pageNumber],
    failedStudents: [...state.failedStudents, ...(failedStudents ?? [])],
    allStudentResults: [...state.allStudentResults, ...(studentResults ?? [])],
  }
}

/** item 6/(turn N-1 item 6): the honest fallback whenever an automatic
 * page-advance can't be confidently attempted or confirmed — never an
 * abort. The run stays `active`/`approved` (so a reopened popup still
 * shows it as in-progress, per item 3/4), only its `status` changes, so
 * clicking "ดำเนินการต่อ" (AR_MANUAL_CONTINUE, see applyResume) is what
 * actually resumes it. */
export function applyManualPause(state, { reason, expectedNextPage }) {
  if (!state) return state
  return { ...state, status: AUTO_RUN_STATUS.PAUSED_MANUAL, pauseReason: reason, expectedNextPage: expectedNextPage ?? state.expectedNextPage }
}

export function applyResume(state) {
  if (!state) return state
  return { ...state, status: AUTO_RUN_STATUS.RUNNING, pauseReason: null, stopRequested: false }
}

/** item 5: "abort immediately on mismatch" — a real, CONFIRMED safety
 * failure (subject/classroom/page/column mismatch, an invalid grid, an
 * ambiguous write candidate, or a per-page failure-rate threshold). Ends
 * the run outright; `approved=false` is what stops content-script.js
 * (via shouldContentScriptProcess below) from ever processing another
 * page for this run, even if it somehow received another message. */
export function applyAbort(state, reason) {
  if (!state) return state
  return { ...state, status: AUTO_RUN_STATUS.ABORTED, abortReason: reason, active: false, approved: false }
}

/** item 6: "after Stop, finish current atomic cell only, then stop" —
 * called once the content script confirms it has stopped between cells
 * (never mid-write). */
export function applyStopped(state) {
  if (!state) return state
  return { ...state, status: AUTO_RUN_STATUS.STOPPED_BY_USER, active: false, approved: false }
}

/** item 7: the final page was reached and processed — `active=false`,
 * and every field this reducer already accumulated (summary,
 * pagesProcessed, allStudentResults) is exactly what a reopened popup's
 * final-summary render needs; nothing further is computed here. */
export function applyCompleted(state) {
  if (!state) return state
  return { ...state, status: AUTO_RUN_STATUS.COMPLETED, active: false, approved: false }
}

/**
 * The ONE gate a content script (fresh page load OR an explicit
 * kickoff/resume message) must pass before it is allowed to scan/write
 * anything: the run must still be approved+active, belong to THIS exact
 * tab (never a stale run from a previously-used tab), the teacher must
 * not have pressed Stop, and the run must not be sitting in a manual
 * pause (a pause is only ever cleared by an explicit AR_MANUAL_CONTINUE,
 * i.e. applyResume — never by a page simply reloading).
 */
export function shouldContentScriptProcess(state, tabId) {
  return Boolean(
    state && state.approved && state.active && state.tabId === tabId && !state.stopRequested && state.status === AUTO_RUN_STATUS.RUNNING,
  )
}

/**
 * item 4's "click Next -> allow the postback to happen -> a FRESH
 * scan/instance verifies the advance" split across two separate
 * content-script.js executions (a real full-page postback destroys the
 * clicking instance's own execution context — see content-script.js's
 * own doc comment). Persisted here so the FRESH instance that loads next
 * knows there is a click to verify, and what it expected.
 */
export function withPendingAdvance(state, pendingAdvance) {
  if (!state) return state
  return { ...state, pendingAdvance }
}

export function clearPendingAdvance(state) {
  if (!state) return state
  return { ...state, pendingAdvance: null }
}

/** item 7's exact final-summary shape, built once the run reaches any
 * terminal status (completed/stopped/aborted) — never anything beyond
 * what the run itself already accumulated (no credential/session/cookie,
 * no studentId beyond what allStudentResults already carries). */
export function isTerminalStatus(status) {
  return status === AUTO_RUN_STATUS.COMPLETED || status === AUTO_RUN_STATUS.STOPPED_BY_USER || status === AUTO_RUN_STATUS.ABORTED
}
