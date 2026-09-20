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

/** FINAL SGS AUTO-RUN FIX (item 6) — broadcast-only, never persisted:
 * every one of these connection-handshake steps happens BEFORE a run
 * exists to persist it on (see AR_MESSAGE.STARTUP_TRACE's own doc
 * comment). A closed popup has no listener, same as broadcastStateChanged
 * below — never itself an error. */
function broadcastStartupTrace(step, detail) {
  debugLog(step, detail)
  chrome.runtime.sendMessage({ type: AR_MESSAGE.STARTUP_TRACE, step, detail: detail ?? null }).catch(() => {})
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
    broadcastStartupTrace('SCRIPT_INJECTED', { tabId })
  } catch (err) {
    broadcastStartupTrace('SCRIPT_INJECTED', { tabId, failed: true, message: String(err) })
  }
  let resolved = await resolveConnectedSgsTab(tabId)
  if (resolved.connected) {
    broadcastStartupTrace('PING_RETRY_OK', resolved)
    return resolved
  }
  broadcastStartupTrace('PING_FAILED', { tabId, afterInjection: true })

  try {
    await chrome.tabs.reload(tabId)
  } catch {
    return { tabId: null, pageUrl: null, connected: false }
  }
  await waitForTabLoadComplete(tabId, RELOAD_WAIT_TIMEOUT_MS)
  resolved = await resolveConnectedSgsTab(tabId)
  if (resolved.connected) {
    broadcastStartupTrace('PING_RETRY_OK', { ...resolved, afterReload: true })
    return resolved
  }
  broadcastStartupTrace('PING_FAILED', { tabId, afterReload: true })
  return { tabId: null, pageUrl: null, connected: false }
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
  debugLog('AR_START received', { tabId: message.tabId })
  const { subject, classroom, targetColumn, payload, overwriteMode, pagination } = message
  if (!isPaginationHydrationValid(pagination)) {
    return { ok: false, state: null, reason: PAGINATION_HYDRATION_FAILED_MESSAGE }
  }

  broadcastStartupTrace('SGS_TAB_FOUND', { preferredTabId: message.tabId })
  broadcastStartupTrace('PING_SENT', { preferredTabId: message.tabId })
  let resolved = await resolveConnectedSgsTab(message.tabId)
  broadcastStartupTrace(resolved.connected ? 'PING_OK' : 'PING_FAILED', resolved)

  if (!resolved.connected) {
    resolved = await ensureContentScriptReady(message.tabId)
  }
  if (!resolved.connected) {
    debugLog('content script unavailable — refusing to start a run', { tabId: message.tabId })
    return { ok: false, state: null, reason: CONTENT_SCRIPT_UNAVAILABLE_MESSAGE }
  }

  const tabId = resolved.tabId
  broadcastStartupTrace('CONTENT_SCRIPT_RECEIVED', { tabId, pageUrl: resolved.pageUrl })
  await saveVerifiedSgsTab(tabId, resolved.pageUrl)

  const state = createInitialRunState({
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
  await setState(state)
  debugLog('RUN_CREATED', { runId: state.runId })

  sendToTab(tabId, { type: AR_MESSAGE.KICKOFF, runId: state.runId })
  broadcastStartupTrace('PROCESS_CURRENT_PAGE_SENT', { runId: state.runId })
  debugLog('PROCESS_CURRENT_PAGE sent', { runId: state.runId })

  await chrome.alarms.create(watchdogAlarmName(state.runId), { delayInMinutes: WATCHDOG_DELAY_MINUTES })

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
  broadcastStartupTrace('CONTENT_SCRIPT_RECEIVED', { tabId, pageUrl })
  const state = await getState()
  if (!shouldContentScriptProcess(state, tabId)) return { ok: true }
  sendToTab(tabId, { type: AR_MESSAGE.KICKOFF, runId: state.runId })
  broadcastStartupTrace('PROCESS_CURRENT_PAGE_SENT', { runId: state.runId, viaReload: true })
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
      void getState().then((state) => sendResponse({ state: stateForTab(state, message.tabId) }))
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
