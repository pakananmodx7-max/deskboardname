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

/**
 * FINAL PAGINATION FIX — the CONFIRMED, live-observed id suffix
 * convention for this exact SGS deployment's pager controls (an
 * ASP.NET WebForms templated pager, e.g.
 * `ctl00_PageContent_TblTranscriptsPagination__FirstPage` /
 * `...__PreviousPage`) — never a generic "id contains next/last"
 * substring guess (that weaker rule stays below, at 'low' confidence,
 * for anything that doesn't match this exact suffix). Checked FIRST and
 * at 'high' confidence: this is the ONE signal actually confirmed live
 * against this deployment, more certain here than the older
 * NextPreviousPagerField `Page$Next` postback convention below (which
 * has never been independently confirmed against this specific
 * deployment).
 */
export const ASPNET_PAGER_ID_SUFFIXES = {
  FIRST: 'FirstPage',
  PREV: 'PreviousPage',
  NEXT: 'NextPage',
  LAST: 'LastPage',
}

const ASPNET_PAGER_SUFFIX_LIST = [
  { role: PAGINATION_ROLE.FIRST, suffix: ASPNET_PAGER_ID_SUFFIXES.FIRST },
  { role: PAGINATION_ROLE.PREV, suffix: ASPNET_PAGER_ID_SUFFIXES.PREV },
  { role: PAGINATION_ROLE.NEXT, suffix: ASPNET_PAGER_ID_SUFFIXES.NEXT },
  { role: PAGINATION_ROLE.LAST, suffix: ASPNET_PAGER_ID_SUFFIXES.LAST },
]

function idEndsWithSuffix(id, suffix) {
  return typeof id === 'string' && id.length >= suffix.length && id.toLowerCase().endsWith(suffix.toLowerCase())
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
  for (const { role, suffix } of ASPNET_PAGER_SUFFIX_LIST) {
    if (idEndsWithSuffix(candidate.id, suffix)) {
      return { role, confidence: 'high', reason: `id ends with the confirmed ASP.NET pager control suffix "${suffix}"` }
    }
  }

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
 * FINAL PAGINATION FIX — classifies EVERY candidate into all four roles
 * at once (not just NEXT — see findSgsNextPageControl above for that
 * narrower, unchanged helper), each with its own best-confidence match.
 * This is what the live diagnostic report ("ตรวจปุ่มเปลี่ยนหน้า SGS") and
 * the sibling-id derivation below both build on.
 */
export function identifyPaginationControlSet(candidates) {
  const confidenceRank = { high: 3, medium: 2, low: 1, none: 0 }
  const roleKey = { FIRST: 'first', PREV: 'previous', NEXT: 'next', LAST: 'last' }
  const result = { first: null, previous: null, next: null, last: null }

  for (const candidate of candidates ?? []) {
    if (candidate.disabled) continue
    const classification = classifyPaginationCandidate(candidate)
    const key = roleKey[classification.role]
    if (!key) continue
    if (!result[key] || confidenceRank[classification.confidence] > confidenceRank[result[key].confidence]) {
      result[key] = { control: candidate, confidence: classification.confidence, reason: classification.reason }
    }
  }

  return result
}

/**
 * FINAL PAGINATION FIX — "search the same DOM namespace": given ANY one
 * confirmed pager control id (e.g. the live-confirmed
 * `ctl00_PageContent_TblTranscriptsPagination__FirstPage`), derives the
 * other three roles' expected ids by substituting the SAME known suffix
 * — a literal, deterministic string operation, never a guess. The
 * caller (content-diagnostic.js) is what actually looks these up via
 * `document.getElementById`, since this module has no DOM access; this
 * is only the pure id-string derivation, so it's unit-testable without a
 * browser.
 *
 * @returns {{first: string, previous: string, next: string, last: string}|null} null when `id` doesn't end with any known suffix at all
 */
export function computeSiblingPagerIds(id) {
  if (typeof id !== 'string' || id.length === 0) return null
  for (const { suffix } of ASPNET_PAGER_SUFFIX_LIST) {
    if (idEndsWithSuffix(id, suffix)) {
      const prefix = id.slice(0, id.length - suffix.length)
      return {
        first: prefix + ASPNET_PAGER_ID_SUFFIXES.FIRST,
        previous: prefix + ASPNET_PAGER_ID_SUFFIXES.PREV,
        next: prefix + ASPNET_PAGER_ID_SUFFIXES.NEXT,
        last: prefix + ASPNET_PAGER_ID_SUFFIXES.LAST,
      }
    }
  }
  return null
}

/**
 * FINAL PAGINATION FIX — turns content-diagnostic.js's
 * inspectPaginationControls() result into the exact `hints` shape
 * detectPagination/detectPaginationFromHints (sgs-table-extraction.js)
 * already expect: `{currentPage, totalPages, totalStudentRows,
 * pageSize}`. Never guesses a value from another — a field this
 * inspection couldn't confidently read (e.g. an ambiguous or missing
 * current-page input) stays honestly `null`, which is exactly what makes
 * `detectPaginationFromHints` correctly report `detected: false` for it.
 */
export function buildPaginationHintsFromInspection(inspection) {
  const toNumber = (raw) => {
    if (raw === null || raw === undefined || raw === '') return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (!inspection) return { currentPage: null, totalPages: null, totalStudentRows: null, pageSize: null }
  return {
    currentPage: toNumber(inspection.currentPageValue),
    totalPages: toNumber(inspection.totalPagesText),
    totalStudentRows: toNumber(inspection.totalRowsText),
    pageSize: toNumber(inspection.pageSizeValue),
  }
}

/**
 * The exact live diagnostic report shape item 2 of this fix requires —
 * rendered by the new "ตรวจปุ่มเปลี่ยนหน้า SGS" button so a teacher (or a
 * developer) can see precisely what this extension currently detects,
 * never a black box. `controls.*` reports the matched element's id when
 * it has one (the far more useful, stable identity for a human reading
 * this report), or a short human description when it doesn't.
 */
export function buildPaginationDiagnosticReport(inspection) {
  const hints = buildPaginationHintsFromInspection(inspection)
  const controlSet = identifyPaginationControlSet(inspection?.candidates ?? [])
  const describeControl = (entry) => {
    if (!entry) return null
    return entry.control.id || `(${entry.control.tag}, no id: "${entry.control.text || entry.control.value || ''}")`
  }
  return {
    currentPage: hints.currentPage,
    totalPages: hints.totalPages,
    totalRows: hints.totalStudentRows,
    pageSize: hints.pageSize,
    controls: {
      first: describeControl(controlSet.first),
      previous: describeControl(controlSet.previous),
      next: describeControl(controlSet.next),
      last: describeControl(controlSet.last),
    },
  }
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
