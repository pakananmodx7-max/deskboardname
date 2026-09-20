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
import { matchStudentsToSgs } from './lib/mapping.js'
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
  matchTargetColumnToRealColumns,
  pickBestStudentGridCandidate,
  sgsRowIndexFromKey,
} from './lib/sgs-table-extraction.js'

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
const mappingResultTable = document.getElementById('mapping-result')
const mappingResultBody = document.getElementById('mapping-result-body')
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
 * Rebuilds the FULL roster (graded + skipped) from the payload's two
 * lists — `students` (score field) and `skippedStudentIds` (no score at
 * all, always null here) — so any preview built from this shows every
 * student, not just the ones that will actually transfer. Shared by the
 * Phase 1.5 payload-only preview and the Phase 2 real-page preview so
 * the two never build the roster two different ways.
 */
function buildFullRosterFromPayload(payload) {
  return [
    ...payload.students.map((s) => ({
      studentId: s.studentId,
      studentNumber: s.studentNumber,
      fullName: s.fullName,
      krunameScore: s.score,
      score: s.score,
    })),
    ...payload.skippedStudentIds.map((s) => ({
      studentId: s.studentId,
      studentNumber: s.studentNumber,
      fullName: s.fullName,
      krunameScore: null,
      score: null,
    })),
  ]
}

function parseIntOrNull(text) {
  if (!text) return null
  const parsed = parseInt(text, 10)
  return Number.isFinite(parsed) ? parsed : null
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
}

function resetRealInspectionState() {
  currentGridFacts = null
  currentGridCandidate = null
  confirmedRealColumn = null
  realPlan = null
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

function renderMappingResult(payload) {
  const krunameStudents = payload.students.map((s) => ({
    studentId: s.studentId,
    studentNumber: s.studentNumber,
    fullName: s.fullName,
    score: s.score,
  }))
  // sgsCandidates is deliberately empty: Phase 5 (structural diagnostic)
  // hasn't yet told us which selectors safely expose real SGS student
  // rows, and this prototype never invents one — every result below is
  // therefore honestly NOT_FOUND until that's wired up.
  const results = matchStudentsToSgs(krunameStudents, [])

  mappingResultBody.replaceChildren(
    ...results.map((result) => {
      const tr = document.createElement('tr')
      const tdSgs = document.createElement('td')
      tdSgs.textContent = result.matchedSgsRowKey ?? '— (ยังไม่เชื่อมต่อข้อมูลจริงจาก SGS)'
      const tdKruname = document.createElement('td')
      tdKruname.textContent = `${result.studentNumber ?? '-'} ${result.fullName}`
      const tdScore = document.createElement('td')
      tdScore.textContent = String(result.score)
      const tdStatus = document.createElement('td')
      tdStatus.textContent = result.status
      tr.append(tdSgs, tdKruname, tdScore, tdStatus)
      return tr
    }),
  )
  mappingResultTable.hidden = false
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

  const tab = await getActiveTab()
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: collectAllTableRowFacts,
  })
  const facts = injection.result
  currentGridFacts = facts

  const candidate = pickBestStudentGridCandidate(facts.tables)
  currentGridCandidate = candidate

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
async function runColumnPreview() {
  if (!confirmedRealColumn || !loadedPayload || !currentGridCandidate || !currentGridFacts) return
  if (!gridMeetsFillRequirements(currentGridCandidate)) return
  if (!isConfirmedColumnWritable(currentGridCandidate, confirmedRealColumn)) return

  const { tableIndex, run, identifierColumns } = currentGridCandidate

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
  const winningTable = currentGridFacts.tables.find((t) => t.tableIndex === tableIndex)
  const rowsInRun = winningTable.rows.slice(run.startIndex, run.startIndex + run.length)
  const sgsCandidates = rowsInRun.map((cells, offset) => ({
    sgsRowKey: buildSgsRowKey(offset),
    sgsStudentNumber: parseIntOrNull(cells[identifierColumns.numberColumnIndex]?.text),
    sgsStudentId: cells[identifierColumns.codeColumnIndex]?.text || null,
    sgsFullNameRaw: cells[identifierColumns.nameColumnIndex]?.text || '',
  }))

  const roster = buildFullRosterFromPayload(loadedPayload)
  const krunameStudents = roster.map((r) => ({
    studentId: r.studentId,
    studentNumber: r.studentNumber,
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
      tdStatus.textContent = row.mappingStatus
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
  if (loadedPayload) renderMappingResult(loadedPayload)
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

async function restoreSessionPayload() {
  const stored = await chrome.storage.session.get(SESSION_PAYLOAD_KEY)
  const payload = stored[SESSION_PAYLOAD_KEY]
  if (payload && validateAnySgsBridgePayload(payload).validation.ok) {
    loadedPayload = normalizeLoadedPayload(payload)
    renderPreview(loadedPayload)
  }
}

void refreshStatus()
void restoreSessionPayload()
