/**
 * LIVE-BUG FIX — "the diagnostic connection path and AR_START/handleStart
 * are using DIFFERENT tab discovery / connection logic." Confirmed live:
 * a teacher had chrome://extensions open in one Chrome window and the
 * real SGS tab open in a SEPARATE window. popup.js's old getActiveTab()
 * (`chrome.tabs.query({active: true, currentWindow: true})`) resolves
 * relative to whichever window happens to be "current" for the CALLING
 * script at that exact moment — never an actual search for the SGS tab
 * itself. The "ตรวจสอบการเชื่อมต่อ Content Script" diagnostic and the
 * AR_START click could therefore each resolve a DIFFERENT tab despite
 * being clicked moments apart in the same popup session — exactly the
 * reported bug (diagnostic: CONNECTED to the real tab; AR_START moments
 * later: refused, having silently resolved something else, such as the
 * chrome://extensions tab itself).
 *
 * This module is the ONE place both popup.js (the diagnostic button AND
 * the "เริ่มส่งครบทั้งห้อง" click handler) and background.js (handleStart)
 * resolve which real SGS tab to talk to — neither ever re-implements its
 * own tab-discovery query. It never assumes a "current" window at all:
 * it searches every tab in every window for one whose URL matches the
 * real SGS pattern, then PINGs each candidate (a URL match alone is
 * never enough — only a tab whose content script actually answers PING
 * counts as "connected") until one responds.
 */

import { AR_ERROR_CODE, AR_MESSAGE } from './run-orchestrator.js'

export const SGS_TAB_URL_MATCH_PATTERN = 'https://sgs.bopp-obec.info/sgs/*'

const VERIFIED_TAB_ID_KEY = 'verifiedSgsTabId'
const VERIFIED_PAGE_URL_KEY = 'verifiedSgsPageUrl'

/**
 * item 6's exact live regression, made a pure/testable unit on its own:
 * a `preferredTabId` (e.g. the tabId a diagnostic just confirmed
 * CONNECTED, or a prior chrome.storage.session value) is moved to the
 * FRONT of the candidate list, regardless of where chrome.tabs.query
 * happened to put it — so resolveConnectedSgsTab always tries the
 * ALREADY-KNOWN-GOOD tab first, before falling back to searching every
 * other candidate. Never inserts a fake entry for a preferredTabId that
 * isn't actually among the candidates, and is a pure no-op (original
 * order preserved) when no preference is given at all.
 */
export function orderCandidatesByPreferredTabId(candidates, preferredTabId) {
  if (preferredTabId === null || preferredTabId === undefined) return candidates
  return [...candidates.filter((tab) => tab.id === preferredTabId), ...candidates.filter((tab) => tab.id !== preferredTabId)]
}

/**
 * TRACE FIX — classifies a PING failure by the REAL Chrome runtime error
 * text, instead of collapsing every failure into one generic "not
 * found" outcome. These are Chrome's own well-known message-passing
 * error strings (never guessed/invented): a tab that no longer exists,
 * a tab whose content script never registered a listener at all
 * ("Receiving end does not exist"), and a listener that WAS there but
 * closed the message port before replying (rare, but distinct — usually
 * means the receiving script errored or tore down mid-handshake). Any
 * other error text falls back to the generic PING_FAILED code rather
 * than a wrong specific one.
 */
export function classifyPingError(errorMessage) {
  const message = String(errorMessage ?? '')
  if (/No tab with id/i.test(message)) return AR_ERROR_CODE.SGS_TAB_NOT_FOUND
  if (/Receiving end does not exist/i.test(message)) return AR_ERROR_CODE.CONTENT_RECEIVER_MISSING
  if (/message port closed before a response/i.test(message)) return AR_ERROR_CODE.MESSAGE_PORT_CLOSED
  return AR_ERROR_CODE.PING_FAILED
}

/** Best-effort — a tab with no content script listener (closed,
 * navigated away, or simply never loaded one) just never responds; this
 * is never itself thrown as an error to the caller, but the REAL Chrome
 * error text and its classifyPingError code are always preserved on
 * failure rather than discarded, so a caller several layers up (Section
 * 7's own debug panel) can show the actual runtime error instead of a
 * single collapsed guess. */
async function pingTab(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: AR_MESSAGE.PING })
    if (response?.ready) return { ok: true, pageUrl: response.pageUrl ?? null }
    return {
      ok: false,
      errorCode: AR_ERROR_CODE.CONTENT_RECEIVER_MISSING,
      errorMessage: 'ตอบกลับ PING แต่ ready ไม่เป็นจริง (response.ready !== true)',
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    return { ok: false, errorCode: classifyPingError(errorMessage), errorMessage }
  }
}

/**
 * TRACE FIX — "use the already verified tab": when a `preferredTabId` is
 * given (e.g. a tab a diagnostic or a previous AR_START JUST confirmed
 * CONNECTED), this PINGs that EXACT tab id directly FIRST — never going
 * through chrome.tabs.query at all for that first attempt. Only when
 * that direct re-PING itself fails does this fall back to the broader
 * "search every tab in every window matching the SGS URL pattern" scan
 * below. This is structurally different from (and fixes) the previous
 * behavior of always running the broad query FIRST and only ordering a
 * preferredTabId to the front IF chrome.tabs.query happened to include
 * it among its results — a tab chrome.tabs.query's own matching missed
 * or excluded for any reason was previously silently dropped and never
 * pinged at all, even though its id was already known-good a moment
 * earlier. A closed/navigated-away preferredTabId still just fails this
 * direct ping exactly like any other stale candidate would, and falls
 * through to the same broad search every other caller relies on.
 *
 * Returns { tabId, pageUrl, connected, errorCode, errorMessage } —
 * pageUrl is the content script's OWN reported `location.href` (see
 * content-script.js's PING handler), never merely the tab's own `.url`
 * field, though that is used as a fallback if a response somehow omits
 * it. errorCode/errorMessage are populated only when connected is false,
 * and reflect the LAST ping attempt's own real failure (see
 * classifyPingError) — never a single generic reason.
 */
export async function resolveConnectedSgsTab(preferredTabId) {
  // The direct re-PING's own failure, if it happens — remembered in case
  // the broad search below finds nothing at all either (a more specific
  // "the tab you already verified is now gone/unreachable" beats a
  // generic "no tab found").
  let lastFailure = null
  if (preferredTabId !== null && preferredTabId !== undefined) {
    const direct = await pingTab(preferredTabId)
    if (direct.ok) {
      return { tabId: preferredTabId, pageUrl: direct.pageUrl, connected: true, errorCode: null, errorMessage: null }
    }
    lastFailure = direct
  }

  const candidates = await chrome.tabs.query({ url: SGS_TAB_URL_MATCH_PATTERN })
  const ordered = orderCandidatesByPreferredTabId(candidates, preferredTabId)

  for (const tab of ordered) {
    if (tab.id === preferredTabId) continue // already tried directly, above
    const response = await pingTab(tab.id)
    if (response.ok) {
      return { tabId: tab.id, pageUrl: response.pageUrl ?? tab.url ?? null, connected: true, errorCode: null, errorMessage: null }
    }
    lastFailure = response
  }

  if (!lastFailure) {
    return {
      tabId: null,
      pageUrl: null,
      connected: false,
      errorCode: AR_ERROR_CODE.SGS_TAB_NOT_FOUND,
      errorMessage: 'ไม่พบแท็บที่ URL ตรงกับรูปแบบหน้า SGS เลยสักแท็บเดียว',
    }
  }
  return { tabId: null, pageUrl: null, connected: false, errorCode: lastFailure.errorCode, errorMessage: lastFailure.errorMessage }
}

/**
 * item 4 — persisted so a later AR_START can reuse a just-verified tab
 * as its own `preferredTabId` hint. Always re-PINGed fresh by
 * resolveConnectedSgsTab before ever being trusted (see above) — never
 * read back and acted on blindly.
 */
export async function saveVerifiedSgsTab(tabId, pageUrl) {
  await chrome.storage.session.set({ [VERIFIED_TAB_ID_KEY]: tabId, [VERIFIED_PAGE_URL_KEY]: pageUrl })
}

export async function loadVerifiedSgsTabId() {
  const stored = await chrome.storage.session.get(VERIFIED_TAB_ID_KEY)
  return stored[VERIFIED_TAB_ID_KEY] ?? null
}
