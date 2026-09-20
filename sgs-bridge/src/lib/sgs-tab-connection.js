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

import { AR_MESSAGE } from './run-orchestrator.js'

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

/** Best-effort — a tab with no content script listener (closed,
 * navigated away, or simply never loaded one) just never responds;
 * never itself thrown as an error to the caller. */
async function pingTab(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: AR_MESSAGE.PING })
    return response?.ready ? response : null
  } catch {
    return null
  }
}

/**
 * Searches EVERY tab in EVERY window for one matching the real SGS URL
 * pattern (never limited to whichever tab/window merely happens to be
 * frontmost), then PINGs each candidate until one answers. `preferredTabId`
 * (e.g. a previously
 * verified chrome.storage.session tabId, or the tabId a caller already
 * has some reason to expect) is tried FIRST (orderCandidatesByPreferredTabId,
 * above) but is NEVER trusted without a fresh re-PING right here — a
 * closed/navigated-away tab still fails exactly like any other stale
 * candidate, and a teacher who has closed that tab and opened SGS
 * somewhere else is still found via the fresh search across every other
 * candidate.
 *
 * Returns { tabId, pageUrl, connected } — pageUrl is the content
 * script's OWN reported `location.href` (see content-script.js's PING
 * handler), never merely the tab's own `.url` field, though that is
 * used as a fallback if a response somehow omits it.
 */
export async function resolveConnectedSgsTab(preferredTabId) {
  const candidates = await chrome.tabs.query({ url: SGS_TAB_URL_MATCH_PATTERN })
  const ordered = orderCandidatesByPreferredTabId(candidates, preferredTabId)

  for (const tab of ordered) {
    const response = await pingTab(tab.id)
    if (response) {
      return { tabId: tab.id, pageUrl: response.pageUrl ?? tab.url ?? null, connected: true }
    }
  }
  return { tabId: null, pageUrl: null, connected: false }
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
