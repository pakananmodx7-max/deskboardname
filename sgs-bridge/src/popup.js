import {
  buildSgsColumnWriteInstructions,
  computeSgsColumnFillPlan,
  formatSgsExistingScoreDisplay,
  formatSgsNewValueDisplay,
} from './lib/column-fill.js'
import {
  collectAllTableRowFacts,
  collectRawSgsFacts,
  fillSgsColumnValues,
  readColumnValues,
  readSingleCellRevalidationState,
} from './content-diagnostic.js'
import {
  buildCompactStudentGridReport,
  buildDiagnosticReport,
  buildStudentGridDebugReport,
  formatDiagnosticReportForCopy,
} from './lib/diagnostic-report.js'
import { matchStudentsToSgs, normalizeStudentCode, normalizeThaiFullName } from './lib/mapping.js'
import { validateAnySgsBridgePayload } from './lib/payload-validation.js'
import {
  computeSgsRealFillPlan,
  formatSgsExistingScoreDisplay as formatRealExistingScoreDisplay,
  formatSgsNewValueDisplay as formatRealNewValueDisplay,
} from './lib/sgs-real-fill.js'
// Item 5's "ทดสอบ 1 คน" (test one student) plan builder plus the
// CONTROLLED LIVE TEST gate functions — see single-cell-test.js's own
// doc comment for the full precondition list and why the write button
// only ever enables once every one of them holds.
import {
  buildSingleCellTestPlan,
  canEnableSingleCellTestWrite,
  evaluateSingleCellTestPreconditions,
  formatSingleCellTestSummary,
  revalidateSingleCellTestContext,
} from './lib/single-cell-test.js'
import {
  buildGridWarnings,
  buildSgsRowKey,
  computeGridConfidence,
  detectPagination,
  extractSgsStudentCandidates,
  matchTargetColumnToRealColumns,
  pickBestStudentGridCandidate,
  sgsRowIndexFromKey,
} from './lib/sgs-table-extraction.js'
import { describeMatchVerdict, evaluateSubjectClassroomMatch } from './lib/subject-classroom-match.js'
import { buildFullRosterFromPayload } from './lib/roster.js'
// NEXT PHASE — whole-column writing, now that the guarded single-cell
// test has passed live. See whole-column-write.js's own doc comment for
// the full architecture (structural single-column guarantee,
// pagination-safe re-scan per page, stale-DOM abort).
import {
  buildWholeColumnWriteInstructions,
  canEnableWholeColumnWrite,
  collectFailedStudents,
  computeWholeColumnPlan,
  emptyWholeColumnSummary,
  evaluateWholeColumnPreconditions,
  formatSgsExistingScoreDisplay as formatWcExistingScoreDisplay,
  formatSgsNewValueDisplay as formatWcNewValueDisplay,
  locateColumnOnCurrentPage,
  mergeWholeColumnSummaries,
  revalidateWholeColumnContext,
  summarizeWholeColumnResult,
  verifyWholeColumnWrite,
} from './lib/whole-column-write.js'
// TRUE unattended auto-run — orchestration itself now lives in
// background.js/content-script.js (see run-orchestrator.js's own doc
// comment); popup.js only ever previews the pre-run counts (still a pure
// local scan/plan, using the SAME buildAutoRunPreRunSummary as before)
// and renders whatever state background.js reports, so only these two
// display-facing helpers are still needed here.
import { buildAutoRunPreRunSummary, buildAutoRunReport, emptyAutoRunSummary, isPaginationReadyForAutoRun, PAGINATION_UNKNOWN_MESSAGE } from './lib/auto-run.js'
import { AR_MESSAGE } from './lib/run-orchestrator.js'

const DEFAULT_SGS_KEYWORD = 'sgs'
const SESSION_PAYLOAD_KEY = 'sgsBridgeLoadedPayload'

const OVERWRITE_MODE_LABEL = {
  skip_existing: 'ข้ามคะแนนที่มีอยู่แล้ว',
  overwrite_selected_column: 'เขียนทับเฉพาะช่องที่เลือก',
}

/**
 * Used ONLY for the payload-only preview rendered the moment a bridge
 * payload is loaded (renderPreview, below) — before the teacher has run
 * "ตรวจสอบตารางคะแนน SGS จริง" (section 4) against an actual open SGS
 * tab, there is no live page to read an existing value from, exactly
 * like sgs-export-dialog.tsx's own KrunameClass-side preview. Once a
 * real inspection runs, runColumnPreview() below computes a REAL plan
 * (computeSgsRealFillPlan, with real existing values) instead — this
 * constant is never involved in that path.
 */
const NO_KNOWN_EXISTING_SCORES = {}

/** @type {import('./lib/payload-validation.js').SgsBridgePayload | null} */
let loadedPayload = null

const statusEl = document.getElementById('status')
const fileInput = document.getElementById('payload-file')
const payloadErrorEl = document.getElementById('payload-error')
const previewEl = document.getElementById('preview')
const previewTableBody = document.getElementById('preview-table-body')
const mappingBtn = document.getElementById('mapping-dry-run')
const mappingCheckErrorEl = document.getElementById('mapping-check-error')
const mappingResultTable = document.getElementById('mapping-result')
const mappingResultBody = document.getElementById('mapping-result-body')
const mappingDebugEl = document.getElementById('mapping-debug')
const diagnosticBtn = document.getElementById('diagnostic-run')
const diagnosticDebugBtn = document.getElementById('diagnostic-debug-run')
const diagnosticVerboseBtn = document.getElementById('diagnostic-verbose-run')
const diagnosticOutput = document.getElementById('diagnostic-output')
const copyDiagnosticBtn = document.getElementById('copy-diagnostic')

const inspectBtn = document.getElementById('inspect-run')
const realInspectErrorEl = document.getElementById('real-inspect-error')
const realTargetLabelEl = document.getElementById('real-target-label')
const realColumnPickerWrap = document.getElementById('real-column-picker-wrap')
const realColumnPickerEl = document.getElementById('real-column-picker')
const realColumnMatchWarningEl = document.getElementById('real-column-match-warning')
const realActivatableColumnsWrap = document.getElementById('real-activatable-columns-wrap')
const realActivatableColumnsEl = document.getElementById('real-activatable-columns')
const realRescanBtn = document.getElementById('real-rescan-btn')
const realDerivedColumnsWrap = document.getElementById('real-derived-columns-wrap')
const realDerivedColumnsEl = document.getElementById('real-derived-columns')
const realFillPreviewWrap = document.getElementById('real-fill-preview-wrap')
const realFillPreviewBody = document.getElementById('real-fill-preview-body')

// Item 5's single-cell test — CONTROLLED LIVE TEST: sctWriteBtn/sctConfirm
// are wired up (see updateSingleCellTestGate/runSingleCellTestWrite below),
// but the write button only ever enables once evaluateSingleCellTestPreconditions
// passes AND the teacher's own consent checkbox is checked — see
// single-cell-test.js's module doc comment for the full precondition list.
const singleCellTestWrap = document.getElementById('single-cell-test-wrap')
const sctStudentSelect = document.getElementById('sct-student')
const sctColumnSelect = document.getElementById('sct-column')
const sctPreviewBtn = document.getElementById('sct-preview-btn')
const sctPreviewEl = document.getElementById('sct-preview')
const sctStudentNameEl = document.getElementById('sct-student-name')
const sctStudentNumberEl = document.getElementById('sct-student-number')
const sctStudentCodeEl = document.getElementById('sct-student-code')
const sctColumnLabelEl = document.getElementById('sct-column-label')
const sctCurrentValueEl = document.getElementById('sct-current-value')
const sctNewValueEl = document.getElementById('sct-new-value')
const sctSubjectClassroomCheckEl = document.getElementById('sct-subject-classroom-check')
const sctCheckSubjectKrunameEl = document.getElementById('sct-check-subject-kruname')
const sctCheckSubjectSgsEl = document.getElementById('sct-check-subject-sgs')
const sctCheckSubjectResultEl = document.getElementById('sct-check-subject-result')
const sctCheckClassroomKrunameEl = document.getElementById('sct-check-classroom-kruname')
const sctCheckClassroomSgsEl = document.getElementById('sct-check-classroom-sgs')
const sctCheckClassroomResultEl = document.getElementById('sct-check-classroom-result')
const sctGateReasonEl = document.getElementById('sct-gate-reason')
const sctWriteWarningEl = document.getElementById('sct-write-warning')
const sctConfirmCheckbox = document.getElementById('sct-confirm')
const sctWriteBtn = document.getElementById('sct-write-btn')
const sctResultEl = document.getElementById('sct-result')
const sctResultStudentEl = document.getElementById('sct-result-student')
const sctResultColumnEl = document.getElementById('sct-result-column')
const sctResultPreviousEl = document.getElementById('sct-result-previous')
const sctResultNewEl = document.getElementById('sct-result-new')
const sctResultStatusEl = document.getElementById('sct-result-status')

// NEXT PHASE — whole-column writing (item 1-6 of the spec). Same
// "confirm precondition -> explicit consent checkbox -> write button"
// shape as the single-cell test above, one level up (a whole PAGE's
// worth of matched students, one column, never more).
const wholeColumnWrap = document.getElementById('whole-column-wrap')
const wcStartBtn = document.getElementById('wc-start-btn')
const wcPreviewEl = document.getElementById('wc-preview')
const wcPreviewSubjectEl = document.getElementById('wc-preview-subject')
const wcPreviewClassroomEl = document.getElementById('wc-preview-classroom')
const wcPreviewColumnEl = document.getElementById('wc-preview-column')
const wcPreviewMaxScoreEl = document.getElementById('wc-preview-maxscore')
const wcSubjectClassroomCheckEl = document.getElementById('wc-subject-classroom-check')
const wcCheckSubjectKrunameEl = document.getElementById('wc-check-subject-kruname')
const wcCheckSubjectSgsEl = document.getElementById('wc-check-subject-sgs')
const wcCheckSubjectResultEl = document.getElementById('wc-check-subject-result')
const wcCheckClassroomKrunameEl = document.getElementById('wc-check-classroom-kruname')
const wcCheckClassroomSgsEl = document.getElementById('wc-check-classroom-sgs')
const wcCheckClassroomResultEl = document.getElementById('wc-check-classroom-result')
const wcPreviewTableBody = document.getElementById('wc-preview-table-body')
const wcOverwriteCheckbox = document.getElementById('wc-overwrite-existing')
const wcGateReasonEl = document.getElementById('wc-gate-reason')
const wcWriteWarningEl = document.getElementById('wc-write-warning')
const wcConfirmCheckbox = document.getElementById('wc-confirm')
const wcWriteBtn = document.getElementById('wc-write-btn')
const wcPaginationContinueWrap = document.getElementById('wc-pagination-continue')
const wcPaginationMessageEl = document.getElementById('wc-pagination-message')
const wcContinueBtn = document.getElementById('wc-continue-btn')
const wcResultEl = document.getElementById('wc-result')
const wcResultWrittenEl = document.getElementById('wc-result-written')
const wcResultSkipNoScoreEl = document.getElementById('wc-result-skip-no-score')
const wcResultSkipExistingEl = document.getElementById('wc-result-skip-existing')
const wcResultNotFoundEl = document.getElementById('wc-result-not-found')
const wcResultAmbiguousEl = document.getElementById('wc-result-ambiguous')
const wcResultFailedEl = document.getElementById('wc-result-failed')
const wcFailedListEl = document.getElementById('wc-failed-list')

// NEXT PHASE — section 7, safe fully-automatic multi-page run.
const autoRunWrap = document.getElementById('auto-run-wrap')
const arStartBtn = document.getElementById('ar-start-btn')
const arPrerunEl = document.getElementById('ar-prerun')
const arSubjectEl = document.getElementById('ar-subject')
const arClassroomEl = document.getElementById('ar-classroom')
const arColumnEl = document.getElementById('ar-column')
const arMaxScoreEl = document.getElementById('ar-maxscore')
const arRosterCountEl = document.getElementById('ar-roster-count')
const arToSendEl = document.getElementById('ar-to-send')
const arNoScoreEl = document.getElementById('ar-no-score')
const arExistingSkipEl = document.getElementById('ar-existing-skip')
const arTotalPagesEl = document.getElementById('ar-total-pages')
const arTotalSgsStudentsEl = document.getElementById('ar-total-sgs-students')
const arOverwriteCheckbox = document.getElementById('ar-overwrite-existing')
const arConfirmSubjectClassroomCheckbox = document.getElementById('ar-confirm-subject-classroom')
const arConfirmAutosaveCheckbox = document.getElementById('ar-confirm-autosave')
const arRunBtn = document.getElementById('ar-run-btn')
const arProgressEl = document.getElementById('ar-progress')
const arProgressPageEl = document.getElementById('ar-progress-page')
const arProgressStudentsEl = document.getElementById('ar-progress-students')
const arProgressWrittenEl = document.getElementById('ar-progress-written')
const arProgressSkipNoScoreEl = document.getElementById('ar-progress-skip-no-score')
const arProgressSkipExistingEl = document.getElementById('ar-progress-skip-existing')
const arProgressNotFoundEl = document.getElementById('ar-progress-not-found')
const arProgressAmbiguousEl = document.getElementById('ar-progress-ambiguous')
const arProgressFailedEl = document.getElementById('ar-progress-failed')
const arStopBtn = document.getElementById('ar-stop-btn')
const arManualContinueWrap = document.getElementById('ar-manual-continue')
const arManualContinueMessageEl = document.getElementById('ar-manual-continue-message')
const arManualContinueBtn = document.getElementById('ar-manual-continue-btn')
const arAbortReasonEl = document.getElementById('ar-abort-reason')
const arFinalSummaryEl = document.getElementById('ar-final-summary')
const arFinalTotalEl = document.getElementById('ar-final-total')
const arFinalWrittenEl = document.getElementById('ar-final-written')
const arFinalSkipNoScoreEl = document.getElementById('ar-final-skip-no-score')
const arFinalSkipExistingEl = document.getElementById('ar-final-skip-existing')
const arFinalInvalidEl = document.getElementById('ar-final-invalid')
const arFinalNotFoundEl = document.getElementById('ar-final-not-found')
const arFinalAmbiguousEl = document.getElementById('ar-final-ambiguous')
const arFinalFailedEl = document.getElementById('ar-final-failed')
const arFinalPagesEl = document.getElementById('ar-final-pages')
const arCopyReportBtn = document.getElementById('ar-copy-report-btn')
const arReportOutput = document.getElementById('ar-report-output')

/** The exact context the teacher's last successful single-cell preview
 * confirmed — captured by runSingleCellTestPreview(), consumed by
 * runSingleCellTestWrite() as the "known good" side of
 * revalidateSingleCellTestContext's stale-DOM comparison. Cleared
 * whenever the student/column selection changes (see the change
 * listeners below) so a write can never be confirmed against a preview
 * that no longer matches the teacher's current selection. */
let confirmedSingleCellContext = null

/** The raw facts collectAllTableRowFacts returned for the CURRENT
 * inspection — kept only so runColumnPreview() can read row text
 * (เลขที่/รหัสนักเรียน/ชื่อ-นามสกุล) without a second DOM round-trip. */
let currentGridFacts = null
/** The winning table+run+columns pickBestStudentGridCandidate chose —
 * {tableIndex, run: {startIndex, length}, identifierColumns,
 * scoreColumns, ...}. Every real DOM read/write this popup can ever
 * trigger is scoped to THIS table and row range. */
let currentGridCandidate = null
/** The ONE real SGS column the teacher has confirmed — {columnIndex,
 * key, label, maxScore}. Every real write this popup can ever trigger
 * is scoped to this single value. */
let confirmedRealColumn = null
/** The plan computeSgsRealFillPlan produced for confirmedRealColumn —
 * consumed by renderRealFillPreview() and to populate the single-cell
 * test student picker. Never fed to a bulk DOM write (see item 4/5). */
let realPlan = null
/** detectPagination's result for the CURRENT inspection — {detected,
 * currentPage, totalPages, visibleStudentRows, totalStudentRows}. Never
 * used to auto-navigate anything; only to (a) tell a genuinely-missing
 * student apart from one who's simply on a different SGS page (see
 * describeMappingStatusForDisplay) and (b) gate the single-cell test to
 * students visible on the CURRENT page only. */
let currentPagination = null

// NEXT PHASE — whole-column writing state. `wcConfirmedColumnKey` is
// locked in the moment the teacher clicks "ส่งคอลัมน์นี้ทั้งห้อง" and
// reused (via locateColumnOnCurrentPage) across every subsequent SGS
// page/"ดำเนินการต่อ" click, since a column's raw INDEX can differ page
// to page even for the exact same real column — the KEY never does.
let wcConfirmedColumnKey = null
/** The CURRENT page's scan results this session's preview/write is
 * scoped to — {candidate, column, existingScoresBySgsRowKey}. Rebuilt by
 * scanCurrentSgsPageForWholeColumn() on every "ส่งคอลัมน์นี้ทั้งห้อง" /
 * "ดำเนินการต่อ" click; never carried over from a previous page. */
let wcPageScan = null
/** The exact context confirmed once every whole-column precondition
 * passes for the CURRENT page — consumed by runWholeColumnWrite() as the
 * "known good" side of revalidateWholeColumnContext's stale-DOM
 * comparison, exactly one level up from confirmedSingleCellContext. */
let wcConfirmedContext = null
/** Running totals across every SGS page processed so far THIS session
 * (reset only when "ส่งคอลัมน์นี้ทั้งห้อง" starts a brand new session,
 * never by "ดำเนินการต่อ") — see mergeWholeColumnSummaries. */
let wcCumulativeSummary = emptyWholeColumnSummary()
let wcCumulativeFailedStudents = []

// TRUE unattended auto-run — section 7 popup-side state. Orchestration
// itself (the loop, the per-page safety checks, the write+verify, the
// page-advance) now lives entirely in background.js/content-script.js;
// popup.js keeps only what its own reduced role (item 3: preview,
// confirmation, progress viewer, Stop control) needs.
let arConfirmedColumnKey = null

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

/**
 * The SGS page keyword is a teacher-configurable setting (options.html),
 * never a hardcoded domain — Phase 5 hasn't confirmed the real SGS
 * URL/DOM yet, so this stays a simple, honest heuristic (does the tab's
 * URL or title contain this keyword) rather than an invented selector
 * or domain match.
 */
async function getSgsKeyword() {
  const { sgsKeyword } = await chrome.storage.local.get('sgsKeyword')
  return (sgsKeyword || DEFAULT_SGS_KEYWORD).toLowerCase()
}

async function refreshStatus() {
  const tab = await getActiveTab()
  const keyword = await getSgsKeyword()
  const haystack = `${tab?.url ?? ''} ${tab?.title ?? ''}`.toLowerCase()
  const isSgsPage = haystack.includes(keyword)
  statusEl.textContent = isSgsPage ? 'พบหน้า SGS' : 'กรุณาเปิดหน้า SGS'
  statusEl.dataset.state = isSgsPage ? 'ok' : 'warn'
}

/**
 * Two payload FAMILIES can reach this popup — the original
 * assignment-scoped one (no `kind` field, implicitly 'assignment') and
 * the newer, completely independent "คะแนน SGS" workspace payload
 * (`kind: 'sgs_score_workspace'`, see src/types/sgs-score-workspace.ts).
 * Normalizing both into this one internal shape right after validation
 * is what lets every other function in this file (renderPreview,
 * runRealColumnInspection, runColumnPreview, ...) stay completely
 * unaware of which family a given file came from — they only ever read
 * subjectName/classroomName/targetColumn/overwriteMode/students/
 * skippedStudentIds, never the raw file's own field names.
 * `assignmentTitle: null` and `overwriteMode: 'skip_existing'` are the
 * new family's honest defaults: it has no assignment concept, and no
 * existing-SGS-value source at payload-build time (see
 * sgs-score-workspace-service.ts's own doc comment) — 'skip_existing'
 * only affects the informational preview's action bucketing here, never
 * a real write (bulk write was removed entirely — see item 4 of the
 * live-discovery redesign).
 */
function normalizeLoadedPayload(raw) {
  if (raw.kind === 'sgs_score_workspace') {
    return {
      kind: 'sgs_score_workspace',
      subjectName: raw.subject.name,
      classroomName: raw.classroom.name,
      assignmentTitle: null,
      targetColumn: raw.targetColumn,
      overwriteMode: 'skip_existing',
      students: raw.students,
      skippedStudentIds: raw.skippedStudentIds,
    }
  }
  return {
    kind: 'assignment',
    subjectName: raw.subjectName,
    classroomName: raw.classroomName,
    assignmentTitle: raw.assignmentTitle,
    targetColumn: raw.targetColumn,
    overwriteMode: raw.overwriteMode,
    students: raw.students,
    skippedStudentIds: raw.skippedStudentIds,
  }
}

function renderPreview(payload) {
  document.getElementById('preview-subject').textContent = payload.subjectName
  document.getElementById('preview-classroom').textContent = payload.classroomName
  document.getElementById('preview-assignment').textContent = payload.assignmentTitle ?? 'ไม่มี (คะแนน SGS โดยตรง)'
  document.getElementById('preview-target-column').textContent = payload.targetColumn.label
  document.getElementById('preview-target-column-inline').textContent = payload.targetColumn.label
  document.getElementById('preview-max-score').textContent = String(payload.targetColumn.maxScore)
  document.getElementById('preview-overwrite-mode').textContent =
    OVERWRITE_MODE_LABEL[payload.overwriteMode] ?? payload.overwriteMode
  document.getElementById('preview-count').textContent = String(payload.students.length)

  const rows = buildFullRosterFromPayload(payload)

  // The column-fill plan/instructions below are ALWAYS scoped to
  // payload.targetColumn.key — the one column the teacher picked in
  // KrunameClass. This popup never asks for, and never could produce,
  // an instruction for a different column.
  const plan = computeSgsColumnFillPlan(rows, NO_KNOWN_EXISTING_SCORES, payload.overwriteMode)
  // Computed here only to keep the plan/instructions pipeline exercised
  // end-to-end in this dry-run phase — never handed to any DOM-writing
  // code yet.
  buildSgsColumnWriteInstructions(plan, payload.targetColumn.key)

  previewTableBody.replaceChildren(
    ...plan.map((row) => {
      const tr = document.createElement('tr')
      const tdNumber = document.createElement('td')
      tdNumber.textContent = row.studentNumber === null ? '-' : String(row.studentNumber)
      const tdName = document.createElement('td')
      tdName.textContent = row.fullName
      const tdKruname = document.createElement('td')
      tdKruname.textContent = row.krunameScore === null ? '—' : String(row.krunameScore)
      const tdExisting = document.createElement('td')
      tdExisting.textContent = formatSgsExistingScoreDisplay(row.sgsExistingScore)
      const tdNew = document.createElement('td')
      tdNew.textContent = formatSgsNewValueDisplay(row)
      tr.append(tdNumber, tdName, tdKruname, tdExisting, tdNew)
      return tr
    }),
  )

  previewEl.hidden = false
  mappingBtn.disabled = false
  mappingResultTable.hidden = true
  mappingCheckErrorEl.hidden = true
  mappingDebugEl.hidden = true
}

function resetRealInspectionState() {
  currentGridFacts = null
  currentGridCandidate = null
  confirmedRealColumn = null
  realPlan = null
  currentPagination = null
  realColumnPickerWrap.hidden = true
  realColumnPickerEl.replaceChildren()
  realColumnMatchWarningEl.hidden = true
  realActivatableColumnsWrap.hidden = true
  realActivatableColumnsEl.replaceChildren()
  realDerivedColumnsWrap.hidden = true
  realDerivedColumnsEl.replaceChildren()
  realFillPreviewWrap.hidden = true
  realFillPreviewBody.replaceChildren()
  resetSingleCellTestState()
  resetWholeColumnState()
  resetAutoRunState()
}

/** Returns every whole-column UI element to its safe default and clears
 * ALL in-progress state, including the cumulative cross-page summary —
 * called on every fresh step-4 inspection (a rescan invalidates an
 * in-progress whole-column session) and once at load. Never called by
 * "ดำเนินการต่อ" itself, since that must preserve the running total. */
function resetWholeColumnState() {
  wcConfirmedColumnKey = null
  wcPageScan = null
  wcConfirmedContext = null
  wcCumulativeSummary = emptyWholeColumnSummary()
  wcCumulativeFailedStudents = []
  wholeColumnWrap.hidden = true
  wcPreviewEl.hidden = true
  wcPreviewTableBody.replaceChildren()
  wcSubjectClassroomCheckEl.hidden = true
  wcOverwriteCheckbox.checked = false
  wcGateReasonEl.hidden = true
  wcWriteWarningEl.hidden = true
  wcConfirmCheckbox.checked = false
  wcConfirmCheckbox.disabled = true
  wcWriteBtn.disabled = true
  wcPaginationContinueWrap.hidden = true
  wcResultEl.hidden = true
  wcFailedListEl.hidden = true
  wcFailedListEl.replaceChildren()
}

/**
 * Same reset contract as resetWholeColumnState, one level up. If an
 * auto-run happens to be active in background.js when this fires (a
 * fresh step-4 rescan while content-script.js's pipeline is mid-flight),
 * sending AR_STOP means its own next check-point (before its next write
 * or page advance — see content-script.js's own doc comment) stops it
 * cleanly, rather than it silently continuing against a page this popup
 * no longer vouches for.
 */
function resetAutoRunState() {
  arConfirmedColumnKey = null
  void chrome.runtime.sendMessage({ type: AR_MESSAGE.STOP }).catch(() => {})
  autoRunWrap.hidden = true
  arPrerunEl.hidden = true
  arOverwriteCheckbox.checked = false
  arConfirmSubjectClassroomCheckbox.checked = false
  arConfirmAutosaveCheckbox.checked = false
  arRunBtn.disabled = true
  arProgressEl.hidden = true
  arManualContinueWrap.hidden = true
  arAbortReasonEl.hidden = true
  arFinalSummaryEl.hidden = true
  arReportOutput.value = ''
}

/**
 * Item 5, kept hidden until a writable-column preview exists to populate
 * it from. Always returns sctConfirmCheckbox/sctWriteBtn to their SAFE
 * default (disabled, unchecked) — this is the one function every path
 * that invalidates the current single-cell context (a fresh inspection,
 * a changed student/column selection, a completed write) calls, so
 * there is exactly one place that ever re-arms them to "not yet safe."
 */
function resetSingleCellTestState() {
  singleCellTestWrap.hidden = true
  sctStudentSelect.replaceChildren()
  sctColumnSelect.replaceChildren()
  sctPreviewEl.hidden = true
  sctSubjectClassroomCheckEl.hidden = true
  sctGateReasonEl.hidden = true
  sctWriteWarningEl.hidden = true
  sctResultEl.hidden = true
  confirmedSingleCellContext = null
  sctConfirmCheckbox.checked = false
  sctConfirmCheckbox.disabled = true
  sctWriteBtn.disabled = true
}

async function loadPayloadFromFile(file) {
  payloadErrorEl.hidden = true
  previewEl.hidden = true
  loadedPayload = null
  mappingBtn.disabled = true
  mappingResultTable.hidden = true
  mappingCheckErrorEl.hidden = true
  mappingDebugEl.hidden = true
  resetRealInspectionState()

  let parsed
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    payloadErrorEl.textContent = 'ไฟล์นี้ไม่ใช่ JSON ที่ถูกต้อง'
    payloadErrorEl.hidden = false
    return
  }

  const { validation } = validateAnySgsBridgePayload(parsed)
  if (!validation.ok) {
    payloadErrorEl.textContent = `ไฟล์ไม่ผ่านการตรวจสอบ: ${validation.errors.join(', ')}`
    payloadErrorEl.hidden = false
    return
  }

  loadedPayload = normalizeLoadedPayload(parsed)
  renderPreview(loadedPayload)
  // Session storage only — cleared when the browser closes, never
  // synced, never contains a credential (validateAnySgsBridgePayload
  // above already rejects any payload that does). Purely a convenience
  // so re-opening the popup doesn't require re-picking the file.
  await chrome.storage.session.set({ [SESSION_PAYLOAD_KEY]: parsed })
}

/**
 * LIVE DISCOVERY (item 5): a NOT_FOUND result is genuinely ambiguous once
 * pagination shows more than one page — the student may simply be on a
 * page this popup hasn't read. Never auto-navigates; only changes the
 * displayed message so the teacher knows to open the right page first,
 * per the exact required text. Any other status is shown as-is.
 */
function describeMappingStatusForDisplay(status) {
  if (status === 'NOT_FOUND' && currentPagination?.detected && currentPagination.totalPages > 1) {
    return 'นักเรียนอยู่หน้าอื่นของ SGS กรุณาเปิดหน้าที่มีนักเรียนคนนี้ก่อน'
  }
  return status
}

/**
 * DEBUG (item 7 of the follow-up spec): shown only when mapping found NO
 * matched student at all — anonymized structural info for the first
 * visible SGS row (never the actual name/code, only lengths/normalized
 * forms), so a teacher/developer can see WHY a match failed without this
 * popup ever displaying more personal data than the normal result table
 * already does.
 */
function buildAnonymizedMappingDebug(sgsCandidates) {
  if (sgsCandidates.length === 0) return null
  const first = sgsCandidates[0]
  return {
    studentNumber: first.sgsStudentNumber,
    studentCodeLength: first.sgsStudentId ? first.sgsStudentId.length : 0,
    normalizedName: normalizeThaiFullName(first.sgsFullNameRaw),
    rowIndex: sgsRowIndexFromKey(first.sgsRowKey),
  }
}

/**
 * BUG FIX: this table used to call matchStudentsToSgs with a hardcoded
 * empty candidate list, so it could never show a real match even after
 * "ตรวจสอบตารางคะแนน SGS จริง" (section 4) had already found and
 * extracted the exact same student rows. Now reuses
 * extractCurrentSgsStudentCandidates() — the SAME extraction
 * runColumnPreview uses — so a student visible in the currently-detected
 * SGS grid shows up here as MATCHED, never as a placeholder claiming SGS
 * isn't connected. This function itself never scans the page — see
 * runMappingCheck, which always scans FIRST and calls this only
 * afterward, so currentGridCandidate/currentGridFacts here are always
 * fresh from the CURRENT click, never a previous one.
 */
function renderMappingResult(payload) {
  const krunameStudents = payload.students.map((s) => ({
    studentId: s.studentId,
    studentNumber: s.studentNumber,
    studentCode: s.studentCode ?? null,
    fullName: s.fullName,
    score: s.score,
  }))
  const sgsCandidates = extractCurrentSgsStudentCandidates()
  const results = matchStudentsToSgs(krunameStudents, sgsCandidates)
  const candidateByRowKey = Object.fromEntries(sgsCandidates.map((c) => [c.sgsRowKey, c]))

  mappingResultBody.replaceChildren(
    ...results.map((result) => {
      const tr = document.createElement('tr')
      const tdSgs = document.createElement('td')
      const matched = result.matchedSgsRowKey ? candidateByRowKey[result.matchedSgsRowKey] : null
      if (matched) {
        tdSgs.textContent = `${matched.sgsStudentNumber ?? '-'} ${matched.sgsFullNameRaw}`
      } else if (!currentGridCandidate) {
        tdSgs.textContent = '— (ไม่พบตารางคะแนนนักเรียนในหน้า SGS ปัจจุบัน — ตรวจสอบว่าเปิดหน้ากรอกคะแนนอยู่หรือไม่)'
      } else {
        tdSgs.textContent = '— (ไม่พบนักเรียนคนนี้ในหน้า SGS ปัจจุบัน)'
      }
      const tdKruname = document.createElement('td')
      tdKruname.textContent = `${result.studentNumber ?? '-'} ${result.fullName}`
      const tdScore = document.createElement('td')
      tdScore.textContent = String(result.score)
      const tdStatus = document.createElement('td')
      tdStatus.textContent = describeMappingStatusForDisplay(result.status)
      tr.append(tdSgs, tdKruname, tdScore, tdStatus)
      return tr
    }),
  )
  mappingResultTable.hidden = false

  const anyMatched = results.some((result) => result.status === 'MATCHED')
  if (anyMatched) {
    mappingDebugEl.hidden = true
  } else {
    const debugInfo = buildAnonymizedMappingDebug(sgsCandidates)
    mappingDebugEl.hidden = !debugInfo
    if (debugInfo) mappingDebugEl.textContent = `แถวแรกที่พบใน SGS (ไม่ระบุตัวตน): ${JSON.stringify(debugInfo, null, 2)}`
    // Never rendered in the popup UI (studentCode/fullName are real
    // personal data) — console-only, for comparing why a match failed.
    console.log(
      '[SGS Bridge] mapping debug — normalized Bridge Payload students:',
      krunameStudents.map((s) => ({
        studentNumber: s.studentNumber,
        studentCodeNormalized: s.studentCode ? normalizeStudentCode(s.studentCode) : null,
        normalizedName: normalizeThaiFullName(s.fullName),
      })),
    )
  }
}

/**
 * BUG FIX: the mapping button is now ATOMIC — every click performs its
 * OWN fresh read of the CURRENT SGS tab (performLiveGridScan) and then
 * maps against it immediately. It never depends on the compact
 * diagnostic (section 3 — debug-only, never touches currentGridCandidate/
 * currentGridFacts) or on step 4's "ตรวจสอบตารางคะแนน SGS จริง" having
 * been run first: a teacher can click this ONE button on any open SGS
 * scoring page and get a real mapping result, or an honest scan error,
 * without any other step first.
 */
async function runMappingCheck() {
  if (!loadedPayload) return
  mappingCheckErrorEl.hidden = true
  mappingResultTable.hidden = true
  mappingDebugEl.hidden = true
  try {
    await performLiveGridScan()
  } catch (err) {
    mappingCheckErrorEl.textContent = `เกิดข้อผิดพลาดขณะสแกนหน้า SGS: ${err instanceof Error ? err.message : String(err)}`
    mappingCheckErrorEl.hidden = false
    return
  }
  renderMappingResult(loadedPayload)
}

/**
 * The original spec's item 5: a column is only ever eligible to be
 * confirmed/previewed once studentGrid.found === true AND number/code/
 * name are all confidently identified AND at least one WRITABLE score
 * column exists (never just "a score column" — a calculated total or a
 * % column never counts). Checked again right before rendering the
 * picker/preview, not just once at the top.
 */
function gridMeetsFillRequirements(candidate) {
  if (!candidate) return false
  const { numberColumnIndex, codeColumnIndex, nameColumnIndex } = candidate.identifierColumns
  return (
    numberColumnIndex !== null &&
    codeColumnIndex !== null &&
    nameColumnIndex !== null &&
    candidate.writableScoreColumns.length > 0
  )
}

/**
 * Item 5's other half: even once the grid overall qualifies, the ONE
 * column the teacher is about to fill must itself be in
 * candidate.writableScoreColumns — never a calculated/derived column
 * that merely happened to be rendered in the picker for transparency
 * (see renderRealColumnPicker's own derived-columns list).
 */
function isConfirmedColumnWritable(candidate, column) {
  return Boolean(candidate && column && candidate.writableScoreColumns.some((c) => c.key === column.key))
}

/**
 * BUG FIX: the ONE place this popup ever talks to the live SGS tab to
 * build a fresh grid candidate — used by BOTH runRealColumnInspection
 * (step 4's column inspection/fill preview) and runMappingCheck (the
 * "ตรวจสอบการจับคู่นักเรียน" button). Previously the mapping button never
 * called anything like this at all: it just re-rendered whatever
 * currentGridCandidate/currentGridFacts already held from a PREVIOUS
 * step-4 run (or nothing, if step 4 had never run — running the compact
 * diagnostic, which is debug-only and doesn't touch this state, was not
 * enough). Every caller of this function gets a scan of the CURRENT page,
 * every time — never a diagnostic textarea, never a stale run.
 */
async function performLiveGridScan() {
  const tab = await getActiveTab()
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: collectAllTableRowFacts,
  })
  const facts = injection.result
  currentGridFacts = facts

  const candidate = pickBestStudentGridCandidate(facts.tables)
  currentGridCandidate = candidate
  // LIVE DISCOVERY (item 4): computed as soon as a candidate exists (even
  // one with zero writable columns), so a NOT_FOUND mapping result can
  // honestly say "this student might just be on a different SGS page"
  // instead of implying they aren't in SGS at all — see
  // describeMappingStatusForDisplay below. Never used to navigate pages.
  currentPagination = detectPagination(facts.tables, candidate, facts.paginationHints)
  return { facts, candidate }
}

/**
 * Items 1-4 of the spec: finds the real score table by STRUCTURE (a
 * repeating run of identically-shaped rows containing inputs — never a
 * single top-level table taken on faith), classifies เลขที่/รหัส
 * นักเรียน/ชื่อ-นามสกุล by the CONTENT of that run's cells (never header
 * text alone — see sgs-table-extraction.js's own doc comment on the bug
 * this replaced), and lists every real score column candidate with its
 * derived columnKey/max score. Tries to auto-match the teacher's
 * KrunameClass column choice by label, but NEVER silently proceeds on
 * an AMBIGUOUS or NOT_FOUND match, and NEVER previews/confirms a column
 * unless gridMeetsFillRequirements passes.
 */
async function runRealColumnInspection() {
  if (!loadedPayload) {
    realInspectErrorEl.textContent = 'กรุณาโหลด Bridge Payload ในขั้นตอนที่ 1 ก่อน'
    realInspectErrorEl.hidden = false
    return
  }
  realInspectErrorEl.hidden = true
  resetRealInspectionState()
  realTargetLabelEl.textContent = loadedPayload.targetColumn.label

  const { candidate } = await performLiveGridScan()

  if (!candidate) {
    realInspectErrorEl.textContent = 'ไม่พบตารางคะแนนนักเรียนในหน้านี้ — ตรวจสอบว่าเปิดหน้ากรอกคะแนนของ SGS อยู่หรือไม่'
    realInspectErrorEl.hidden = false
    return
  }
  if (candidate.writableScoreColumns.length === 0) {
    // LIVE DISCOVERY (item 2): a column merely gated by an unchecked SGS
    // header checkbox is REAL and activatable — never described the same
    // way as a genuinely calculated/read-only column.
    if (candidate.activatableScoreColumns.length > 0) {
      realInspectErrorEl.textContent = `พบคอลัมน์คะแนนจริงแต่ยังไม่ได้เปิดใช้งานใน SGS — กรุณาติ๊กเปิดช่องคะแนนใน SGS ก่อน: ${candidate.activatableScoreColumns.map((c) => c.label).join(', ')}`
    } else {
      realInspectErrorEl.textContent =
        candidate.derivedColumns.length > 0
          ? 'พบตารางนักเรียนแต่คอลัมน์คะแนนที่พบทั้งหมดเป็นคอลัมน์คำนวณ/อ่านอย่างเดียว (เช่น รวมตลอดภาค, %, ปกติ) — ไม่มีช่องให้กรอกจริง'
          : 'พบตารางนักเรียนแต่ไม่พบคอลัมน์คะแนนที่กรอกได้จริง'
    }
    realInspectErrorEl.hidden = false
    renderRealColumnPicker(candidate, { status: 'NOT_FOUND', column: null })
    return
  }

  const warnings = buildGridWarnings(candidate)
  if (warnings.length > 0) {
    realColumnMatchWarningEl.textContent = `พบตารางแต่ยังไม่มั่นใจทั้งหมด (ความเชื่อมั่น: ${computeGridConfidence(candidate)}): ${warnings.join(', ')}`
    realColumnMatchWarningEl.hidden = false
  }

  const matchResult = matchTargetColumnToRealColumns(loadedPayload.targetColumn.label, candidate.writableScoreColumns)
  renderRealColumnPicker(candidate, matchResult)

  if (!gridMeetsFillRequirements(candidate)) {
    // Column may still be picked for review, but runColumnPreview()
    // itself will refuse to enable the fill button — see its own guard.
    return
  }

  if (matchResult.status === 'MATCHED') {
    confirmedRealColumn = matchResult.column
    void runColumnPreview()
  } else {
    const reason = matchResult.status === 'AMBIGUOUS' ? 'พบมากกว่า 1 คอลัมน์ที่ชื่อตรงกัน' : 'ไม่พบคอลัมน์ที่ชื่อตรงกันโดยอัตโนมัติ'
    const existing = realColumnMatchWarningEl.hidden ? '' : `${realColumnMatchWarningEl.textContent} · `
    realColumnMatchWarningEl.textContent = `${existing}${reason} — กรุณาเลือกคอลัมน์ที่ถูกต้องด้วยตนเองด้านล่าง`
    realColumnMatchWarningEl.hidden = false
  }
}

const DERIVED_COLUMN_REASON_LABEL = {
  label_indicates_calculated_or_status: 'ชื่อคอลัมน์บ่งชี้ว่าเป็นค่าที่คำนวณ/สถานะ (เช่น รวมตลอดภาค, %, ปกติ)',
  readonly_input: 'ช่องกรอกเป็นแบบอ่านอย่างเดียว (readonly)',
  no_input: 'ไม่มีช่องกรอกข้อมูลจริง',
  not_uniformly_editable: 'ไม่ใช่ทุกแถวมีช่องกรอกแบบเดียวกัน',
}

/**
 * Item 3 of the live-discovery spec — the exact required workflow
 * message: a real score column that's simply not been switched on in
 * SGS yet is NEVER described as broken/derived, only as "ยังไม่ได้เปิด."
 */
const ACTIVATABLE_COLUMN_REASON_LABEL = {
  header_checkbox_unchecked: (label) => `ช่อง ${label} ยังไม่ได้เปิดใน SGS กรุณาติ๊ก checkbox ช่อง ${label} ก่อน`,
  disabled_input: (label) => `ช่อง ${label} ถูกปิดใช้งานอยู่ในขณะนี้ (ไม่ใช่คอลัมน์คำนวณ) — ตรวจสอบใน SGS`,
}

/**
 * Only ever offers candidate.writableScoreColumns as fill-target radio
 * options — item 5's "never allow fill into a calculated total/
 * percentage/grade-status/non-selected column" starts here: a derived
 * column can never even be SELECTED, let alone filled. `activatableScoreColumns`
 * (item 2/3) are shown separately with the exact "กรุณาติ๊กเปิดช่องคะแนนนี้
 * ใน SGS ก่อน" workflow message and a re-scan button — never merged into
 * the derived list, and never auto-checked (item 3: this extension never
 * clicks/toggles the SGS header checkbox itself).
 */
function renderRealColumnPicker(gridCandidate, matchResult) {
  realColumnPickerEl.replaceChildren(
    ...gridCandidate.writableScoreColumns.map((candidate) => {
      const label = document.createElement('label')
      const input = document.createElement('input')
      input.type = 'radio'
      input.name = 'real-target-column'
      input.checked = matchResult.column?.key === candidate.key
      input.addEventListener('change', () => {
        confirmedRealColumn = candidate
        void runColumnPreview()
      })
      label.append(
        input,
        document.createTextNode(
          ` ${candidate.label} (คอลัมน์ที่ ${candidate.columnIndex + 1}${candidate.maxScore !== null ? `, เต็ม ${candidate.maxScore}` : ', ไม่ทราบคะแนนเต็ม'})`,
        ),
      )
      return label
    }),
  )
  realColumnPickerWrap.hidden = false

  realActivatableColumnsEl.replaceChildren(
    ...gridCandidate.activatableScoreColumns.map((activatable) => {
      const li = document.createElement('li')
      const describe = ACTIVATABLE_COLUMN_REASON_LABEL[activatable.reason]
      li.textContent = describe ? describe(activatable.label) : `${activatable.label} — ${activatable.reason}`
      return li
    }),
  )
  realActivatableColumnsWrap.hidden = gridCandidate.activatableScoreColumns.length === 0

  realDerivedColumnsEl.replaceChildren(
    ...gridCandidate.derivedColumns.map((derived) => {
      const li = document.createElement('li')
      li.textContent = `${derived.label} — ${DERIVED_COLUMN_REASON_LABEL[derived.reason] ?? derived.reason}`
      return li
    }),
  )
  realDerivedColumnsWrap.hidden = gridCandidate.derivedColumns.length === 0
}

/**
 * Reads `confirmedRealColumn.columnIndex`'s CURRENT values for the SAME
 * confirmed table/row-range currentGridInspection already found — never
 * any other column's, and never a fresh re-guess of which table is the
 * grid (that was already confirmed in runRealColumnInspection). Builds
 * the REAL preview (item 7 of the original spec) from actually-matched
 * SGS rows — read-only; see renderRealFillPreview's own doc comment for
 * why no write ever follows from this in the current phase.
 */
/**
 * BUG FIX (live SGS student mapping was never wired to the detected
 * student rows): the ONE place this popup ever turns the CURRENTLY
 * confirmed grid's row text into mapping candidates — both
 * runColumnPreview (below) and renderMappingResult (the "ตรวจสอบการ
 * จับคู่นักเรียน" dry-run button) call this instead of each building its
 * own list, so section 2 and section 4 of the popup can never disagree
 * about who's actually visible on the current SGS page. Returns `[]`
 * (never a guess) when no inspection has run yet or the winning table
 * can't be found in the last-captured facts.
 */
function extractCurrentSgsStudentCandidates() {
  if (!currentGridCandidate || !currentGridFacts) return []
  const { tableIndex, run, identifierColumns } = currentGridCandidate
  const winningTable = currentGridFacts.tables.find((t) => t.tableIndex === tableIndex)
  if (!winningTable) return []
  return extractSgsStudentCandidates(winningTable, run, identifierColumns)
}

async function runColumnPreview() {
  if (!confirmedRealColumn || !loadedPayload || !currentGridCandidate || !currentGridFacts) return
  if (!gridMeetsFillRequirements(currentGridCandidate)) return
  if (!isConfirmedColumnWritable(currentGridCandidate, confirmedRealColumn)) return

  const { tableIndex, run } = currentGridCandidate

  const tab = await getActiveTab()
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: readColumnValues,
    args: [tableIndex, run.startIndex, run.length, confirmedRealColumn.columnIndex],
  })
  const result = injection.result
  if (!result.found) return

  // Row text (เลขที่/รหัสนักเรียน/ชื่อ-นามสกุล) was already extracted by
  // collectAllTableRowFacts during runRealColumnInspection() — no
  // second DOM round-trip needed just to read it again.
  const sgsCandidates = extractCurrentSgsStudentCandidates()

  const roster = buildFullRosterFromPayload(loadedPayload)
  const krunameStudents = roster.map((r) => ({
    studentId: r.studentId,
    studentNumber: r.studentNumber,
    studentCode: r.studentCode,
    fullName: r.fullName,
    score: r.score,
  }))
  const mappingResults = matchStudentsToSgs(krunameStudents, sgsCandidates)

  const existingScoresBySgsRowKey = {}
  for (const [offsetText, value] of Object.entries(result.values)) {
    existingScoresBySgsRowKey[buildSgsRowKey(Number(offsetText))] = value
  }

  realPlan = computeSgsRealFillPlan(krunameStudents, mappingResults, existingScoresBySgsRowKey, loadedPayload.overwriteMode)
  renderRealFillPreview(realPlan)
  populateSingleCellTestPickers(realPlan, currentGridCandidate)
  updateWholeColumnAvailability()
}

/**
 * NEXT PHASE — item 1: shows/hides the "ส่งคอลัมน์นี้ทั้งห้อง" button.
 * Same eligibility as the single-cell test section (a confirmed, real,
 * currently-writable column) — never offered for a derived/activatable
 * column, and never before a real column has actually been confirmed.
 * Does NOT itself start a whole-column session; a fresh eligibility
 * change (a different column picked, a rescan) always tears down any
 * in-progress session via resetWholeColumnState (called from
 * resetRealInspectionState), so the teacher must explicitly click
 * "ส่งคอลัมน์นี้ทั้งห้อง" again for the newly-eligible column.
 */
function updateWholeColumnAvailability() {
  const eligible = Boolean(
    loadedPayload &&
      currentGridCandidate &&
      confirmedRealColumn &&
      gridMeetsFillRequirements(currentGridCandidate) &&
      isConfirmedColumnWritable(currentGridCandidate, confirmedRealColumn),
  )
  wholeColumnWrap.hidden = !eligible
  // Same eligibility as section 6 — auto-run is the SAME confirmed
  // column, just driven across pages automatically.
  autoRunWrap.hidden = !eligible
}

/**
 * Item 4 of the live-discovery spec: a READ-ONLY preview table only —
 * existing SGS value vs. the proposed KrunameClass value. This never
 * writes anything; the bulk "กรอกจริงแบบกลุ่ม" action has been removed
 * entirely (see the module header and popup.html's own explanatory
 * text) because the real SGS page auto-saves with no Save button, so a
 * bulk write is unsafe until the much narrower single-cell test mode
 * (item 5, below) has been validated live.
 */
function renderRealFillPreview(plan) {
  realFillPreviewBody.replaceChildren(
    ...plan.map((row) => {
      const tr = document.createElement('tr')
      const tdNumber = document.createElement('td')
      tdNumber.textContent = row.studentNumber === null ? '-' : String(row.studentNumber)
      const tdName = document.createElement('td')
      tdName.textContent = row.fullName
      const tdKruname = document.createElement('td')
      tdKruname.textContent = row.krunameScore === null ? '—' : String(row.krunameScore)
      const tdExisting = document.createElement('td')
      tdExisting.textContent = formatRealExistingScoreDisplay(row)
      const tdNew = document.createElement('td')
      tdNew.textContent = formatRealNewValueDisplay(row)
      const tdStatus = document.createElement('td')
      tdStatus.textContent = describeMappingStatusForDisplay(row.mappingStatus)
      tr.append(tdNumber, tdName, tdKruname, tdExisting, tdNew, tdStatus)
      return tr
    }),
  )
  realFillPreviewWrap.hidden = false
}

/**
 * Item 5: populates the "ทดสอบ 1 คน" student/column pickers once a real
 * column preview exists. Only MATCHED students with a real KrunameClass
 * score are offered (nothing else could ever produce a valid single-cell
 * plan — see buildSingleCellTestPlan), and only writableScoreColumns are
 * offered (never a derived/activatable one — the same rule
 * isConfirmedColumnWritable enforces for the main flow). This only shows
 * the section and its pickers; the write button/checkbox stay disabled
 * (resetSingleCellTestState's safe default) until the teacher clicks
 * "แสดงตัวอย่าง 1 ช่อง" and every precondition passes.
 */
function populateSingleCellTestPickers(plan, candidate) {
  const testableRows = plan
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.mappingStatus === 'MATCHED' && row.krunameScore !== null && row.krunameScore !== undefined)

  if (testableRows.length === 0 || candidate.writableScoreColumns.length === 0) {
    resetSingleCellTestState()
    return
  }

  sctStudentSelect.replaceChildren(
    ...testableRows.map(({ row, index }) => {
      const option = document.createElement('option')
      option.value = String(index)
      option.textContent = `${row.studentNumber ?? '-'} ${row.fullName}`
      return option
    }),
  )
  sctColumnSelect.replaceChildren(
    ...candidate.writableScoreColumns.map((column) => {
      const option = document.createElement('option')
      option.value = String(column.columnIndex)
      option.textContent = `${column.label}${column.maxScore !== null ? ` (เต็ม ${column.maxScore})` : ''}`
      return option
    }),
  )
  sctPreviewEl.hidden = true
  sctSubjectClassroomCheckEl.hidden = true
  sctGateReasonEl.hidden = true
  sctWriteWarningEl.hidden = true
  sctResultEl.hidden = true
  confirmedSingleCellContext = null
  sctConfirmCheckbox.checked = false
  sctConfirmCheckbox.disabled = true
  sctWriteBtn.disabled = true
  singleCellTestWrap.hidden = false
}

/**
 * BUG FIX — LIVE DISCOVERY: this used to compare KrunameClass's own
 * subjectName/classroomName against SGS's raw filter text with a plain
 * `===`, which ALWAYS failed even for the correct subject/classroom —
 * e.g. KrunameClass "สังคมศึกษา3" / "2/1" vs SGS's own filter text
 * "ส22101 สังคมศึกษา3 ม.2" / "1" describe the SAME class (ม.2/1) but are
 * never byte-identical. Real semantic matching now lives in
 * subject-classroom-match.js (course code / normalized name for subject,
 * parsed grade+section for classroom) — see its own doc comment for the
 * full rationale, including which SGS elements are treated as
 * authoritative. Still never blocks on missing/unknown data on either
 * side — only a CONFIRMED mismatch blocks the single-cell test. This is
 * a defensive extra check, not the primary safety mechanism —
 * revalidateSingleCellTestContext still re-checks the exact same filter
 * text hasn't drifted between preview and write time.
 */
function evaluateCurrentSubjectClassroomMatch() {
  if (!loadedPayload || !currentGridFacts) return null
  return evaluateSubjectClassroomMatch({
    krunameSubjectName: loadedPayload.subjectName,
    krunameClassroomName: loadedPayload.classroomName,
    sgsSubjectFilterText: currentGridFacts.subjectFilter?.selectedText ?? null,
    sgsClassroomFilterText: currentGridFacts.classroomFilter?.selectedText ?? null,
  })
}

/**
 * The clear preview the fix requires: "KrunameClass: ม.2/1 / SGS: ม.2
 * กลุ่ม 1 / ผลตรวจ: ตรงกัน" — shown for BOTH subject and classroom
 * separately so a teacher can see exactly which half (if either) is the
 * reason the single-cell test is blocked, rather than one opaque
 * yes/no. Hides the whole block when there's nothing to compare yet
 * (no payload loaded / no live scan run).
 */
function renderSubjectClassroomCheck(result) {
  if (!result) {
    sctSubjectClassroomCheckEl.hidden = true
    return
  }
  sctCheckSubjectKrunameEl.textContent = loadedPayload?.subjectName || '-'
  sctCheckSubjectSgsEl.textContent = currentGridFacts?.subjectFilter?.selectedText || '-'
  sctCheckSubjectResultEl.textContent = describeMatchVerdict(result.subject)
  sctCheckClassroomKrunameEl.textContent = result.classroom.krunameLabel ?? (loadedPayload?.classroomName || '-')
  sctCheckClassroomSgsEl.textContent = result.classroom.sgsLabel ?? '-'
  sctCheckClassroomResultEl.textContent = describeMatchVerdict(result.classroom)
  sctSubjectClassroomCheckEl.hidden = false
}

/**
 * Item 5: reads the CURRENT value for exactly one student's one column
 * (never a range) and builds the single-cell plan for display only —
 * see single-cell-test.js's module doc comment for why nothing here
 * ever performs the actual write.
 */
async function runSingleCellTestPreview() {
  if (!realPlan || !currentGridCandidate || !currentGridFacts) return
  resetSingleCellTestGateOnly()

  const rowIndex = Number(sctStudentSelect.value)
  const columnIndex = Number(sctColumnSelect.value)
  const planRow = realPlan[rowIndex]
  const column = currentGridCandidate.writableScoreColumns.find((c) => c.columnIndex === columnIndex)
  if (!planRow || !column) return

  const sgsRowOffset = sgsRowIndexFromKey(planRow.matchedSgsRowKey)
  if (sgsRowOffset === null) return

  const { tableIndex, run, identifierColumns } = currentGridCandidate
  const absoluteRowIndex = run.startIndex + sgsRowOffset
  const tab = await getActiveTab()
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: readSingleCellRevalidationState,
    // Exactly ONE row, exactly ONE column — never a range, and the SAME
    // atomic read used again immediately before write (see
    // runSingleCellTestWrite) so "current value" and "is this cell
    // actually writable right now" always come from the same instant.
    args: [tableIndex, absoluteRowIndex, columnIndex, identifierColumns],
  })
  const fresh = injection.result

  const plan = buildSingleCellTestPlan({
    sgsRowOffset,
    columnIndex,
    columnKey: column.key,
    currentValue: fresh.currentValue,
    newValue: planRow.krunameScore,
  })

  sctStudentNameEl.textContent = fresh.studentName || planRow.fullName
  sctStudentNumberEl.textContent = fresh.studentNumber === null ? '-' : String(fresh.studentNumber)
  sctStudentCodeEl.textContent = fresh.studentCode ?? '-'
  sctColumnLabelEl.textContent = column.label
  sctCurrentValueEl.textContent = plan.valid ? (plan.currentValue === null ? 'ว่าง' : String(plan.currentValue)) : '—'
  sctNewValueEl.textContent = plan.valid ? String(plan.newValue) : formatSingleCellTestSummary(plan)
  sctPreviewEl.hidden = false

  const subjectClassroomMatch = evaluateCurrentSubjectClassroomMatch()
  renderSubjectClassroomCheck(subjectClassroomMatch)

  if (!plan.valid) {
    sctGateReasonEl.textContent = 'ไม่สามารถสร้างแผนทดลองเขียนได้ (ค่าคะแนนไม่ถูกต้อง)'
    sctGateReasonEl.hidden = false
    return
  }

  const preconditions = evaluateSingleCellTestPreconditions({
    studentGridFound: currentGridCandidate !== null,
    confidence: computeGridConfidence(currentGridCandidate),
    selectedStudentCount: sctStudentSelect.value ? 1 : 0,
    selectedColumnCount: sctColumnSelect.value ? 1 : 0,
    // `column` above was found via .find() over writableScoreColumns
    // itself, so this is always true once execution reaches here — kept
    // as an explicit re-check (rather than a hardcoded `true`) so this
    // stays correct even if a future change ever populates sctColumnSelect
    // from a wider list.
    columnIsWritable: currentGridCandidate.writableScoreColumns.some((c) => c.columnIndex === columnIndex),
    headerCheckboxOk: !column.headerCheckboxPresent || column.headerCheckboxChecked === true,
    cellInputState: { visible: fresh.cellVisible, enabled: fresh.cellEnabled, visibleInputCount: fresh.visibleInputCount },
    proposedScore: plan.newValue,
    maxScore: column.maxScore,
    // LIVE DISCOVERY (item 5): `planRow` came from `testableRows` in
    // populateSingleCellTestPickers, which only ever offers rows whose
    // mappingStatus is already 'MATCHED' against the CURRENTLY extracted
    // (i.e. currently-visible-page) SGS candidates — re-checked
    // explicitly rather than only relied upon implicitly.
    studentVisibleOnCurrentPage: planRow.mappingStatus === 'MATCHED',
    subjectClassroomOk: subjectClassroomMatch === null ? true : subjectClassroomMatch.ok,
  })

  if (!preconditions.ok) {
    sctGateReasonEl.textContent = preconditions.reason
    sctGateReasonEl.hidden = false
    return
  }

  // Every precondition holds — the ONE moment sctConfirmCheckbox is
  // allowed out of its safe default. It still starts UNCHECKED; the
  // teacher's own tick is what evaluateSingleCellTestPreconditions +
  // canEnableSingleCellTestWrite's consent half requires before
  // sctWriteBtn itself can enable (see the checkbox's change listener).
  confirmedSingleCellContext = {
    tableIndex,
    rowIndex: absoluteRowIndex,
    columnIndex,
    columnKey: column.key,
    columnLabel: column.label,
    maxScore: column.maxScore,
    identifierColumns,
    subjectFilterText: currentGridFacts.subjectFilter?.selectedText ?? null,
    classroomFilterText: currentGridFacts.classroomFilter?.selectedText ?? null,
    studentNumber: fresh.studentNumber,
    studentCode: fresh.studentCode,
    studentName: fresh.studentName,
    proposedScore: plan.newValue,
  }
  sctWriteWarningEl.hidden = false
  sctConfirmCheckbox.disabled = false
  updateSingleCellWriteButtonState()
}

/** Clears only the gate/result UI (never the pickers themselves) —
 * called at the start of every fresh preview so a stale "ready to write"
 * state from a PREVIOUS preview can never linger while a new one is
 * still loading. */
function resetSingleCellTestGateOnly() {
  sctSubjectClassroomCheckEl.hidden = true
  sctGateReasonEl.hidden = true
  sctWriteWarningEl.hidden = true
  sctResultEl.hidden = true
  confirmedSingleCellContext = null
  sctConfirmCheckbox.checked = false
  sctConfirmCheckbox.disabled = true
  sctWriteBtn.disabled = true
}

/** The write button's own gate — re-evaluated on every checkbox toggle,
 * never assumed from the precondition pass alone (see
 * canEnableSingleCellTestWrite's own doc comment on ordering). */
function updateSingleCellWriteButtonState() {
  sctWriteBtn.disabled = !canEnableSingleCellTestWrite(confirmedSingleCellContext !== null, sctConfirmCheckbox.checked)
}

/** Returns sctConfirmCheckbox/sctWriteBtn/confirmedSingleCellContext to
 * their safe "not yet previewed" state after a write attempt (success,
 * abort, or error) — deliberately never touches sctGateReasonEl or
 * sctResultEl, since the caller has just set one of those to explain
 * what happened and this must not erase it. A fresh
 * "แสดงตัวอย่าง 1 ช่อง" click is required before another write, whatever
 * this attempt's outcome — there is no "confirm again" shortcut. */
function disarmSingleCellTestWrite() {
  confirmedSingleCellContext = null
  sctConfirmCheckbox.checked = false
  sctConfirmCheckbox.disabled = true
  sctWriteBtn.disabled = true
}

/**
 * CONTROLLED LIVE TEST: the one and only write path in this phase.
 * Re-reads the SAME single cell one more time (readSingleCellRevalidationState)
 * and refuses to proceed on ANY drift from confirmedSingleCellContext —
 * subject/classroom filter, student identity, column, or input
 * structure — per the GUARD AGAINST STALE DOM requirement. Only once
 * that fresh read still matches does it call fillSgsColumnValues with a
 * writesByOffset guaranteed (by buildSingleCellTestPlan) to contain
 * exactly the one confirmed offset. Never clicks Save, never touches the
 * SGS header checkbox, never navigates, never touches any other cell.
 */
async function runSingleCellTestWrite() {
  if (!confirmedSingleCellContext) return
  if (!canEnableSingleCellTestWrite(true, sctConfirmCheckbox.checked)) return
  const context = confirmedSingleCellContext
  sctWriteBtn.disabled = true

  const tab = await getActiveTab()
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: readSingleCellRevalidationState,
    args: [context.tableIndex, context.rowIndex, context.columnIndex, context.identifierColumns],
  })
  const fresh = injection.result

  const revalidation = revalidateSingleCellTestContext(
    {
      subjectFilterText: context.subjectFilterText,
      classroomFilterText: context.classroomFilterText,
      studentNumber: context.studentNumber,
      studentCode: context.studentCode,
      studentName: context.studentName,
      columnKey: context.columnKey,
    },
    {
      subjectFilterText: fresh.subjectFilterText,
      classroomFilterText: fresh.classroomFilterText,
      studentNumber: fresh.studentNumber,
      studentCode: fresh.studentCode,
      studentName: fresh.studentName,
      columnKey: context.columnKey,
      cellVisible: fresh.cellVisible,
      cellEnabled: fresh.cellEnabled,
      visibleInputCount: fresh.visibleInputCount,
    },
  )

  if (!revalidation.ok) {
    sctGateReasonEl.textContent = `ยกเลิกการเขียน: ${revalidation.reason}`
    sctGateReasonEl.hidden = false
    disarmSingleCellTestWrite()
    return
  }

  const sgsRowOffset = context.rowIndex - currentGridCandidate.run.startIndex
  const plan = buildSingleCellTestPlan({
    sgsRowOffset,
    columnIndex: context.columnIndex,
    columnKey: context.columnKey,
    currentValue: fresh.currentValue,
    newValue: context.proposedScore,
  })
  if (!plan.valid) {
    sctGateReasonEl.textContent = 'ยกเลิกการเขียน: ไม่สามารถสร้างแผนทดลองเขียนได้อีกครั้งก่อนบันทึกจริง'
    sctGateReasonEl.hidden = false
    disarmSingleCellTestWrite()
    return
  }

  const [writeInjection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: fillSgsColumnValues,
    args: [context.tableIndex, currentGridCandidate.run.startIndex, context.columnIndex, plan.writesByOffset],
  })
  const writeResult = writeInjection.result
  const success = writeResult.found && writeResult.writtenCount === 1 && writeResult.missingOffsets.length === 0

  sctResultStudentEl.textContent = `${context.studentNumber ?? '-'} ${context.studentName}`
  sctResultColumnEl.textContent = context.columnLabel
  sctResultPreviousEl.textContent = fresh.currentValue === null ? 'ว่าง' : String(fresh.currentValue)
  sctResultNewEl.textContent = String(context.proposedScore)
  sctResultStatusEl.textContent = success ? 'สำเร็จ' : 'ไม่สำเร็จ — ไม่พบช่องกรอกที่เขียนได้อีกต่อไป'
  sctResultEl.hidden = false
  sctGateReasonEl.hidden = true
  disarmSingleCellTestWrite()
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  if (file) void loadPayloadFromFile(file)
})

mappingBtn.addEventListener('click', () => {
  void runMappingCheck()
})

/**
 * Item 6 of the spec — the PRIMARY diagnostic: a focused report of
 * whether a student grid was found, its confidence, and any warnings,
 * with no per-table dump of ~200 tables. Never requires a loaded
 * payload (useful for surveying any of the ~18 expected SGS pages on
 * its own).
 */
diagnosticBtn.addEventListener('click', async () => {
  diagnosticOutput.value = 'กำลังตรวจสอบ...'
  try {
    const tab = await getActiveTab()
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectAllTableRowFacts,
    })
    const report = buildCompactStudentGridReport(injection.result)
    diagnosticOutput.value = formatDiagnosticReportForCopy(report)
  } catch (err) {
    diagnosticOutput.value = `เกิดข้อผิดพลาด: ${err instanceof Error ? err.message : String(err)}`
  }
})

/**
 * Anonymized per-row debug companion to the compact report above —
 * never a student's actual name/code, only structural metadata (see
 * buildAnonymizedRowDiagnostics's own doc comment).
 */
diagnosticDebugBtn.addEventListener('click', async () => {
  diagnosticOutput.value = 'กำลังตรวจสอบ...'
  try {
    const tab = await getActiveTab()
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectAllTableRowFacts,
    })
    const compact = buildCompactStudentGridReport(injection.result)
    const debug = buildStudentGridDebugReport(injection.result)
    diagnosticOutput.value = formatDiagnosticReportForCopy({ ...compact, debugRows: debug.rows })
  } catch (err) {
    diagnosticOutput.value = `เกิดข้อผิดพลาด: ${err instanceof Error ? err.message : String(err)}`
  }
})

/**
 * The OLD, verbose raw dump — every table's row count/header text/input
 * counts, no student-grid interpretation. Kept only as the "optional
 * verbose/debug mode" the spec asks for; the compact report above is
 * the one meant for everyday use.
 */
diagnosticVerboseBtn.addEventListener('click', async () => {
  diagnosticOutput.value = 'กำลังตรวจสอบ...'
  try {
    const tab = await getActiveTab()
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectRawSgsFacts,
    })
    const report = buildDiagnosticReport(injection.result)
    diagnosticOutput.value = formatDiagnosticReportForCopy(report)
  } catch (err) {
    diagnosticOutput.value = `เกิดข้อผิดพลาด: ${err instanceof Error ? err.message : String(err)}`
  }
})

copyDiagnosticBtn.addEventListener('click', async () => {
  if (!diagnosticOutput.value) return
  await navigator.clipboard.writeText(diagnosticOutput.value)
})

inspectBtn.addEventListener('click', () => {
  void runRealColumnInspection()
})

// Item 3's example workflow: teacher manually checks the SGS header
// checkbox, then the Bridge re-scans — this button just re-runs the
// exact same inspection, never toggles anything in the SGS page itself.
realRescanBtn.addEventListener('click', () => {
  void runRealColumnInspection()
})

sctPreviewBtn.addEventListener('click', () => {
  void runSingleCellTestPreview()
})

// Changing either picker invalidates whatever the last preview
// confirmed — a stale confirmedSingleCellContext could otherwise point
// at a student/column the teacher is no longer looking at. The teacher
// must click "แสดงตัวอย่าง 1 ช่อง" again to re-arm the checkbox/button.
sctStudentSelect.addEventListener('change', () => {
  resetSingleCellTestGateOnly()
  sctPreviewEl.hidden = true
})
sctColumnSelect.addEventListener('change', () => {
  resetSingleCellTestGateOnly()
  sctPreviewEl.hidden = true
})

// CONTROLLED LIVE TEST: sctConfirmCheckbox only ever becomes checkable
// once runSingleCellTestPreview has confirmed every OTHER precondition
// (see evaluateSingleCellTestPreconditions) — this listener is the ONLY
// place its own change re-evaluates sctWriteBtn's enabled state, per
// canEnableSingleCellTestWrite's "preconditions AND explicit consent"
// rule.
sctConfirmCheckbox.addEventListener('change', () => {
  updateSingleCellWriteButtonState()
})

// The one and only live-write action in this phase — gated behind every
// precondition in evaluateSingleCellTestPreconditions PLUS this explicit
// click, and itself re-validated against a fresh DOM read immediately
// before writing (see runSingleCellTestWrite's own doc comment).
sctWriteBtn.addEventListener('click', () => {
  void runSingleCellTestWrite()
})

// ==================================================
// NEXT PHASE — whole-column writing (items 1-6). One page at a time,
// semi-automatic pagination (item 4: automatic page navigation has never
// been confirmed safe on the real page, so this always waits for the
// teacher to open the next page themselves), one column, structurally
// guaranteed by buildWholeColumnWriteInstructions/fillSgsColumnValues
// both taking a single columnIndex for the whole call.
// ==================================================

/**
 * Scans the CURRENTLY OPEN SGS page fresh (performLiveGridScan — the
 * exact same scan runMappingCheck/runRealColumnInspection use, never a
 * bespoke one), re-locates the CONFIRMED column by its STABLE key (never
 * by the index from a previous page/scan — see locateColumnOnCurrentPage's
 * own doc comment), and reads that column's current values for the
 * "คะแนนเดิม SGS" preview column. Returns a plain result object rather
 * than writing to any UI element directly, so BOTH section 6's
 * scanCurrentSgsPageForWholeColumn (below) and section 7's auto-run
 * engine share this ONE scan implementation — never two independent
 * copies that could drift apart.
 */
async function scanCurrentSgsPageForColumn(columnKey) {
  if (!loadedPayload || !columnKey) {
    return { ok: false, reason: 'ยังไม่ได้เลือกคอลัมน์ที่จะส่ง', pageScan: null }
  }

  const { candidate } = await performLiveGridScan()
  if (!candidate) {
    return { ok: false, reason: 'ไม่พบตารางคะแนนนักเรียนในหน้านี้ — ตรวจสอบว่าเปิดหน้ากรอกคะแนนของ SGS อยู่หรือไม่', pageScan: null }
  }

  const column = locateColumnOnCurrentPage(candidate.writableScoreColumns, columnKey)
  if (!column) {
    return {
      ok: false,
      reason: 'ไม่พบคอลัมน์ที่เลือกไว้เป็นช่องกรอกได้จริงในหน้านี้ — ตรวจสอบว่าติ๊กเปิดช่องคะแนนนี้ใน SGS แล้วหรือยัง',
      pageScan: null,
    }
  }

  const tab = await getActiveTab()
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: readColumnValues,
    args: [candidate.tableIndex, candidate.run.startIndex, candidate.run.length, column.columnIndex],
  })
  const result = injection.result
  const existingScoresBySgsRowKey = {}
  if (result.found) {
    for (const [offsetText, value] of Object.entries(result.values)) {
      existingScoresBySgsRowKey[buildSgsRowKey(Number(offsetText))] = value
    }
  }

  return { ok: true, reason: null, pageScan: { candidate, column, existingScoresBySgsRowKey } }
}

/** Section 6's own thin wrapper over the shared scan above — keeps
 * wcPageScan/wcGateReasonEl exactly as every other section-6 function
 * already expects them. */
async function scanCurrentSgsPageForWholeColumn() {
  const result = await scanCurrentSgsPageForColumn(wcConfirmedColumnKey)
  wcPageScan = result.pageScan
  if (!result.ok) {
    wcGateReasonEl.textContent = result.reason
    wcGateReasonEl.hidden = false
  }
  return result.ok
}

/**
 * The one place a whole-column plan is built for display AND for the
 * eventual write — computeWholeColumnPlan is handed the CONFIRMED real
 * column's own maxScore (never the Bridge Payload's own claimed max —
 * the teacher may have picked a different real column than the payload
 * assumed) and the teacher's current overwrite-mode checkbox state. Pure
 * re-render: never re-scans the DOM itself (see
 * scanCurrentSgsPageForWholeColumn, its only caller-side prerequisite).
 */
function renderWholeColumnPreviewFromScan() {
  if (!wcPageScan || !loadedPayload || !currentGridFacts) return
  const { candidate, column, existingScoresBySgsRowKey } = wcPageScan

  const winningTable = currentGridFacts.tables.find((t) => t.tableIndex === candidate.tableIndex)
  const sgsCandidates = winningTable ? extractSgsStudentCandidates(winningTable, candidate.run, candidate.identifierColumns) : []

  const roster = buildFullRosterFromPayload(loadedPayload)
  const krunameStudents = roster.map((r) => ({
    studentId: r.studentId,
    studentNumber: r.studentNumber,
    studentCode: r.studentCode,
    fullName: r.fullName,
    score: r.score,
  }))
  const mappingResults = matchStudentsToSgs(krunameStudents, sgsCandidates)
  const overwriteMode = wcOverwriteCheckbox.checked ? 'overwrite_selected_column' : 'skip_existing'
  const plan = computeWholeColumnPlan(krunameStudents, mappingResults, existingScoresBySgsRowKey, overwriteMode, column.maxScore)

  wcPreviewSubjectEl.textContent = loadedPayload.subjectName || '-'
  wcPreviewClassroomEl.textContent = loadedPayload.classroomName || '-'
  wcPreviewColumnEl.textContent = column.label
  wcPreviewMaxScoreEl.textContent = column.maxScore !== null && column.maxScore !== undefined ? String(column.maxScore) : 'ไม่ทราบ'

  wcPreviewTableBody.replaceChildren(
    ...plan.map((row) => {
      const tr = document.createElement('tr')
      const tdNumber = document.createElement('td')
      tdNumber.textContent = row.studentNumber === null ? '-' : String(row.studentNumber)
      const tdName = document.createElement('td')
      tdName.textContent = row.fullName
      const tdKruname = document.createElement('td')
      tdKruname.textContent = row.krunameScore === null ? '—' : String(row.krunameScore)
      const tdExisting = document.createElement('td')
      tdExisting.textContent = formatWcExistingScoreDisplay(row)
      const tdNew = document.createElement('td')
      tdNew.textContent = formatWcNewValueDisplay(row)
      const tdStatus = document.createElement('td')
      tdStatus.textContent = row.status
      tr.append(tdNumber, tdName, tdKruname, tdExisting, tdNew, tdStatus)
      return tr
    }),
  )
  wcPreviewEl.hidden = false

  const subjectClassroomMatch = evaluateCurrentSubjectClassroomMatch()
  renderWcSubjectClassroomCheck(subjectClassroomMatch)

  wcGateReasonEl.hidden = true
  wcWriteWarningEl.hidden = true
  wcConfirmCheckbox.checked = false
  wcConfirmCheckbox.disabled = true
  wcWriteBtn.disabled = true
  wcConfirmedContext = null

  const preconditions = evaluateWholeColumnPreconditions({
    subjectClassroomOk: subjectClassroomMatch === null ? true : subjectClassroomMatch.ok,
    columnWritableNow: candidate.writableScoreColumns.some((c) => c.key === column.key),
    headerCheckboxOk: !column.headerCheckboxPresent || column.headerCheckboxChecked === true,
    plan,
  })

  if (!preconditions.ok) {
    wcGateReasonEl.textContent = preconditions.reason
    wcGateReasonEl.hidden = false
    return
  }

  wcWriteWarningEl.hidden = false
  wcConfirmCheckbox.disabled = false
  wcConfirmedContext = {
    tableIndex: candidate.tableIndex,
    run: candidate.run,
    columnIndex: column.columnIndex,
    columnKey: column.key,
    subjectFilterText: currentGridFacts.subjectFilter?.selectedText ?? null,
    classroomFilterText: currentGridFacts.classroomFilter?.selectedText ?? null,
    plan,
  }
}

/** Same "KrunameClass: ... / SGS: ... / ผลตรวจ: ..." shape as
 * renderSubjectClassroomCheck (section 5), rendered into this section's
 * OWN elements so the two safety checks never share DOM state. */
function renderWcSubjectClassroomCheck(result) {
  if (!result) {
    wcSubjectClassroomCheckEl.hidden = true
    return
  }
  wcCheckSubjectKrunameEl.textContent = loadedPayload?.subjectName || '-'
  wcCheckSubjectSgsEl.textContent = currentGridFacts?.subjectFilter?.selectedText || '-'
  wcCheckSubjectResultEl.textContent = describeMatchVerdict(result.subject)
  wcCheckClassroomKrunameEl.textContent = result.classroom.krunameLabel ?? (loadedPayload?.classroomName || '-')
  wcCheckClassroomSgsEl.textContent = result.classroom.sgsLabel ?? '-'
  wcCheckClassroomResultEl.textContent = describeMatchVerdict(result.classroom)
  wcSubjectClassroomCheckEl.hidden = false
}

/** Scans the current page fresh, then renders the preview/gates from
 * that scan — the ONE function both "ส่งคอลัมน์นี้ทั้งห้อง" (a brand new
 * session) and "ดำเนินการต่อ" (the next SGS page of the SAME session)
 * call, so every page — including the first — is scanned/validated
 * identically (item 4: "scan current page ... re-scan DOM ... revalidate
 * subject/classroom/column"). */
async function runWholeColumnPageScanAndPreview() {
  wcGateReasonEl.hidden = true
  wcPreviewEl.hidden = true
  const ok = await scanCurrentSgsPageForWholeColumn()
  if (!ok) return
  renderWholeColumnPreviewFromScan()
}

/** The write button's own gate, same "preconditions AND explicit
 * consent" ordering as canEnableSingleCellTestWrite. */
function updateWholeColumnWriteButtonState() {
  wcWriteBtn.disabled = !canEnableWholeColumnWrite(wcConfirmedContext !== null, wcConfirmCheckbox.checked)
}

/** Returns the confirm checkbox/write button to their safe default after
 * a write attempt (of any outcome) or a stale-DOM abort — a fresh
 * "ส่งคอลัมน์นี้ทั้งห้อง"/"ดำเนินการต่อ" is required before another write,
 * never a "confirm again" shortcut. */
function disarmWholeColumnWrite() {
  wcConfirmedContext = null
  wcConfirmCheckbox.checked = false
  wcConfirmCheckbox.disabled = true
  wcWriteBtn.disabled = true
}

function renderWholeColumnResult() {
  wcResultWrittenEl.textContent = String(wcCumulativeSummary.written)
  wcResultSkipNoScoreEl.textContent = String(wcCumulativeSummary.skippedNoScore)
  wcResultSkipExistingEl.textContent = String(wcCumulativeSummary.skippedExisting)
  wcResultNotFoundEl.textContent = String(wcCumulativeSummary.notFound)
  wcResultAmbiguousEl.textContent = String(wcCumulativeSummary.ambiguous)
  wcResultFailedEl.textContent = String(wcCumulativeSummary.failed)
  wcResultEl.hidden = false

  if (wcCumulativeFailedStudents.length > 0) {
    wcFailedListEl.replaceChildren(
      ...wcCumulativeFailedStudents.map((s) => {
        const li = document.createElement('li')
        li.textContent = `${s.studentNumber ?? '-'} ${s.fullName}`
        return li
      }),
    )
    wcFailedListEl.hidden = false
  } else {
    wcFailedListEl.replaceChildren()
    wcFailedListEl.hidden = true
  }
}

/**
 * The ONE live write action for whole-column mode this phase. Every
 * write instruction it produces (buildWholeColumnWriteInstructions)
 * carries the SAME columnIndex confirmed at preview time — structurally,
 * there is no path here capable of writing a second column. Re-validates
 * against a FRESH scan immediately before writing (item 5's "guard
 * against stale DOM", one level up from the single-cell test's own),
 * writes, waits briefly, reads the column back, and records a per-student
 * outcome — never trusting the DOM write call's own optimistic count
 * alone (see verifyWholeColumnWrite's own doc comment). Never clicks
 * Save, never touches the SGS header checkbox, never navigates pages.
 */
async function runWholeColumnWrite() {
  if (!wcConfirmedContext) return
  if (!canEnableWholeColumnWrite(true, wcConfirmCheckbox.checked)) return
  const context = wcConfirmedContext
  wcWriteBtn.disabled = true

  const { candidate: freshCandidate } = await performLiveGridScan()
  const freshColumn = freshCandidate ? locateColumnOnCurrentPage(freshCandidate.writableScoreColumns, context.columnKey) : null
  const revalidation = revalidateWholeColumnContext(
    { subjectFilterText: context.subjectFilterText, classroomFilterText: context.classroomFilterText, columnKey: context.columnKey },
    {
      subjectFilterText: currentGridFacts?.subjectFilter?.selectedText ?? null,
      classroomFilterText: currentGridFacts?.classroomFilter?.selectedText ?? null,
      columnKey: freshColumn ? freshColumn.key : null,
    },
  )
  if (!revalidation.ok) {
    wcGateReasonEl.textContent = `ยกเลิกการเขียน: ${revalidation.reason}`
    wcGateReasonEl.hidden = false
    disarmWholeColumnWrite()
    return
  }

  const { writesByOffset } = buildWholeColumnWriteInstructions(context.plan, context.columnIndex)

  const tab = await getActiveTab()
  const [writeInjection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: fillSgsColumnValues,
    args: [context.tableIndex, context.run.startIndex, context.columnIndex, writesByOffset],
  })
  const fillResult = writeInjection.result

  // Best-effort pause for SGS's own input/change handlers (and any
  // client-side reformatting) to settle before the verification read —
  // NOT a confirmed "autosave network request finished" signal (no such
  // signal has ever been confirmed live); the read-back below, not this
  // delay, is what actually decides success per student.
  await new Promise((resolve) => setTimeout(resolve, 400))

  const [readInjection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: readColumnValues,
    args: [context.tableIndex, context.run.startIndex, context.run.length, context.columnIndex],
  })
  const freshValuesResult = readInjection.result

  const verifiedPlan = verifyWholeColumnWrite(context.plan, writesByOffset, fillResult, freshValuesResult)
  const pageSummary = summarizeWholeColumnResult(verifiedPlan)
  wcCumulativeSummary = mergeWholeColumnSummaries(wcCumulativeSummary, pageSummary)
  wcCumulativeFailedStudents = wcCumulativeFailedStudents.concat(collectFailedStudents(verifiedPlan))

  disarmWholeColumnWrite()
  wcPreviewEl.hidden = true

  // Item 4: never auto-navigates — currentPagination here reflects the
  // fresh scan taken above, right before this page's write.
  const pagination = currentPagination
  const hasMorePages = Boolean(
    pagination && pagination.detected && pagination.currentPage !== null && pagination.totalPages !== null && pagination.currentPage < pagination.totalPages,
  )

  if (hasMorePages) {
    wcPaginationMessageEl.textContent = `หน้าที่ ${pagination.currentPage} เสร็จแล้ว กรุณาเปิดหน้าที่ ${pagination.currentPage + 1} แล้วกด "ดำเนินการต่อ"`
    wcPaginationContinueWrap.hidden = false
  } else {
    wcPaginationContinueWrap.hidden = true
  }
  renderWholeColumnResult()
}

wcStartBtn.addEventListener('click', () => {
  wcConfirmedColumnKey = confirmedRealColumn ? confirmedRealColumn.key : null
  wcCumulativeSummary = emptyWholeColumnSummary()
  wcCumulativeFailedStudents = []
  wcResultEl.hidden = true
  wcFailedListEl.hidden = true
  wcFailedListEl.replaceChildren()
  wcPaginationContinueWrap.hidden = true
  void runWholeColumnPageScanAndPreview()
})

wcContinueBtn.addEventListener('click', () => {
  wcPaginationContinueWrap.hidden = true
  void runWholeColumnPageScanAndPreview()
})

// Toggling the overwrite choice only ever changes THIS section's own
// plan — never loadedPayload.overwriteMode (the original payload-level
// setting used by the read-only section 4 preview), and never re-scans
// the DOM (the already-scanned wcPageScan is reused).
wcOverwriteCheckbox.addEventListener('change', () => {
  if (wcPageScan) renderWholeColumnPreviewFromScan()
})

wcConfirmCheckbox.addEventListener('change', () => {
  updateWholeColumnWriteButtonState()
})

wcWriteBtn.addEventListener('click', () => {
  void runWholeColumnWrite()
})

// ==================================================
// NEXT PHASE — section 7: safe fully-automatic multi-page run. Reuses
// scanCurrentSgsPageForColumn/computeWholeColumnPlan/
// revalidateWholeColumnContext/locateColumnOnCurrentPage/
// collectFailedStudents from section 6 UNCHANGED — this section only
// adds the loop, the stop-condition checks (auto-run.js), and the
// per-cell sequential write+verify (item 7: never batched, because a
// batch gives no place to show live per-student progress or to stop
// mid-page cleanly).
// ==================================================

/**
 * item 2: builds the pre-run preview from a FRESH scan of whatever SGS
 * page is currently open (always the CURRENT page — the run itself
 * always starts from wherever the teacher has SGS open right now, per
 * section 6's own convention). Never starts the run itself.
 */
async function runAutoRunPreRunPreview() {
  arConfirmedColumnKey = confirmedRealColumn ? confirmedRealColumn.key : null
  arAbortReasonEl.hidden = true
  arFinalSummaryEl.hidden = true
  arProgressEl.hidden = true
  arManualContinueWrap.hidden = true
  arPrerunEl.hidden = true

  const scan = await scanCurrentSgsPageForColumn(arConfirmedColumnKey)
  if (!scan.ok || !loadedPayload) {
    arAbortReasonEl.textContent = scan.reason ?? 'กรุณาโหลด Bridge Payload ก่อน'
    arAbortReasonEl.hidden = false
    return
  }

  // BUG FIX (item 3/4): a run must never start against a page whose own
  // pagination couldn't be confidently read — an unknown current/total
  // page previously still let the teacher start, ending up stuck showing
  // "หน้า ? / ?" with nothing ever written. Checked here, BEFORE the
  // prerun panel/run button ever appear, and re-checked again by
  // content-script.js itself right before it writes page 1 (in case the
  // page changed between this preview and the actual click).
  if (!isPaginationReadyForAutoRun(currentPagination)) {
    arAbortReasonEl.textContent = PAGINATION_UNKNOWN_MESSAGE
    arAbortReasonEl.hidden = false
    arRunBtn.disabled = true
    return
  }

  const { candidate, column, existingScoresBySgsRowKey } = scan.pageScan
  const winningTable = currentGridFacts.tables.find((t) => t.tableIndex === candidate.tableIndex)
  const sgsCandidates = winningTable ? extractSgsStudentCandidates(winningTable, candidate.run, candidate.identifierColumns) : []
  const roster = buildFullRosterFromPayload(loadedPayload)
  const krunameStudents = roster.map((r) => ({
    studentId: r.studentId,
    studentNumber: r.studentNumber,
    studentCode: r.studentCode,
    fullName: r.fullName,
    score: r.score,
  }))
  const mappingResults = matchStudentsToSgs(krunameStudents, sgsCandidates)
  const overwriteMode = arOverwriteCheckbox.checked ? 'overwrite_selected_column' : 'skip_existing'
  const plan = computeWholeColumnPlan(krunameStudents, mappingResults, existingScoresBySgsRowKey, overwriteMode, column.maxScore)
  const preRun = buildAutoRunPreRunSummary(plan, currentPagination, krunameStudents.length)

  arSubjectEl.textContent = loadedPayload.subjectName || '-'
  arClassroomEl.textContent = loadedPayload.classroomName || '-'
  arColumnEl.textContent = column.label
  arMaxScoreEl.textContent = column.maxScore !== null && column.maxScore !== undefined ? String(column.maxScore) : 'ไม่ทราบ'
  arRosterCountEl.textContent = String(preRun.rosterCount)
  arToSendEl.textContent = String(preRun.toSend)
  arNoScoreEl.textContent = String(preRun.noScore)
  arExistingSkipEl.textContent = String(preRun.existingToSkip)
  arTotalPagesEl.textContent = preRun.sgsTotalPages !== null ? String(preRun.sgsTotalPages) : 'ไม่ทราบ'
  arTotalSgsStudentsEl.textContent = preRun.sgsTotalStudents !== null ? String(preRun.sgsTotalStudents) : 'ไม่ทราบ'

  arPrerunEl.hidden = false
  updateAutoRunConfirmGate()
}

/** item 2's two explicit consent checkboxes — BOTH required before
 * "เริ่มส่งครบทั้งห้อง" enables, same "preconditions AND explicit consent"
 * ordering as every other write gate in this file. */
function updateAutoRunConfirmGate() {
  arRunBtn.disabled = !(arConfirmSubjectClassroomCheckbox.checked && arConfirmAutosaveCheckbox.checked)
}

function renderAutoRunLiveProgress(currentPageNumber, totalPages, processedCount, rosterCount, runningSummary) {
  arProgressPageEl.textContent = `หน้า ${currentPageNumber ?? '?'} / ${totalPages ?? '?'}`
  arProgressStudentsEl.textContent = `นักเรียนที่ประมวลผล ${processedCount} / ${rosterCount}`
  arProgressWrittenEl.textContent = String(runningSummary.written)
  arProgressSkipNoScoreEl.textContent = String(runningSummary.skippedNoScore)
  arProgressSkipExistingEl.textContent = String(runningSummary.skippedExisting)
  arProgressNotFoundEl.textContent = String(runningSummary.notFound)
  arProgressAmbiguousEl.textContent = String(runningSummary.ambiguous)
  arProgressFailedEl.textContent = String(runningSummary.failed)
}

/** item 7's final summary + the downloadable/copyable run report — built
 * entirely from background.js's own reported state (never a local loop
 * variable — there is no local loop any more). Rendered for every
 * terminal status (completed, stopped_by_user, aborted), never only on a
 * clean finish, so partial progress is never silently lost. */
function renderAutoRunFinalSummary(state) {
  const rosterCount = state.payload ? buildFullRosterFromPayload(state.payload).length : state.allStudentResults.length
  const summary = state.summary ?? emptyAutoRunSummary()
  arFinalTotalEl.textContent = String(rosterCount)
  arFinalWrittenEl.textContent = String(summary.written)
  arFinalSkipNoScoreEl.textContent = String(summary.skippedNoScore)
  arFinalSkipExistingEl.textContent = String(summary.skippedExisting)
  arFinalInvalidEl.textContent = String(summary.invalidScore)
  arFinalNotFoundEl.textContent = String(summary.notFound)
  arFinalAmbiguousEl.textContent = String(summary.ambiguous)
  arFinalFailedEl.textContent = String(summary.failed)
  arFinalPagesEl.textContent = `ประมวลผลหน้า: ${state.pagesProcessed.length > 0 ? state.pagesProcessed.join(', ') : '-'}`
  arFinalSummaryEl.hidden = false

  const report = buildAutoRunReport({
    subjectName: state.subject ?? null,
    classroomName: state.classroom ?? null,
    columnLabel: state.targetColumn?.label ?? null,
    pagesProcessed: state.pagesProcessed,
    perStudentResults: state.allStudentResults,
  })
  arReportOutput.value = JSON.stringify(report, null, 2)
}

/**
 * item 3: the ONE place popup.js turns background.js's own run state
 * into UI — called after every AR_* request/response round trip and
 * every AR_STATE_CHANGED broadcast, so this popup can never show
 * anything background.js doesn't itself currently believe. `null` (no
 * run recorded for this tab) hides every run-in-progress/finished panel,
 * leaving only the pre-run preview (runAutoRunPreRunPreview's own
 * domain) visible.
 */
function renderAutoRunFromState(state) {
  if (!state) {
    arProgressEl.hidden = true
    arManualContinueWrap.hidden = true
    arStopBtn.disabled = true
    return
  }

  autoRunWrap.hidden = false
  const rosterCount = state.payload ? buildFullRosterFromPayload(state.payload).length : state.allStudentResults.length
  const processedCount = state.allStudentResults.length
  const runningSummary = state.summary ?? emptyAutoRunSummary()

  if (state.status === 'running') {
    arPrerunEl.hidden = true
    arManualContinueWrap.hidden = true
    arAbortReasonEl.hidden = true
    arFinalSummaryEl.hidden = true
    arProgressEl.hidden = false
    arStopBtn.disabled = false
    renderAutoRunLiveProgress(state.currentPage, state.totalPages, processedCount, rosterCount, runningSummary)
    return
  }

  if (state.status === 'paused_manual') {
    arPrerunEl.hidden = true
    arAbortReasonEl.hidden = true
    arFinalSummaryEl.hidden = true
    arProgressEl.hidden = false
    arStopBtn.disabled = false
    renderAutoRunLiveProgress(state.currentPage, state.totalPages, processedCount, rosterCount, runningSummary)
    arManualContinueMessageEl.textContent = `หน้าที่ ${state.currentPage ?? '?'} เสร็จแล้ว กรุณาเปิดหน้าที่ ${state.expectedNextPage ?? '?'} แล้วกด "ดำเนินการต่อ" (${state.pauseReason ?? ''})`
    arManualContinueWrap.hidden = false
    return
  }

  // Terminal: completed / stopped_by_user / aborted (items 7/8).
  arProgressEl.hidden = true
  arManualContinueWrap.hidden = true
  arStopBtn.disabled = true

  if (state.status === 'aborted') {
    arAbortReasonEl.textContent = `หยุดการทำงานเพื่อความปลอดภัย\nเหตุผล: ${state.abortReason}`
    arAbortReasonEl.hidden = false
  } else if (state.status === 'stopped_by_user') {
    arAbortReasonEl.textContent = 'หยุดการทำงานตามคำสั่งผู้ใช้ (กด "หยุด")'
    arAbortReasonEl.hidden = false
  } else {
    arAbortReasonEl.hidden = true
  }
  renderAutoRunFinalSummary(state)
}

arStartBtn.addEventListener('click', () => {
  void runAutoRunPreRunPreview()
})

arOverwriteCheckbox.addEventListener('change', () => {
  void runAutoRunPreRunPreview()
})

arConfirmSubjectClassroomCheckbox.addEventListener('change', () => {
  updateAutoRunConfirmGate()
})
arConfirmAutosaveCheckbox.addEventListener('change', () => {
  updateAutoRunConfirmGate()
})

/**
 * item 3: the ONE place a run is ever started — sends the teacher's
 * explicit approval (subject/classroom/targetColumn/payload/
 * overwriteMode, plus which tab this run belongs to) to background.js,
 * which stores it and immediately kicks off content-script.js already
 * loaded in that tab (item 4). This popup never runs the loop itself —
 * after this one message, everything continues even if this popup
 * closes.
 */
arRunBtn.addEventListener('click', () => {
  void (async () => {
    if (!loadedPayload || !confirmedRealColumn) return
    arPrerunEl.hidden = true
    const tab = await getActiveTab()
    const response = await chrome.runtime
      .sendMessage({
        type: AR_MESSAGE.START,
        tabId: tab.id,
        subject: loadedPayload.subjectName,
        classroom: loadedPayload.classroomName,
        targetColumn: { key: confirmedRealColumn.key, label: confirmedRealColumn.label, maxScore: confirmedRealColumn.maxScore },
        payload: loadedPayload,
        overwriteMode: arOverwriteCheckbox.checked ? 'overwrite_selected_column' : 'skip_existing',
      })
      .catch(() => null)
    renderAutoRunFromState(response?.state ?? null)
  })()
})

/** item 6: the teacher's own click after a manual-pause fallback — tells
 * background.js to resume, which forwards the resume to whichever
 * content-script.js instance is still loaded in that tab (the page never
 * navigated away while paused — a pause is exactly what a failed/
 * unconfirmed page-advance attempt produces, never a real navigation). */
arManualContinueBtn.addEventListener('click', () => {
  void (async () => {
    arManualContinueWrap.hidden = true
    const tab = await getActiveTab()
    const response = await chrome.runtime.sendMessage({ type: AR_MESSAGE.MANUAL_CONTINUE, tabId: tab.id }).catch(() => null)
    renderAutoRunFromState(response?.state ?? null)
  })()
})

/** item 6: only ever asks background.js to set a flag — never itself
 * stops a write in flight. content-script.js is what actually checks
 * this flag between atomic cell writes and decides to finish the current
 * cell then stop. */
arStopBtn.addEventListener('click', () => {
  arStopBtn.disabled = true
  void (async () => {
    const tab = await getActiveTab()
    const response = await chrome.runtime.sendMessage({ type: AR_MESSAGE.STOP, tabId: tab.id }).catch(() => null)
    renderAutoRunFromState(response?.state ?? null)
  })()
})

arCopyReportBtn.addEventListener('click', async () => {
  if (!arReportOutput.value) return
  await navigator.clipboard.writeText(arReportOutput.value)
})

/** item 3: background.js pushes this on every state change so an OPEN
 * popup always reflects a run's live progress — even progress made while
 * content-script.js advanced through a page reload this popup never saw
 * happen. */
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === AR_MESSAGE.STATE_CHANGED) {
    renderAutoRunFromState(message.state)
  }
})

async function restoreSessionPayload() {
  const stored = await chrome.storage.session.get(SESSION_PAYLOAD_KEY)
  const payload = stored[SESSION_PAYLOAD_KEY]
  if (payload && validateAnySgsBridgePayload(payload).validation.ok) {
    loadedPayload = normalizeLoadedPayload(payload)
    renderPreview(loadedPayload)
  }
}

/**
 * item 3/4: on every popup open, asks background.js what it currently
 * knows about a run for the CURRENTLY active tab and renders exactly
 * that — never a guess, never anything reconstructed from a previous
 * popup session's own local state (there is none any more; background.js
 * is the only place a run's state has ever lived since item 3).
 */
async function restoreAutoRunStateFromBackground() {
  const tab = await getActiveTab()
  const response = await chrome.runtime.sendMessage({ type: AR_MESSAGE.GET_STATE, tabId: tab?.id ?? null }).catch(() => null)
  renderAutoRunFromState(response?.state ?? null)
}

void refreshStatus()
void restoreSessionPayload().then(() => restoreAutoRunStateFromBackground())
