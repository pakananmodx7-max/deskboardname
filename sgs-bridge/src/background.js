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
  createInitialRunState,
  isPaginationHydrationValid,
  PAGINATION_HYDRATION_FAILED_MESSAGE,
  shouldContentScriptProcess,
  withConfirmedContext,
  withPendingAdvance,
} from './lib/run-orchestrator.js'

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

/**
 * FINAL AUTO-RUN STATE BUG FIX (item 2/6) — this is the SECOND of the
 * two required guards (popup.js's own AR_START click handler is the
 * first): even if popup somehow sent a START with missing/incomplete
 * pagination, a run is NEVER created from it. `pagination` here is
 * popup.js's OWN fresh, just-taken inspection (never this file re-doing
 * or trusting any earlier/cached read) — createInitialRunState is only
 * ever called once this guard has already passed, so a state with
 * `status: 'running'` can never exist with `currentPage`/`totalPages`
 * still `null`.
 */
async function handleStart(message) {
  const { tabId, subject, classroom, targetColumn, payload, overwriteMode, pagination } = message
  if (!isPaginationHydrationValid(pagination)) {
    return { ok: false, state: null, reason: PAGINATION_HYDRATION_FAILED_MESSAGE }
  }
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
  sendToTab(tabId, { type: AR_MESSAGE.KICKOFF, runId: state.runId })
  return { ok: true, state }
}

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
    default:
      return false
  }
})
