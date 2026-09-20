/**
 * NEXT PHASE — safe fully-automatic multi-page run ("ส่งครบทั้งห้อง
 * อัตโนมัติ"). This module holds only the PURE decision logic auto-run
 * needs on top of whole-column-write.js's already-proven-live per-page
 * mechanics (computeWholeColumnPlan, buildWholeColumnWriteInstructions,
 * revalidateWholeColumnContext, locateColumnOnCurrentPage,
 * summarizeWholeColumnResult, collectFailedStudents — every one of those
 * is reused UNCHANGED here; this file never re-implements or modifies
 * them, so the already-shipped, already-live-tested single-page/
 * semi-automatic flow (sections 5-6) cannot regress).
 *
 * Auto-run is that SAME per-page engine driven in a loop by popup.js,
 * with three things layered on top:
 *   1. A page-advance attempt (pagination-control.js's
 *      findSgsNextPageControl/verifyPageAdvance, driving
 *      content-diagnostic.js's inspectPaginationControls/
 *      clickPaginationControl) — only clicked at 'high'/'medium'
 *      confidence, verified against a FRESH post-click scan, and never
 *      trusted from a click alone. A low-confidence or unconfirmed
 *      advance falls back to the SAME "ดำเนินการต่อ" semi-automatic
 *      continuation section 6 already has (item 11) — that fallback is
 *      handled directly in popup.js, NOT as one of the stop conditions
 *      below, since "couldn't confirm the page changed" is recoverable
 *      by the teacher's own click, not a reason to abort the whole run.
 *   2. evaluateAutoRunStopCondition below — checked before every page's
 *      write, aborting the ENTIRE run immediately (never a partial
 *      continue) on the first condition that fails. A CONFIRMED context
 *      mismatch after a page advance (verifyPageAdvance's own
 *      'context_mismatch' kind — the wrong subject/classroom, not just
 *      an unconfirmed page number) is surfaced through
 *      contextRevalidation here, since that IS a real safety concern.
 *   3. pageFailureExceedsThreshold — aborts mid-page once too many
 *      attempted writes fail to verify.
 */

import { WHOLE_COLUMN_STATUS, emptyWholeColumnSummary, mergeWholeColumnSummaries, summarizeWholeColumnResult } from './whole-column-write.js'

/** Never a percentage tuned for "usually fine" — a real classroom run
 * where more than 1-in-5 attempted writes on a single page fail to
 * verify is itself a sign something about the page/column state is
 * wrong, and continuing to more pages would only multiply whatever that
 * problem is. */
export const AUTO_RUN_FAILURE_THRESHOLD_RATIO = 0.2

/** @param {{written: number, failed: number}} pageSummary */
export function pageFailureExceedsThreshold(pageSummary, attemptedCount) {
  if (attemptedCount <= 0) return false
  return pageSummary.failed / attemptedCount > AUTO_RUN_FAILURE_THRESHOLD_RATIO
}

/**
 * item 5's "duplicate/ambiguous student mapping appears for a write
 * candidate" — only an AMBIGUOUS row that ALSO carries a real, in-range
 * KrunameClass score counts as a reason to abort the whole run. An
 * ambiguous student with no score to write was never going to be
 * written anyway (computeWholeColumnPlan never produces a write
 * instruction for a non-READY row), so it alone is not a safety issue —
 * it's simply reported in the ambiguous count, same as always.
 */
export function planHasAmbiguousWriteCandidate(plan) {
  return plan.some(
    (row) => row.status === WHOLE_COLUMN_STATUS.AMBIGUOUS && row.krunameScore !== null && row.krunameScore !== undefined,
  )
}

/**
 * BUG FIX — the real SGS page never renders a "1/4" or "page 1 of 4"
 * string anywhere; its current/total page numbers live in SEPARATE DOM
 * elements (an `<input>` for the current page, plain text "ของ 4" for
 * the total — see sgs-table-extraction.js's parseRealPaginationFragments
 * for the actual parsing fix). Before this fix, that meant
 * `pagination.currentPage`/`totalPages` silently stayed `null` forever on
 * the real page, and auto-run would still start and sit at "หน้า ? / ?"
 * with 0 students ever processed, never surfacing why. This is the
 * explicit, honest stop for that state — an unknown page is never a safe
 * default to guess forward from.
 */
export const PAGINATION_UNKNOWN_MESSAGE = 'ยังตรวจไม่พบตัวควบคุมหน้าของ SGS กรุณาตรวจสอบโครงสร้างหน้า'

/** @param {{detected: boolean, currentPage: number|null, totalPages: number|null}|null} pagination */
export function isPaginationReadyForAutoRun(pagination) {
  if (!pagination || !pagination.detected) return false
  if (pagination.currentPage === null || pagination.currentPage === undefined || pagination.currentPage < 1) return false
  if (pagination.totalPages === null || pagination.totalPages === undefined || pagination.totalPages < pagination.currentPage) return false
  return true
}

/**
 * The ONE gate checked before every page's write — the FIRST failing
 * condition stops the entire run immediately (item 5: never a batch of
 * reasons, never a partial continue). Page-advance failures are handled
 * separately in popup.js (falling back to manual continue, per item 11)
 * UNLESS verifyPageAdvance itself reports a CONFIRMED context mismatch,
 * in which case the caller passes that failure through
 * `contextRevalidation` here — a real subject/classroom change is a stop
 * condition, not a recoverable "couldn't confirm" case.
 *
 * @param {{
 *   gridFound: boolean,
 *   paginationReady: boolean,
 *   contextRevalidation: {ok: boolean, reason: string|null},
 *   columnWritableNow: boolean,
 *   headerCheckboxOk: boolean,
 *   hasAmbiguousWriteCandidate: boolean,
 * }} input
 */
export function evaluateAutoRunStopCondition({
  gridFound,
  paginationReady,
  contextRevalidation,
  columnWritableNow,
  headerCheckboxOk,
  hasAmbiguousWriteCandidate,
}) {
  if (!gridFound) {
    return { shouldStop: true, reason: 'ไม่พบตารางคะแนนนักเรียนในหน้านี้' }
  }
  if (!paginationReady) {
    return { shouldStop: true, reason: PAGINATION_UNKNOWN_MESSAGE }
  }
  if (!contextRevalidation.ok) {
    return { shouldStop: true, reason: contextRevalidation.reason }
  }
  if (!columnWritableNow) {
    return { shouldStop: true, reason: 'คอลัมน์ที่เลือกไม่สามารถกรอกได้จริงในขณะนี้' }
  }
  if (!headerCheckboxOk) {
    return { shouldStop: true, reason: 'ช่องคะแนนนี้ถูกปิดใช้งานใน SGS ตั้งแต่ตอนดูตัวอย่าง' }
  }
  if (hasAmbiguousWriteCandidate) {
    return { shouldStop: true, reason: 'พบนักเรียนที่จับคู่กำกวมซึ่งมีคะแนนที่จะเขียน — ต้องตรวจสอบด้วยตนเอง' }
  }
  return { shouldStop: false, reason: null }
}

/**
 * item 2's pre-run preview counts, computed ONCE from the first page's
 * plan plus the detected pagination — the teacher confirms this a
 * single time before the whole run starts, never re-derived per page.
 */
export function buildAutoRunPreRunSummary(plan, pagination, rosterCount) {
  return {
    rosterCount,
    toSend: plan.filter((row) => row.status === WHOLE_COLUMN_STATUS.READY).length,
    noScore: plan.filter((row) => row.status === WHOLE_COLUMN_STATUS.SKIP_NO_SCORE).length,
    existingToSkip: plan.filter((row) => row.status === WHOLE_COLUMN_STATUS.SKIP_EXISTING).length,
    sgsTotalPages: pagination && pagination.detected ? pagination.totalPages : null,
    sgsTotalStudents: pagination ? pagination.totalStudentRows : null,
  }
}

/** Auto-run's own running/final summary — the same six buckets
 * summarizeWholeColumnResult already produces, PLUS invalidScore (item
 * 9's "คะแนนไม่ถูกต้อง"). A kept-separate wrapper rather than a change to
 * whole-column-write.js itself, so the already-shipped, already-live-
 * tested section 5/6 summary shape and tests are never touched by this
 * phase. */
export function summarizeAutoRunPageResult(verifiedPlan) {
  const base = summarizeWholeColumnResult(verifiedPlan)
  return { ...base, invalidScore: verifiedPlan.filter((row) => row.status === WHOLE_COLUMN_STATUS.INVALID_SCORE).length }
}

export function emptyAutoRunSummary() {
  return { ...emptyWholeColumnSummary(), invalidScore: 0 }
}

export function mergeAutoRunSummaries(a, b) {
  return { ...mergeWholeColumnSummaries(a, b), invalidScore: a.invalidScore + b.invalidScore }
}

/** How many rows on ONE page's plan were actually attempted (READY) —
 * the denominator for pageFailureExceedsThreshold. */
export function countReadyRows(plan) {
  return plan.filter((row) => row.status === WHOLE_COLUMN_STATUS.READY).length
}

/**
 * item 9's downloadable/copyable run report — EXACTLY the fields listed
 * there (timestamp, subject, classroom, selected SGS column, per-student
 * result status) and explicitly never anything else: no credential, no
 * session token, no cookie, no studentId (an internal database id, never
 * needed for a teacher-facing report), nothing this popup doesn't
 * already show on screen elsewhere.
 */
export function buildAutoRunReport({ subjectName, classroomName, columnLabel, pagesProcessed, perStudentResults }) {
  return {
    timestamp: new Date().toISOString(),
    subject: subjectName,
    classroom: classroomName,
    sgsColumn: columnLabel,
    pagesProcessed,
    students: perStudentResults.map((row) => ({
      studentNumber: row.studentNumber,
      fullName: row.fullName,
      status: row.status,
      writeOutcome: row.writeOutcome ?? null,
    })),
  }
}
