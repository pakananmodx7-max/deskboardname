import {
  buildSgsColumnWriteInstructions,
  computeSgsColumnFillPlan,
  formatSgsExistingScoreDisplay,
  formatSgsNewValueDisplay,
} from './lib/column-fill.js'
import { collectRawSgsFacts } from './content-diagnostic.js'
import { buildDiagnosticReport, formatDiagnosticReportForCopy } from './lib/diagnostic-report.js'
import { matchStudentsToSgs } from './lib/mapping.js'
import { validateSgsBridgePayload } from './lib/payload-validation.js'

const DEFAULT_SGS_KEYWORD = 'sgs'
const SESSION_PAYLOAD_KEY = 'sgsBridgeLoadedPayload'

const OVERWRITE_MODE_LABEL = {
  skip_existing: 'ข้ามคะแนนที่มีอยู่แล้ว',
  overwrite_selected_column: 'เขียนทับเฉพาะช่องที่เลือก',
}

/**
 * The extension can't yet read the live SGS page's actual column values
 * (Phase 5's diagnostic mode exists, but Phase 2's real selectors don't
 * yet) — so, exactly like sgs-export-dialog.tsx on the KrunameClass
 * side, every existing-value lookup here is honestly empty for now.
 * Once real selectors exist, only this becomes a real DOM read; nothing
 * else in computeSgsColumnFillPlan/buildSgsColumnWriteInstructions needs
 * to change.
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
const diagnosticOutput = document.getElementById('diagnostic-output')
const copyDiagnosticBtn = document.getElementById('copy-diagnostic')

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

  // Rebuilds the FULL roster view (graded + skipped) the same way
  // KrunameClass's own preview does, from the payload's two lists —
  // `students` (score field) and `skippedStudentIds` (no score at all,
  // always null here) — so a teacher sees every student, not just the
  // ones that will actually transfer.
  const rows = [
    ...payload.students.map((s) => ({
      studentId: s.studentId,
      studentNumber: s.studentNumber,
      fullName: s.fullName,
      krunameScore: s.score,
    })),
    ...payload.skippedStudentIds.map((s) => ({
      studentId: s.studentId,
      studentNumber: s.studentNumber,
      fullName: s.fullName,
      krunameScore: null,
    })),
  ]

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

async function loadPayloadFromFile(file) {
  payloadErrorEl.hidden = true
  previewEl.hidden = true
  loadedPayload = null
  mappingBtn.disabled = true

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

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  if (file) void loadPayloadFromFile(file)
})

mappingBtn.addEventListener('click', () => {
  if (loadedPayload) renderMappingResult(loadedPayload)
})

diagnosticBtn.addEventListener('click', async () => {
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
