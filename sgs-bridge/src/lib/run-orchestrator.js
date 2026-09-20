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

/** FINAL AUTO-RUN EXECUTION BUG FIX — shown when background.js cannot
 * confirm (via AR_PING, see background.js's ensureContentScriptReady)
 * that a content script is actually listening in the run's tab BEFORE a
 * run is ever created (item 2's guard), and reused as the watchdog's own
 * abort reason (item 6) if a run somehow still went "running" without
 * page-1 processing ever starting. One shared string so both refusals
 * read identically to the teacher. */
export const CONTENT_SCRIPT_UNAVAILABLE_MESSAGE = 'ไม่พบตัวเชื่อมหน้า SGS กรุณารีเฟรชหน้า SGS แล้วลองใหม่'

/**
 * REMOVE GENERIC ERROR COLLAPSING — the one shared vocabulary of
 * MACHINE-readable reasons a run could fail to start, so
 * CONTENT_SCRIPT_UNAVAILABLE_MESSAGE (the teacher-facing Thai sentence,
 * unchanged above) is never the ONLY signal available. sgs-tab-connection.js
 * produces SGS_TAB_NOT_FOUND/SGS_TAB_URL_INVALID/PING_FAILED/
 * MESSAGE_PORT_CLOSED/CONTENT_RECEIVER_MISSING (see its own
 * classifyPingError); background.js produces RUN_STATE_CREATE_FAILED/
 * KICKOFF_SEND_FAILED for the two failure points after a tab is already
 * confirmed connected. Every AR_START_ABORTED trace entry and every
 * failed AR_START response carries one of these, alongside the real
 * underlying error text — never just the collapsed Thai sentence alone.
 */
export const AR_ERROR_CODE = {
  SGS_TAB_NOT_FOUND: 'SGS_TAB_NOT_FOUND',
  SGS_TAB_URL_INVALID: 'SGS_TAB_URL_INVALID',
  PING_FAILED: 'PING_FAILED',
  MESSAGE_PORT_CLOSED: 'MESSAGE_PORT_CLOSED',
  CONTENT_RECEIVER_MISSING: 'CONTENT_RECEIVER_MISSING',
  RUN_STATE_CREATE_FAILED: 'RUN_STATE_CREATE_FAILED',
  /** STARTUP-ORDER FIX — the run was created but could not be persisted
   * to, or read back from, chrome.storage.session. Distinct from
   * RUN_STATE_CREATE_FAILED (which never got as far as a state object). */
  RUN_STATE_PERSIST_FAILED: 'RUN_STATE_PERSIST_FAILED',
  KICKOFF_SEND_FAILED: 'KICKOFF_SEND_FAILED',
  PAGINATION_INVALID: 'PAGINATION_INVALID',
}

/** STARTUP-ORDER FIX — shown when a run state was created but could NOT
 * be read back afterwards. AR_KICKOFF is never dispatched in that case:
 * a content script that woke up and found no persisted run would do
 * nothing at all, silently, forever. background.js appends the storage
 * layer's own error text to this. */
export const RUN_STATE_PERSIST_FAILED_MESSAGE = 'บันทึกสถานะการรันไม่สำเร็จ จึงไม่เริ่มส่งคะแนน'

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
  // popup -> background: TRACE THE EXACT AR_START FAILURE — fetches the
  // last PERSISTED startup-trace entry (see background.js's
  // recordStartupTrace), never merely the last live broadcast this popup
  // instance happened to be open/listening for. Lets a REOPENED popup
  // (after an abort closed it, or a fresh popup click after a failure)
  // still show "ขั้นตอนล่าสุด / tabId / PING / ข้อผิดพลาดจริง" for the
  // most recent AR_START attempt, even if no run was ever created.
  GET_STARTUP_TRACE: 'AR_GET_STARTUP_TRACE',
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
  // FINAL AUTO-RUN EXECUTION BUG FIX (item 4): a content script's own
  // debug checkpoint during one page's pipeline — never itself a state
  // transition, only appended to state.debugLog (see appendDebugEvent).
  DEBUG_EVENT: 'AR_DEBUG_EVENT',
  // content-script -> background: PROCESS_CURRENT_PAGE tracing. Unlike
  // DEBUG_EVENT (which only appends to a run's own debugLog, and so is
  // invisible whenever no run state matches), this lands in the SAME
  // persisted startup-trace slot Section 7 reads — so the checkpoints
  // between CONTENT_SCRIPT_RECEIVED and PAGE_SCAN_OK, and any exception
  // thrown in between, are visible even when the handler stopped before
  // a run could ever record anything itself.
  PROCESS_TRACE: 'AR_PROCESS_TRACE',
  // background <-> content-script: a content script availability
  // handshake, sent BEFORE a run is ever created (item 2) — a content
  // script answers it immediately, without waiting for loadLibs().
  PING: 'AR_PING',
  // content-script -> background: FINAL SGS AUTO-RUN FIX (item 2/5) — a
  // content script announces itself the moment it starts (fresh page
  // load, reload, OR an ASP.NET postback) — never only in reply to a
  // PING background happened to send. This is what lets background
  // notice a tab has RECONNECTED after a postback and re-dispatch
  // AR_KICKOFF without the teacher ever reopening the popup.
  CONTENT_READY: 'AR_SGS_CONTENT_READY',
  // background -> content-script
  KICKOFF: 'AR_KICKOFF',
  RESUME: 'AR_RESUME',
  // background -> popup (broadcast)
  STATE_CHANGED: 'AR_STATE_CHANGED',
  // background -> popup (broadcast): FINAL SGS AUTO-RUN FIX (item 6) —
  // the connection-handshake trace (SGS_TAB_FOUND/PING_SENT/PING_OK or
  // PING_FAILED/SCRIPT_INJECTED/PING_RETRY_OK/PROCESS_CURRENT_PAGE_SENT/
  // CONTENT_SCRIPT_RECEIVED). Broadcast-only, never persisted to run
  // state, because every one of these steps happens BEFORE a run exists
  // to persist it on.
  STARTUP_TRACE: 'AR_STARTUP_TRACE',
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
    // FINAL AUTO-RUN EXECUTION BUG FIX (item 6) — set true by
    // applyPageProgress the FIRST time content-script.js reports it has
    // actually begun scanning/processing a page. The watchdog alarm (see
    // shouldAbortForMissingProcessing below) only ever aborts a run for
    // which this is STILL false by the time it fires — never a run that
    // is merely taking a while to finish a page it already started.
    hasStartedProcessing: false,
    debugLog: [],
  }
}

/** FINAL AUTO-RUN EXECUTION BUG FIX (item 4) — appends one {ts, event,
 * detail} entry to the run's own debugLog, capped at the most recent
 * DEBUG_LOG_MAX_ENTRIES so a long run's state never grows unbounded.
 * Pure, so both background.js's own checkpoints and content-script.js's
 * (relayed via AR_DEBUG_EVENT) go through the exact same accumulation
 * rule. */
export const DEBUG_LOG_MAX_ENTRIES = 20

export function appendDebugEvent(state, { event, detail }) {
  if (!state) return state
  const entry = { ts: Date.now(), event, detail: detail ?? null }
  return { ...state, debugLog: [...state.debugLog, entry].slice(-DEBUG_LOG_MAX_ENTRIES) }
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

/**
 * FINAL AUTO-RUN EXECUTION BUG FIX (item 6) — the watchdog alarm's own
 * name for a given run, namespaced by runId so a PREVIOUS run's already-
 * fired/already-cleared alarm can never be mistaken for the CURRENT run's
 * one (chrome.alarms has no per-run isolation of its own — every alarm in
 * the extension shares one flat namespace). Kept as a pure pair
 * (name <-> runId) so background.js's chrome.alarms.create/onAlarm code
 * and this module's own regression tests always agree on the exact
 * string shape.
 */
const WATCHDOG_ALARM_PREFIX = 'sgsBridgeAutoRunWatchdog:'

export function watchdogAlarmName(runId) {
  return `${WATCHDOG_ALARM_PREFIX}${runId}`
}

export function runIdFromWatchdogAlarmName(alarmName) {
  return typeof alarmName === 'string' && alarmName.startsWith(WATCHDOG_ALARM_PREFIX) ? alarmName.slice(WATCHDOG_ALARM_PREFIX.length) : null
}

/**
 * FINAL AUTO-RUN EXECUTION BUG FIX (item 6's "never leave a dead run") —
 * the ONE decision background.js's chrome.alarms.onAlarm listener makes:
 * abort ONLY a run that (a) the firing alarm actually belongs to (never a
 * stale alarm from an already-finished/already-replaced run), (b) is
 * still nominally "running", and (c) has NEVER once confirmed it began
 * processing a page (hasStartedProcessing) — a run that already reported
 * its first AR_PAGE_PROGRESS is simply taking a while and must never be
 * aborted by this watchdog, however long page 1 itself takes.
 */
/**
 * STARTUP-ORDER FIX — a content script announcing itself is NEVER an
 * error on its own. A fresh SGS page load, a reload, or an ASP.NET
 * postback all fire AR_SGS_CONTENT_READY regardless of whether a run
 * exists yet, and a teacher who simply opened SGS before ever clicking
 * "เริ่มส่งครบทั้งห้อง" is the completely normal case — the live trace's
 * own CONTENT_READY_NO_ACTIVE_RUN/"ไม่ส่ง KICKOFF" wording made that
 * ordinary idle moment read as a failure. This classifies the two real
 * outcomes so background.js can record the idle one as purely
 * informational (never an abort, never a KICKOFF) while still resuming a
 * genuinely active run after a navigation.
 */
export const CONTENT_READY_IDLE = 'idle'
export const CONTENT_READY_RESUME = 'resume'

export function classifyContentReady(state, tabId) {
  return shouldContentScriptProcess(state, tabId) ? CONTENT_READY_RESUME : CONTENT_READY_IDLE
}

/**
 * STARTUP-ORDER FIX — the readback gate between "persisted the run" and
 * "dispatched KICKOFF": the state chrome.storage.session hands BACK must
 * be the very run just written (same runId) and must still be RUNNING.
 * Anything else means the content script would wake to find no usable
 * run, so KICKOFF must not be sent at all.
 */
export function isRunStatePersistedCorrectly(readBackState, expectedRunId) {
  return Boolean(readBackState && expectedRunId && readBackState.runId === expectedRunId && readBackState.status === AUTO_RUN_STATUS.RUNNING)
}

export function shouldAbortForMissingProcessing(state, alarmRunId) {
  return Boolean(state && alarmRunId && state.runId === alarmRunId && state.status === AUTO_RUN_STATUS.RUNNING && !state.hasStartedProcessing)
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
    // FINAL AUTO-RUN EXECUTION BUG FIX (item 6) — the FIRST AR_PAGE_PROGRESS
    // for ANY page is content-script.js's own confirmation that it has
    // begun scanning/processing that page (sent right after the page gate
    // passes, well before any cell write) — proof positive execution
    // actually started, which is exactly what the watchdog alarm checks.
    hasStartedProcessing: true,
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
