/**
 * TRUE unattended auto-run — the background service worker. This is the
 * ONE place run state lives once the teacher has explicitly started a
 * run (item 3): popup.js only ever previews/confirms/renders/stops, and
 * content-script.js only ever asks "is an approved run active for MY
 * tab?" and reports its own progress — neither one holds authoritative
 * state itself, so either can close/reload without losing the run.
 *
 * Every state transition is a pure call into run-orchestrator.js
 * (createInitialRunState/applyStopRequested/applyPageProgress/...) —
 * this file's only job is: read the persisted state, call the matching
 * pure transition, persist the result, and (for popup-visible changes)
 * broadcast AR_STATE_CHANGED. `chrome.storage.session` is used rather
 * than `chrome.storage.local` because a run is scoped to the current
 * browser session, same as this extension's already-shipped
 * SESSION_PAYLOAD_KEY/AUTO_RUN_STORAGE_KEY convention — never persisted
 * across a full browser restart, so a stale run from a previous session
 * can never silently resume.
 *
 * Deliberately reads/writes NOTHING else about the tab: no cookies, no
 * auth tokens, no page content beyond exactly what content-script.js
 * chooses to report in a progress/page-complete message (per-student
 * status/score outcomes only — see auto-run.js's buildAutoRunReport for
 * the exact shape).
 */

import {
  appendDebugEvent,
  AR_ERROR_CODE,
  AR_MESSAGE,
  applyAbort,
  applyCompleted,
  applyManualPause,
  applyPageComplete,
  applyPageProgress,
  applyResume,
  applyStopped,
  applyStopRequested,
  clearPendingAdvance,
  CONTENT_SCRIPT_UNAVAILABLE_MESSAGE,
  createInitialRunState,
  isPaginationHydrationValid,
  PAGINATION_HYDRATION_FAILED_MESSAGE,
  runIdFromWatchdogAlarmName,
  shouldAbortForMissingProcessing,
  shouldContentScriptProcess,
  watchdogAlarmName,
  withConfirmedContext,
  withPendingAdvance,
} from './lib/run-orchestrator.js'
import { resolveConnectedSgsTab, saveVerifiedSgsTab } from './lib/sgs-tab-connection.js'

/** TRACE THE EXACT AR_START FAILURE — the last startup-trace entry,
 * persisted (never only broadcast) so it survives the popup being
 * closed/reopened and can still be shown in Section 7 "even after
 * abort," per the exact required shape: step, timestamp, suppliedTabId,
 * resolvedTabId, resolvedPageUrl, pingResult, error, abortReason. Every
 * connection-handshake checkpoint happens BEFORE a run exists to persist
 * it on its own debugLog, so this is a SEPARATE, small, single-entry
 * store (overwritten each call, never a growing list) rather than a
 * field on run state. */
const STARTUP_TRACE_KEY = 'sgsBridgeLastStartupTrace'

/**
 * @param {string} step
 * @param {{ suppliedTabId?: number|null, resolvedTabId?: number|null, resolvedPageUrl?: string|null, pingResult?: unknown, error?: string|null, abortReason?: string|null } | null} detail
 */
async function recordStartupTrace(step, detail) {
  const entry = { step, timestamp: Date.now(), detail: detail ?? null }
  debugLog(step, detail)
  await chrome.storage.session.set({ [STARTUP_TRACE_KEY]: entry }).catch(() => {})
  // Best-effort live broadcast on top of the persisted copy above — a
  // closed popup has no listener, same as broadcastStateChanged below,
  // never itself an error.
  chrome.runtime.sendMessage({ type: AR_MESSAGE.STARTUP_TRACE, ...entry }).catch(() => {})
}

async function getStartupTrace() {
  const stored = await chrome.storage.session.get(STARTUP_TRACE_KEY)
  return stored[STARTUP_TRACE_KEY] ?? null
}

/** FINAL AUTO-RUN EXECUTION BUG FIX (item 6) — the practical floor for a
 * one-shot chrome.alarms delay (chrome.alarms, unlike setTimeout/
 * setInterval, keeps firing even if this service worker was suspended in
 * the meantime — see this file's own header on item 3's lifecycle rule).
 * 30 seconds is easily enough for a real page-1 scan/plan/first-write to
 * report its own AR_PAGE_PROGRESS (which clears this alarm — see
 * handlePageProgress) — this only ever fires for a run that TRULY never
 * got that far. */
const WATCHDOG_DELAY_MINUTES = 0.5

/** Every checkpoint this file logs is ALSO visible directly in the
 * service worker's own devtools console (chrome://extensions -> "service
 * worker") for local debugging (item 4) — a run's own persisted
 * debugLog (see appendDebugEvent) is the teacher-facing subset a reopened
 * popup can render live, starting only once a run actually exists. */
function debugLog(event, detail) {
  console.debug('[SGS Bridge]', event, detail ?? '')
}

const RUN_STORAGE_KEY = 'sgsBridgeActiveAutoRun'

async function getState() {
  const stored = await chrome.storage.session.get(RUN_STORAGE_KEY)
  return stored[RUN_STORAGE_KEY] ?? null
}

async function setState(state) {
  await chrome.storage.session.set({ [RUN_STORAGE_KEY]: state })
  broadcastStateChanged(state)
  return state
}

/** Best-effort — a closed popup has no listener, and that's an entirely
 * expected, non-error condition here (item 3: the run must survive the
 * popup being closed), so the rejection is always swallowed. */
function broadcastStateChanged(state) {
  chrome.runtime.sendMessage({ type: AR_MESSAGE.STATE_CHANGED, state }).catch(() => {})
}

/** Best-effort delivery to the one tab a run belongs to — a tab that has
 * been closed or navigated away from a matching SGS URL simply has no
 * listener, which is never itself treated as a run failure here (the
 * content script's own next fresh load, if any, is what will pick the
 * run back up via AR_CHECK_ACTIVE). */
function sendToTab(tabId, message) {
  if (tabId === null || tabId === undefined) return
  chrome.tabs.sendMessage(tabId, message).catch(() => {})
}

/** FINAL SGS AUTO-RUN FIX (item 3) — waits for a tab's own navigation to
 * finish loading, or `timeoutMs`, whichever comes first. Used ONLY after
 * chrome.tabs.reload below — never as a substitute for the PING handshake
 * itself, since "the page finished loading" is not proof its content
 * script's message listener is registered yet. */
function waitForTabLoadComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      chrome.tabs.onUpdated.removeListener(listener)
      clearTimeout(timer)
      resolve()
    }
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish()
    }
    chrome.tabs.onUpdated.addListener(listener)
    const timer = setTimeout(finish, timeoutMs)
  })
}

const RELOAD_WAIT_TIMEOUT_MS = 4000

/**
 * LIVE-BUG FIX (item 3) — healing tiers, tried ONLY after handleStart's
 * own initial resolveConnectedSgsTab call already failed to find ANY
 * connected SGS tab anywhere: inject once, then reload once, RE-
 * RESOLVING (never a bare re-ping of the same fixed id — resolveConnectedSgsTab
 * is the ONE shared tab-discovery/ping function, reused here exactly
 * like everywhere else) after each attempt.
 *
 * 1. Inject src/content-script.js via chrome.scripting.executeScript
 *    into `tabId` (the caller's own best guess), then re-resolve —
 *    covers the tab having been opened BEFORE this extension's content
 *    script ever got a chance to auto-inject into it. content-script.js's
 *    own top-of-file already-loaded guard makes this a safe no-op if a
 *    WORKING content script is already there (never risks a second
 *    overlapping pipeline in the same tab) — but that SAME guard also
 *    means this tier is a no-op for tier 2's own failure mode below.
 * 2. Reload `tabId`, then re-resolve — the only fix for an ORPHANED
 *    content script (this extension was reloaded/updated during
 *    development while the SGS tab stayed open): its isolated world's
 *    messaging is permanently invalidated, and re-injecting more code
 *    into that SAME isolated world is blocked by its own already-loaded
 *    guard (tier 1, above) — only a real navigation tears down that
 *    isolated world and lets the manifest's own content_scripts entry
 *    populate a fresh, working one from scratch.
 *
 * Every step broadcasts AR_STARTUP_TRACE (item 6) so a stuck run's exact
 * failure point is visible in Section 7, not just in this worker's own
 * console. Returns the SAME {tabId, pageUrl, connected} shape
 * resolveConnectedSgsTab does.
 */
async function ensureContentScriptReady(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content-script.js'] })
    await recordStartupTrace('SCRIPT_INJECTED', { suppliedTabId: tabId })
  } catch (err) {
    await recordStartupTrace('SCRIPT_INJECTED', { suppliedTabId: tabId, error: String(err) })
  }
  let resolved = await resolveConnectedSgsTab(tabId)
  if (resolved.connected) {
    await recordStartupTrace('PING_RETRY_OK', { suppliedTabId: tabId, resolvedTabId: resolved.tabId, resolvedPageUrl: resolved.pageUrl })
    return resolved
  }
  await recordStartupTrace('PING_FAILED', { suppliedTabId: tabId, pingResult: 'failed_after_injection', error: resolved.errorMessage ?? null })

  try {
    await chrome.tabs.reload(tabId)
  } catch (err) {
    return { tabId: null, pageUrl: null, connected: false, errorCode: AR_ERROR_CODE.SGS_TAB_NOT_FOUND, errorMessage: String(err) }
  }
  await waitForTabLoadComplete(tabId, RELOAD_WAIT_TIMEOUT_MS)
  resolved = await resolveConnectedSgsTab(tabId)
  if (resolved.connected) {
    await recordStartupTrace('PING_RETRY_OK', {
      suppliedTabId: tabId,
      resolvedTabId: resolved.tabId,
      resolvedPageUrl: resolved.pageUrl,
      pingResult: 'ok_after_reload',
    })
    return resolved
  }
  await recordStartupTrace('PING_FAILED', { suppliedTabId: tabId, pingResult: 'failed_after_reload', error: resolved.errorMessage ?? null })
  return resolved
}

/**
 * FINAL AUTO-RUN STATE BUG FIX (item 2/6) — this is the SECOND of the
 * two required pagination guards (popup.js's own AR_START click handler
 * is the first): even if popup somehow sent a START with missing/
 * incomplete pagination, a run is NEVER created from it. `pagination`
 * here is popup.js's OWN fresh, just-taken inspection (never this file
 * re-doing or trusting any earlier/cached read).
 *
 * LIVE-BUG FIX — `message.tabId` (popup's own best guess, e.g. from its
 * own resolveConnectedSgsTab call) is only ever a PREFERRED hint here,
 * never trusted outright: resolveConnectedSgsTab (the SAME shared
 * function popup.js's diagnostic button and its own AR_START click
 * handler both call — see sgs-tab-connection.js's own doc comment on the
 * exact live bug this fixes) independently re-searches every tab in
 * every window and re-PINGs before this file ever creates a run. Only if
 * NO tab anywhere answers does the inject/reload healing
 * (ensureContentScriptReady) get one more try against popup's original
 * guess; only if that ALSO fails is AR_START finally refused. Once a
 * real connected tab is found, createInitialRunState uses THAT tab's own
 * id (never necessarily `message.tabId`), AR_KICKOFF is dispatched
 * immediately (never waiting for a navigation/reload — item 1), and a
 * watchdog alarm is armed as the last-resort safety net (item 6) in case
 * page-1 processing still somehow never begins.
 */
async function handleStart(message) {
  // AR_START_ENTER — the very first thing handleStart does, before even
  // reading the message body, so a trace can prove this function was
  // reached at all (as opposed to popup.js's OWN pre-flight tab check
  // aborting before AR_START was ever sent — see popup.js's arRunBtn
  // handler, which now sends AR_START unconditionally and lets THIS
  // function be the single authority, per item "AR_START_ENTER must be
  // the first checkpoint of the whole flow").
  await recordStartupTrace('AR_START_ENTER', { suppliedTabId: message?.tabId ?? null })

  const suppliedTabId = message?.tabId ?? null
  const { subject, classroom, targetColumn, payload, overwriteMode, pagination } = message
  await recordStartupTrace('AR_START_INPUT_RECEIVED', { suppliedTabId, hasPagination: pagination != null })

  if (!isPaginationHydrationValid(pagination)) {
    await recordStartupTrace('PAGINATION_VALID', { suppliedTabId, abortReason: PAGINATION_HYDRATION_FAILED_MESSAGE })
    return { ok: false, state: null, reason: PAGINATION_HYDRATION_FAILED_MESSAGE, errorCode: AR_ERROR_CODE.PAGINATION_INVALID }
  }
  await recordStartupTrace('PAGINATION_VALID', { suppliedTabId })

  await recordStartupTrace('RESOLVER_BEGIN', { suppliedTabId })
  let resolved = await resolveConnectedSgsTab(suppliedTabId)
  await recordStartupTrace('RESOLVER_RESULT', {
    suppliedTabId,
    resolvedTabId: resolved.tabId,
    resolvedPageUrl: resolved.pageUrl,
    pingResult: resolved.connected ? 'connected' : 'not_connected',
    error: resolved.errorMessage ?? null,
  })

  // PING_BEGIN/PING_RESULT are their OWN checkpoints (never folded into
  // RESOLVER_BEGIN/RESULT above) because resolveConnectedSgsTab's PING is
  // an implementation detail of tab RESOLUTION — this pair specifically
  // answers "did the tab we ended up with actually answer PING," which
  // stays meaningful even if a future resolver strategy stops doing its
  // own internal ping.
  await recordStartupTrace('PING_BEGIN', { suppliedTabId, resolvedTabId: resolved.tabId })
  await recordStartupTrace('PING_RESULT', {
    suppliedTabId,
    resolvedTabId: resolved.tabId,
    pingResult: resolved.connected ? 'OK' : 'FAILED',
    error: resolved.errorMessage ?? null,
  })

  if (!resolved.connected) {
    resolved = await ensureContentScriptReady(suppliedTabId)
  }
  if (!resolved.connected) {
    const abortReason = CONTENT_SCRIPT_UNAVAILABLE_MESSAGE
    const errorCode = resolved.errorCode ?? AR_ERROR_CODE.SGS_TAB_NOT_FOUND
    debugLog('content script unavailable — refusing to start a run', { tabId: suppliedTabId, errorCode })
    await recordStartupTrace('AR_START_ABORTED', {
      suppliedTabId,
      resolvedTabId: resolved.tabId,
      resolvedPageUrl: resolved.pageUrl,
      pingResult: 'FAILED',
      error: resolved.errorMessage ?? null,
      abortReason: `${errorCode}: ${abortReason}`,
    })
    return { ok: false, state: null, reason: abortReason, errorCode }
  }

  const tabId = resolved.tabId
  await saveVerifiedSgsTab(tabId, resolved.pageUrl)

  let state
  try {
    state = createInitialRunState({
      runId: crypto.randomUUID(),
      tabId,
      subject,
      classroom,
      targetColumn,
      payload,
      overwriteMode,
      currentPage: pagination.currentPage,
      totalPages: pagination.totalPages,
      totalStudentRows: pagination.totalStudentRows ?? null,
      pageSize: pagination.pageSize ?? null,
    })
  } catch (err) {
    const abortReason = 'ไม่สามารถสร้างสถานะการทำงานได้'
    await recordStartupTrace('AR_START_ABORTED', {
      suppliedTabId,
      resolvedTabId: tabId,
      resolvedPageUrl: resolved.pageUrl,
      error: String(err),
      abortReason: `${AR_ERROR_CODE.RUN_STATE_CREATE_FAILED}: ${abortReason}`,
    })
    return { ok: false, state: null, reason: abortReason, errorCode: AR_ERROR_CODE.RUN_STATE_CREATE_FAILED }
  }
  await setState(state)
  await recordStartupTrace('RUN_STATE_CREATED', { suppliedTabId, resolvedTabId: tabId, resolvedPageUrl: resolved.pageUrl, runId: state.runId })

  await recordStartupTrace('KICKOFF_BEGIN', { resolvedTabId: tabId, runId: state.runId })
  await recordStartupTrace('PROCESS_CURRENT_PAGE_SEND_BEGIN', { resolvedTabId: tabId, runId: state.runId })
  try {
    await chrome.tabs.sendMessage(tabId, { type: AR_MESSAGE.KICKOFF, runId: state.runId })
    await recordStartupTrace('PROCESS_CURRENT_PAGE_SEND_RESULT', { resolvedTabId: tabId, runId: state.runId, pingResult: 'OK' })
  } catch (err) {
    // KICKOFF failing to reach the tab is NOT fatal here — the run is
    // already created/persisted, and content-script.js's own
    // AR_CHECK_ACTIVE (on its next fresh load) / AR_SGS_CONTENT_READY
    // (see handleContentReady) will still pick it up without the teacher
    // needing to reopen the popup. Traced distinctly (KICKOFF_SEND_FAILED)
    // so this is visible, never silently retried in a way that could
    // ever send two competing KICKOFFs for the same run.
    await recordStartupTrace('PROCESS_CURRENT_PAGE_SEND_RESULT', {
      resolvedTabId: tabId,
      runId: state.runId,
      pingResult: 'FAILED',
      error: String(err),
      abortReason: `${AR_ERROR_CODE.KICKOFF_SEND_FAILED}: ไม่สามารถส่ง KICKOFF ไปยังแท็บได้ (ไม่ถือว่าล้มเหลวทั้งรัน)`,
    })
  }

  await chrome.alarms.create(watchdogAlarmName(state.runId), { delayInMinutes: WATCHDOG_DELAY_MINUTES })

  await recordStartupTrace('AR_START_SUCCESS', { resolvedTabId: tabId, runId: state.runId })
  return { ok: true, state }
}

/**
 * FINAL AUTO-RUN EXECUTION BUG FIX (item 6) — "never leave a dead run":
 * fires once, WATCHDOG_DELAY_MINUTES after AR_START, only for the exact
 * run it was armed for (runIdFromWatchdogAlarmName/shouldAbortForMissing
 * Processing — a pure decision, see run-orchestrator.js). A run that
 * already reported ANY page-1 progress by then is left completely alone,
 * however long it goes on to take.
 */
async function handleWatchdogAlarm(alarmName) {
  const alarmRunId = runIdFromWatchdogAlarmName(alarmName)
  if (!alarmRunId) return
  const state = await getState()
  if (!shouldAbortForMissingProcessing(state, alarmRunId)) return
  debugLog('watchdog: page-1 processing never started — aborting', { runId: alarmRunId })
  await setState(applyAbort(state, CONTENT_SCRIPT_UNAVAILABLE_MESSAGE))
}

chrome.alarms.onAlarm.addListener((alarm) => {
  void handleWatchdogAlarm(alarm.name)
})

/**
 * `requestingTabId` is popup.js's own currently-active tab (see
 * getActiveTab() there) — a popup happening to be open while looking at
 * a DIFFERENT tab than the one a run belongs to can neither see nor stop/
 * resume that run through this path; it always gets `{ok: false,
 * state: null}` (GET_STATE) or is simply refused (STOP/MANUAL_CONTINUE),
 * never another tab's progress or control.
 */
function stateForTab(state, requestingTabId) {
  return state && state.tabId === requestingTabId ? state : null
}

async function handleStop(requestingTabId) {
  const state = stateForTab(await getState(), requestingTabId)
  if (!state) return { ok: false, state: null }
  const next = applyStopRequested(state)
  await setState(next)
  sendToTab(state.tabId, { type: AR_MESSAGE.STOP, runId: state.runId })
  return { ok: true, state: next }
}

async function handleManualContinue(requestingTabId) {
  const state = stateForTab(await getState(), requestingTabId)
  if (!state) return { ok: false, state: null }
  const next = applyResume(state)
  await setState(next)
  sendToTab(state.tabId, { type: AR_MESSAGE.RESUME, runId: state.runId })
  return { ok: true, state: next }
}

/** content-script.js's own entry-point check, called on every fresh page
 * load and on receiving AR_KICKOFF/AR_RESUME. `tabId` is always the
 * SENDER's own tab (a content script can only ever ask about its own
 * tab) — never trusted from the message body itself. */
async function handleCheckActive(tabId) {
  const state = await getState()
  if (!state || state.tabId !== tabId) {
    return { shouldProcess: false, state: null, pendingAdvance: null }
  }
  if (state.pendingAdvance) {
    return { shouldProcess: false, state, pendingAdvance: state.pendingAdvance }
  }
  return { shouldProcess: shouldContentScriptProcess(state, tabId), state, pendingAdvance: null }
}

/**
 * FINAL SGS AUTO-RUN FIX (item 2/5) — a content script announces itself
 * the moment it starts, including after an ASP.NET postback/reload —
 * this is the explicit, named counterpart to content-script.js's own
 * main() (which already asks AR_CHECK_ACTIVE and processes on its own
 * whenever shouldProcess is true): main()'s own direct call and this
 * handler's own AR_KICKOFF both funnel into the SAME processCurrentPage,
 * which is idempotent per instance (its own `processing` re-entrancy
 * guard — see content-script.js), so having both paths is a deliberate
 * belt-and-suspenders, never a double-write risk. "No popup reopen
 * required" (item 5) falls out of this for free: background reacts to
 * the tab reconnecting on its own, without popup needing to be open at
 * all.
 */
async function handleContentReady(tabId, { pageUrl }) {
  await recordStartupTrace('CONTENT_SCRIPT_RECEIVED', { resolvedTabId: tabId, resolvedPageUrl: pageUrl })
  const state = await getState()
  if (!shouldContentScriptProcess(state, tabId)) {
    // "Never allow the handler to receive PROCESS_CURRENT_PAGE and then
    // silently stop" applies to this branch too: it is the very first
    // statement after CONTENT_SCRIPT_RECEIVED, and it used to return with
    // no checkpoint at all — leaving the trace stuck on
    // CONTENT_SCRIPT_RECEIVED with nothing to say why. Declining to
    // dispatch is a legitimate outcome (no run, a finished run, or a run
    // belonging to another tab), but it is never silent.
    await recordStartupTrace('CONTENT_READY_NO_ACTIVE_RUN', {
      resolvedTabId: tabId,
      resolvedPageUrl: pageUrl,
      abortReason: state
        ? `ไม่ส่ง KICKOFF: สถานะรัน status=${state.status} approved=${state.approved} active=${state.active} tabId=${state.tabId}`
        : 'ไม่ส่ง KICKOFF: ยังไม่มีสถานะรันที่บันทึกไว้',
    })
    return { ok: true }
  }
  sendToTab(tabId, { type: AR_MESSAGE.KICKOFF, runId: state.runId })
  await recordStartupTrace('PROCESS_CURRENT_PAGE_SEND_RESULT', { resolvedTabId: tabId, runId: state.runId, pingResult: 'OK', viaReload: true })
  return { ok: true }
}

/**
 * TRACE THE FAILURE BOUNDARY — content-script.js's own PROCESS_CURRENT_PAGE
 * checkpoints (PROCESS_HANDLER_ENTER .. PAGE_PLAN_READY) and, on an
 * exception, PROCESS_CURRENT_PAGE_FAILED carrying {step, errorName,
 * errorMessage, stack}. Persisted into the SAME single startup-trace slot
 * Section 7 already renders, so the window between CONTENT_SCRIPT_RECEIVED
 * and PAGE_SCAN_OK is finally visible — including when the handler stops
 * before any run state exists for appendDebugEvent to attach to.
 *
 * `errorMessage` is surfaced as `error` so renderDebugPanel shows it under
 * "ข้อผิดพลาดจริง" with no popup-side special-casing.
 */
async function handleProcessTrace(tabId, { step, detail }) {
  const incoming = detail ?? {}
  await recordStartupTrace(step, {
    ...incoming,
    resolvedTabId: tabId,
    error: incoming.errorMessage ?? incoming.error ?? null,
  })
  return { ok: true }
}

async function handlePendingAdvance(tabId, pendingAdvance) {
  const state = await getState()
  if (!state || state.tabId !== tabId) return { ok: false }
  await setState(withPendingAdvance(state, pendingAdvance))
  return { ok: true }
}

async function handleAdvanceConfirmed(tabId) {
  const state = await getState()
  if (!state || state.tabId !== tabId) return { ok: false }
  await setState(clearPendingAdvance(state))
  return { ok: true }
}

async function handlePageProgress(tabId, { pageNumber, totalPages, totalStudentRows, pageSize, runningSummary, confirmedContext }) {
  const state = await getState()
  if (!state || state.tabId !== tabId) return { ok: false }
  let next = applyPageProgress(state, { pageNumber, totalPages, totalStudentRows, pageSize, runningSummary })
  if (confirmedContext) next = withConfirmedContext(next, confirmedContext)
  await setState(next)
  // FINAL AUTO-RUN EXECUTION BUG FIX (item 6) — this is proof page
  // processing began, so the watchdog armed in handleStart (or after any
  // later page's own advance) no longer has anything to guard against.
  // A no-op, safely, once the alarm has already fired/been cleared.
  await chrome.alarms.clear(watchdogAlarmName(state.runId)).catch(() => {})
  return { ok: true }
}

/** FINAL AUTO-RUN EXECUTION BUG FIX (item 4) — relays one of content-
 * script.js's own pipeline checkpoints (PAGE_SCAN_OK/PAGE_PLAN_READY/
 * CELL_WRITE_START/PAGE_DONE/NEXT_PAGE_REQUESTED) into the run's own
 * debugLog, purely for visibility — never itself a state transition a
 * later gate depends on. */
async function handleDebugEvent(tabId, { event, detail }) {
  const state = await getState()
  if (!state || state.tabId !== tabId) return { ok: false }
  await setState(appendDebugEvent(state, { event, detail }))
  return { ok: true }
}

async function handlePageComplete(tabId, { pageNumber, pageSummary, failedStudents, studentResults }) {
  const state = await getState()
  if (!state || state.tabId !== tabId) return { ok: false }
  const next = applyPageComplete(state, { pageNumber, pageSummary, failedStudents, studentResults })
  await setState(clearPendingAdvance(next))
  return { ok: true }
}

async function handleManualPause(tabId, { reason, expectedNextPage }) {
  const state = await getState()
  if (!state || state.tabId !== tabId) return { ok: false }
  await setState(clearPendingAdvance(applyManualPause(state, { reason, expectedNextPage })))
  return { ok: true }
}

async function handleAbort(tabId, { reason }) {
  const state = await getState()
  if (!state || state.tabId !== tabId) return { ok: false }
  await setState(applyAbort(state, reason))
  return { ok: true }
}

async function handleStopped(tabId) {
  const state = await getState()
  if (!state || state.tabId !== tabId) return { ok: false }
  await setState(applyStopped(state))
  return { ok: true }
}

async function handleComplete(tabId) {
  const state = await getState()
  if (!state || state.tabId !== tabId) return { ok: false }
  await setState(applyCompleted(state))
  return { ok: true }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false
  const senderTabId = sender.tab ? sender.tab.id : null

  switch (message.type) {
    case AR_MESSAGE.START:
      void handleStart(message).then(sendResponse)
      return true
    case AR_MESSAGE.STOP:
      void handleStop(message.tabId).then(sendResponse)
      return true
    case AR_MESSAGE.GET_STATE:
      // LIVE-TRACE ROOT CAUSE FIX — a CONTENT SCRIPT cannot know its own
      // tabId (chrome.tabs is not exposed to it), so it never sends one:
      // every content-script GET_STATE arrived here with
      // `message.tabId === undefined`, stateForTab compared
      // `state.tabId === undefined`, and the run state came back as null.
      // That is exactly why the KICKOFF handler's
      // `if (stateResponse?.state)` was always false and
      // processCurrentPage was never called — the run sat at 0/32 with
      // the trace ending at CONTENT_SCRIPT_RECEIVED and no error anywhere.
      // The sender's OWN tab is the authority for a content script, which
      // is the convention every other content-script-facing handler in
      // this file already uses (handleCheckActive/handlePageProgress/...).
      // The popup has no sender.tab, so it keeps supplying message.tabId.
      void getState().then((state) => sendResponse({ state: stateForTab(state, senderTabId ?? message.tabId) }))
      return true
    case AR_MESSAGE.PROCESS_TRACE:
      void handleProcessTrace(senderTabId, message).then(sendResponse)
      return true
    case AR_MESSAGE.GET_STARTUP_TRACE:
      void getStartupTrace().then((trace) => sendResponse({ trace }))
      return true
    case AR_MESSAGE.MANUAL_CONTINUE:
      void handleManualContinue(message.tabId).then(sendResponse)
      return true
    case AR_MESSAGE.CHECK_ACTIVE:
      void handleCheckActive(senderTabId).then(sendResponse)
      return true
    case AR_MESSAGE.CONTENT_READY:
      void handleContentReady(senderTabId, message).then(sendResponse)
      return true
    case AR_MESSAGE.PENDING_ADVANCE:
      void handlePendingAdvance(senderTabId, message.pendingAdvance).then(sendResponse)
      return true
    case AR_MESSAGE.ADVANCE_CONFIRMED:
      void handleAdvanceConfirmed(senderTabId).then(sendResponse)
      return true
    case AR_MESSAGE.PAGE_PROGRESS:
      void handlePageProgress(senderTabId, message).then(sendResponse)
      return true
    case AR_MESSAGE.PAGE_COMPLETE:
      void handlePageComplete(senderTabId, message).then(sendResponse)
      return true
    case AR_MESSAGE.MANUAL_PAUSE:
      void handleManualPause(senderTabId, message).then(sendResponse)
      return true
    case AR_MESSAGE.ABORT:
      void handleAbort(senderTabId, message).then(sendResponse)
      return true
    case AR_MESSAGE.STOPPED:
      void handleStopped(senderTabId).then(sendResponse)
      return true
    case AR_MESSAGE.COMPLETE:
      void handleComplete(senderTabId).then(sendResponse)
      return true
    case AR_MESSAGE.DEBUG_EVENT:
      void handleDebugEvent(senderTabId, message).then(sendResponse)
      return true
    default:
      // AR_MESSAGE.PING is never handled here — it is answered by
      // content-script.js itself (see ensureContentScriptReady's own doc
      // comment), never routed through this background worker.
      return false
  }
})
