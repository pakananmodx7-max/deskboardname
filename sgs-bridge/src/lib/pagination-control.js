/**
 * BUG FIX — auto-run's page-advance previously only ever looked for a
 * ROW OF PLAIN-TEXT NUMERIC LINKS (the old ASP.NET GridView pager shape
 * this module's predecessor assumed). The real, now-confirmed SGS page
 * pagination is a small button cluster:
 *
 *   [<<] [<] [1] ของ 4 [>] [>>]
 *   32 รายการ
 *   10 / หน้า
 *
 * — "ของ" (Thai "of") sits between the current and total page numbers,
 * and the controls themselves may be an `<a>`, a `<button>`, or an
 * `input[type=image]`/`input[type=button]`, wired via a plain `onclick`,
 * an `href="javascript:__doPostBack(...)"`, or a real form submit — this
 * is an old ASP.NET WebForms app, and NextPreviousPagerField /
 * NumericPagerField controls conventionally use `__doPostBack` with a
 * SECOND argument of exactly `Page$Next`/`Page$Prev`/`Page$First`/
 * `Page$Last` (a well-documented, decades-stable ASP.NET convention —
 * never guessed, but also never independently confirmed against this
 * specific SGS deployment, since this module has no live DOM access).
 *
 * This module is PURE: it classifies already-extracted plain candidate
 * descriptors (never touches the DOM itself — that's
 * content-diagnostic.js's inspectPaginationControls, which only ever
 * COLLECTS candidates, never decides which one is "Next"). Keeping
 * classification here, DOM-free, is what makes every rule below
 * unit-testable without a browser.
 *
 * Confidence is reported honestly rather than pretended: 'high' only for
 * the ASP.NET Page$Next convention, 'medium' for an exact ">" glyph
 * match, 'low' for an id/name substring match alone. popup.js's auto-run
 * engine only ever acts automatically on 'high'/'medium' — a 'low'-only
 * finding (or none at all) falls back to the same manual "ดำเนินการต่อ"
 * prompt as "no confirmed control," per this codebase's standing rule to
 * never force automatic action when confidence is low.
 */

export const PAGINATION_ROLE = {
  FIRST: 'FIRST',
  PREV: 'PREV',
  NEXT: 'NEXT',
  LAST: 'LAST',
  UNKNOWN: 'UNKNOWN',
}

const POSTBACK_ROLE_PATTERNS = [
  { role: PAGINATION_ROLE.NEXT, pattern: /page\$next/i },
  { role: PAGINATION_ROLE.PREV, pattern: /page\$prev/i },
  { role: PAGINATION_ROLE.FIRST, pattern: /page\$first/i },
  { role: PAGINATION_ROLE.LAST, pattern: /page\$last/i },
]

/** Exact-glyph matches only — never a substring, so a label like
 * "หน้าถัดไป >" (which CONTAINS ">") is read by its glyph portion only
 * when the WHOLE trimmed text is just that glyph; a longer label falls
 * through to the weaker id/name check instead of being misread. */
const GLYPH_ROLE_PATTERNS = [
  { role: PAGINATION_ROLE.LAST, glyphs: ['>>', '»', '≫'] },
  { role: PAGINATION_ROLE.FIRST, glyphs: ['<<', '«', '≪'] },
  { role: PAGINATION_ROLE.NEXT, glyphs: ['>', '›'] },
  { role: PAGINATION_ROLE.PREV, glyphs: ['<', '‹'] },
]

const ID_NAME_ROLE_PATTERNS = [
  { role: PAGINATION_ROLE.LAST, pattern: /last/i },
  { role: PAGINATION_ROLE.FIRST, pattern: /first/i },
  { role: PAGINATION_ROLE.NEXT, pattern: /next/i },
  { role: PAGINATION_ROLE.PREV, pattern: /prev/i },
]

/**
 * @param {{tag: string, id: string|null, name: string|null, type: string|null, text: string, onclick: string|null, href: string|null, disabled: boolean}} candidate
 * @returns {{role: string, confidence: 'high'|'medium'|'low'|'none', reason: string}}
 */
export function classifyPaginationCandidate(candidate) {
  const postback = `${candidate.onclick ?? ''} ${candidate.href ?? ''}`
  for (const { role, pattern } of POSTBACK_ROLE_PATTERNS) {
    if (pattern.test(postback)) {
      return { role, confidence: 'high', reason: `__doPostBack argument matches ${pattern.source}` }
    }
  }

  const text = (candidate.text ?? '').trim()
  for (const { role, glyphs } of GLYPH_ROLE_PATTERNS) {
    if (glyphs.includes(text)) {
      return { role, confidence: 'medium', reason: `visible label is exactly "${text}"` }
    }
  }

  const idOrName = `${candidate.id ?? ''} ${candidate.name ?? ''}`
  // "last" and "next" can both appear as substrings of unrelated ids —
  // check LAST first so an id like "PagerLastNext" (unlikely, but never
  // trusted either way) never gets silently misread as NEXT.
  for (const { role, pattern } of ID_NAME_ROLE_PATTERNS) {
    if (pattern.test(idOrName)) {
      return { role, confidence: 'low', reason: `id/name matches ${pattern.source}` }
    }
  }

  return { role: PAGINATION_ROLE.UNKNOWN, confidence: 'none', reason: 'no rule matched' }
}

/**
 * Finds the single-step NEXT control among a page's collected pagination
 * candidates — NEVER Last, whatever position it happens to render in.
 * Disabled candidates (already on the last page, or a disabled Next
 * button) are never returned, since clicking them would do nothing or
 * behave unpredictably. Ties are broken by preferring the higher
 * confidence classification.
 *
 * @param {Array<{tag: string, id: string|null, name: string|null, type: string|null, text: string, onclick: string|null, href: string|null, disabled: boolean}>} candidates
 * @returns {{control: object|null, confidence: 'high'|'medium'|'low'|'none', reason: string}}
 */
export function findSgsNextPageControl(candidates) {
  const confidenceRank = { high: 3, medium: 2, low: 1, none: 0 }
  let best = null
  let bestClassification = { role: PAGINATION_ROLE.UNKNOWN, confidence: 'none', reason: 'no candidates given' }

  for (const candidate of candidates) {
    if (candidate.disabled) continue
    const classification = classifyPaginationCandidate(candidate)
    if (classification.role !== PAGINATION_ROLE.NEXT) continue
    if (!best || confidenceRank[classification.confidence] > confidenceRank[bestClassification.confidence]) {
      best = candidate
      bestClassification = classification
    }
  }

  return { control: best, confidence: bestClassification.confidence, reason: bestClassification.reason }
}

/**
 * Whether auto-run should even ATTEMPT an automatic click for this
 * finding — 'high'/'medium' only. A 'low' (id/name substring alone) or
 * 'none' finding is never acted on automatically; the caller falls back
 * to the manual "ดำเนินการต่อ" prompt instead, per this codebase's
 * standing "never force automatic action when confidence is low" rule.
 */
export function isConfidentEnoughToAutoClick(confidence) {
  return confidence === 'high' || confidence === 'medium'
}

/**
 * item 3's full post-click verification, evaluated from a FRESH scan
 * taken after the click (never trusting the click alone). Every
 * condition must hold; the FIRST failing one is reported so the caller
 * always has one clear reason. `kind` distinguishes a genuine, confirmed
 * CONTEXT change (subject/classroom actually different — a real safety
 * concern, worth a hard stop) from mere inability to confirm the
 * navigation happened cleanly (page number/fingerprint/column —
 * recoverable by falling back to the manual continue prompt).
 *
 * @param {{
 *   expectedNextPage: number,
 *   actualPage: number|null,
 *   beforeFingerprint: string|null,
 *   afterFingerprint: string|null,
 *   columnStillFound: boolean,
 *   subjectOk: boolean,
 *   classroomOk: boolean,
 * }} input
 * @returns {{ok: boolean, reason: string|null, kind: 'confirmed'|'context_mismatch'|'advance_unconfirmed'}}
 */
export function verifyPageAdvance({ expectedNextPage, actualPage, beforeFingerprint, afterFingerprint, columnStillFound, subjectOk, classroomOk }) {
  if (!subjectOk) {
    return { ok: false, reason: 'รายวิชาบนหน้า SGS เปลี่ยนไปหลังเปลี่ยนหน้า — หยุดเพื่อความปลอดภัย', kind: 'context_mismatch' }
  }
  if (!classroomOk) {
    return { ok: false, reason: 'ห้องเรียนบนหน้า SGS เปลี่ยนไปหลังเปลี่ยนหน้า — หยุดเพื่อความปลอดภัย', kind: 'context_mismatch' }
  }
  if (actualPage !== expectedNextPage) {
    return { ok: false, reason: 'ไม่สามารถยืนยันว่าเปลี่ยนหน้าไปหน้าถัดไปได้อย่างถูกต้อง', kind: 'advance_unconfirmed' }
  }
  if (!columnStillFound) {
    return { ok: false, reason: 'ไม่พบคอลัมน์ที่เลือกไว้เป็นช่องกรอกได้จริงในหน้าใหม่', kind: 'advance_unconfirmed' }
  }
  if (beforeFingerprint === null || afterFingerprint === null || beforeFingerprint === afterFingerprint) {
    return { ok: false, reason: 'โครงสร้างตารางนักเรียนยังไม่เปลี่ยนแปลงหลังเปลี่ยนหน้า', kind: 'advance_unconfirmed' }
  }
  return { ok: true, reason: null, kind: 'confirmed' }
}

/** item 7: never attempts an advance once already on the last known
 * page — pure so this exact rule is unit-tested independent of any live
 * pagination read. */
export function shouldAttemptPageAdvance(pagination) {
  return Boolean(
    pagination &&
      pagination.detected &&
      pagination.currentPage !== null &&
      pagination.totalPages !== null &&
      pagination.currentPage < pagination.totalPages,
  )
}

/**
 * item 4/5: decides whether a stored, previously-active run should be
 * resumed after the popup reopens (a full ASP.NET postback can close or
 * reset the popup) — pure, given the stored state and a fresh scan of
 * whatever SGS page is now open. Deliberately conservative: resumes only
 * when the fresh page's own number matches EXACTLY what the stored run
 * expected next; anything else surfaces as a reason rather than a silent
 * guess (the teacher decides via the normal manual continue/abort UI).
 *
 * @param {{active: boolean, expectedNextPage: number|null, targetColumnKey: string|null} | null} storedState
 * @param {{gridFound: boolean, currentPage: number|null, columnKey: string|null}} freshScan
 */
export function evaluateRunResumption(storedState, freshScan) {
  if (!storedState || !storedState.active) {
    return { shouldResume: false, reason: 'ไม่พบการทำงานที่ค้างอยู่' }
  }
  if (!freshScan.gridFound) {
    return { shouldResume: false, reason: 'ไม่พบตารางคะแนนนักเรียนในหน้านี้' }
  }
  if (storedState.targetColumnKey !== freshScan.columnKey) {
    return { shouldResume: false, reason: 'ไม่พบคอลัมน์เดิมที่กำลังส่งอยู่ในหน้านี้' }
  }
  if (storedState.expectedNextPage !== null && freshScan.currentPage !== storedState.expectedNextPage) {
    return {
      shouldResume: false,
      reason: `หน้าปัจจุบัน (${freshScan.currentPage ?? 'ไม่ทราบ'}) ไม่ตรงกับหน้าที่คาดไว้ (${storedState.expectedNextPage})`,
    }
  }
  return { shouldResume: true, reason: null }
}
