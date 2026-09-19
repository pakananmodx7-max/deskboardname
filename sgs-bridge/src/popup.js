import {
  buildSgsColumnWriteInstructions,
  computeSgsColumnFillPlan,
  formatSgsExistingScoreDisplay,
  formatSgsNewValueDisplay,
} from './lib/column-fill.js'
import { collectAllTableRowFacts, collectRawSgsFacts, fillSgsColumnValues, readColumnValues } from './content-diagnostic.js'
import {
  buildCompactStudentGridReport,
  buildDiagnosticReport,
  buildStudentGridDebugReport,
  formatDiagnosticReportForCopy,
} from './lib/diagnostic-report.js'
import { matchStudentsToSgs } from './lib/mapping.js'
import { validateSgsBridgePayload } from './lib/payload-validation.js'
import {
  buildSgsRealWriteInstructions,
  computeSgsRealFillPlan,
  formatSgsExistingScoreDisplay as formatRealExistingScoreDisplay,
  formatSgsNewValueDisplay as formatRealNewValueDisplay,
  summarizeSgsRealFillPlan,
} from './lib/sgs-real-fill.js'
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
const realFillPreviewWrap = document.getElementById('real-fill-preview-wrap')
const realFillPreviewBody = document.getElementById('real-fill-preview-body')
const fillBtn = document.getElementById('fill-selected-column')
const fillResultEl = document.getElementById('fill-result')

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
 * consumed by runFillSelectedColumn(). */
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

function renderPreview(payload) {
  document.getElementById('preview-subject').textContent = payload.subjectName
  document.getElementById('preview-classroom').textContent = payload.classroomName
  document.getElementById('preview-assignment').textContent = payload.assignmentTitle
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
  realFillPreviewWrap.hidden = true
  realFillPreviewBody.replaceChildren()
  fillBtn.disabled = true
  fillResultEl.hidden = true
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

  const validation = validateSgsBridgePayload(parsed)
  if (!validation.ok) {
    payloadErrorEl.textContent = `ไฟล์ไม่ผ่านการตรวจสอบ: ${validation.errors.join(', ')}`
    payloadErrorEl.hidden = false
    return
  }

  loadedPayload = parsed
  renderPreview(parsed)
  // Session storage only — cleared when the browser closes, never
  // synced, never contains a credential (validateSgsBridgePayload
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
 * Item 7 of the spec: the fill button must stay disabled/hidden until
 * studentGrid.found === true AND number/code/name are all confidently
 * identified AND at least one score column exists. Checked again right
 * before rendering the picker/preview, not just once at the top.
 */
function gridMeetsFillRequirements(candidate) {
  if (!candidate) return false
  const { numberColumnIndex, codeColumnIndex, nameColumnIndex } = candidate.identifierColumns
  return numberColumnIndex !== null && codeColumnIndex !== null && nameColumnIndex !== null && candidate.scoreColumns.length > 0
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
 * an AMBIGUOUS or NOT_FOUND match, and NEVER enables the fill button
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
  if (candidate.scoreColumns.length === 0) {
    realInspectErrorEl.textContent = 'พบตารางนักเรียนแต่ไม่พบคอลัมน์คะแนนที่มีช่องกรอกข้อมูล'
    realInspectErrorEl.hidden = false
    return
  }

  const warnings = buildGridWarnings(candidate)
  if (warnings.length > 0) {
    realColumnMatchWarningEl.textContent = `พบตารางแต่ยังไม่มั่นใจทั้งหมด (ความเชื่อมั่น: ${computeGridConfidence(candidate)}): ${warnings.join(', ')}`
    realColumnMatchWarningEl.hidden = false
  }

  const matchResult = matchTargetColumnToRealColumns(loadedPayload.targetColumn.label, candidate.scoreColumns)
  renderRealColumnPicker(candidate.scoreColumns, matchResult)

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

function renderRealColumnPicker(candidates, matchResult) {
  realColumnPickerEl.replaceChildren(
    ...candidates.map((candidate) => {
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
}

/**
 * Reads `confirmedRealColumn.columnIndex`'s CURRENT values for the SAME
 * confirmed table/row-range currentGridInspection already found — never
 * any other column's, and never a fresh re-guess of which table is the
 * grid (that was already confirmed in runRealColumnInspection). Builds
 * the REAL preview (item 7 of the spec) from actually-matched SGS rows,
 * and only enables the fill button when gridMeetsFillRequirements
 * passed (item 7's gate).
 */
async function runColumnPreview() {
  if (!confirmedRealColumn || !loadedPayload || !currentGridCandidate || !currentGridFacts) return
  if (!gridMeetsFillRequirements(currentGridCandidate)) return

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
}

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
  // Item 7 of the spec: never enabled unless studentGrid.found AND
  // number/code/name are all confidently identified AND at least one
  // score column exists — checked again here, not just once upstream.
  fillBtn.disabled = !gridMeetsFillRequirements(currentGridCandidate)
  fillResultEl.hidden = true
}

/**
 * Item 8-11 of the spec: builds the write list for ONLY
 * confirmedRealColumn (never a different column), calls
 * fillSgsColumnValues with that one columnIndex, and reports the five
 * required result buckets. Never clicks Save — see
 * fillSgsColumnValues's own doc comment in content-diagnostic.js.
 */
async function runFillSelectedColumn() {
  if (!confirmedRealColumn || !realPlan || !currentGridCandidate) return
  if (!gridMeetsFillRequirements(currentGridCandidate)) return

  const instructions = buildSgsRealWriteInstructions(realPlan, confirmedRealColumn.key)
  const writesByOffset = {}
  for (const instruction of instructions) {
    const offset = sgsRowIndexFromKey(instruction.sgsRowKey)
    if (offset !== null) writesByOffset[offset] = instruction.value
  }

  const { tableIndex, run } = currentGridCandidate
  const tab = await getActiveTab()
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: fillSgsColumnValues,
    args: [tableIndex, run.startIndex, confirmedRealColumn.columnIndex, writesByOffset],
  })
  const domResult = injection.result
  const summary = summarizeSgsRealFillPlan(realPlan)

  const lines = [
    `จับคู่ได้ (matched): ${summary.matched}`,
    `กรอกแล้ว (written): ${summary.written}`,
    `ข้าม — ไม่มีคะแนน (skipped no score): ${summary.skippedNoScore}`,
    `ข้าม — มีคะแนนเดิมอยู่แล้ว (skipped existing): ${summary.skippedExisting}`,
    `จับคู่ไม่ได้/ไม่แน่ใจ (ambiguous/not found): ${summary.ambiguousOrNotFound}`,
  ]
  if (domResult.writtenCount !== summary.written) {
    lines.push(`คำเตือน: หน้า SGS รายงานว่ากรอกได้จริง ${domResult.writtenCount} ช่อง (ต่างจากแผนที่คำนวณไว้)`)
  }
  if (domResult.missingOffsets.length > 0) {
    lines.push(`ไม่พบช่องกรอกคะแนนสำหรับแถวลำดับ: ${domResult.missingOffsets.join(', ')}`)
  }
  lines.push('โปรดตรวจสอบผลลัพธ์ในหน้า SGS แล้วกดบันทึกด้วยตนเอง — ระบบไม่กดบันทึกให้อัตโนมัติ')

  fillResultEl.replaceChildren(...lines.map((line) => Object.assign(document.createElement('p'), { textContent: line })))
  fillResultEl.hidden = false
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

fillBtn.addEventListener('click', () => {
  void runFillSelectedColumn()
})

async function restoreSessionPayload() {
  const stored = await chrome.storage.session.get(SESSION_PAYLOAD_KEY)
  const payload = stored[SESSION_PAYLOAD_KEY]
  if (payload && validateSgsBridgePayload(payload).ok) {
    loadedPayload = payload
    renderPreview(payload)
  }
}

void refreshStatus()
void restoreSessionPayload()
