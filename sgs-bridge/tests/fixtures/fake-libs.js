/**
 * A single stand-in for all eight modules content-script.js loads via
 * `import(chrome.runtime.getURL(...))`. Because content-script.js does
 * every DOM read through those libs (it touches only `window` and
 * `location` directly), handing it this module for ALL eight URLs lets
 * the REAL PROCESS_CURRENT_PAGE pipeline run end to end in Node — no
 * jsdom, no browser, no reimplementation of the handler under test.
 *
 * Each function's behavior is overridable per test through the shared
 * `fakeLibsControl` object below, so one fixture covers both the happy
 * path and "this exact step throws" failure injection.
 */

/**
 * Control state lives on globalThis, NOT in this module's own scope: the
 * test file imports this module directly, while content-script.js imports
 * it again through chrome.runtime.getURL AFTER vi.resetModules(), which
 * can hand out a second, separate module instance. A module-scoped object
 * would therefore be two different objects and the test's `throwAt` would
 * never reach the copy the pipeline actually calls.
 */
if (!globalThis.__sgsFakeLibsControl) {
  globalThis.__sgsFakeLibsControl = { throwAt: null, scanOverrides: {}, calls: [] }
}

export const fakeLibsControl = globalThis.__sgsFakeLibsControl

export function resetFakeLibs() {
  const control = globalThis.__sgsFakeLibsControl
  control.throwAt = null
  control.scanOverrides = {}
  control.calls = []
}

function control() {
  return globalThis.__sgsFakeLibsControl
}

function record(name) {
  control().calls.push(name)
  if (control().throwAt === name) {
    const error = new TypeError(`fake failure injected at ${name}`)
    error.name = 'TypeError'
    throw error
  }
}

const DEFAULT_CANDIDATE = {
  tableIndex: 11,
  run: { startIndex: 3, length: 2 },
  identifierColumns: { numberColumnIndex: 0, codeColumnIndex: 1, nameColumnIndex: 2 },
  writableScoreColumns: [{ key: 'real-11-6', label: '10', columnIndex: 6, maxScore: 10, headerCheckboxPresent: true, headerCheckboxChecked: true }],
}

// ---- diagnostic ----------------------------------------------------
export function collectAllTableRowFacts() {
  record('collectAllTableRowFacts')
  return {
    subjectFilter: { present: true, selectedText: 'คณิตศาสตร์' },
    classroomFilter: { present: true, selectedText: 'ม.5/2' },
    tables: [{ tableIndex: 11, rows: [[], [], [], [], []] }],
    ...control().scanOverrides,
  }
}

export function inspectPaginationControls() {
  record('inspectPaginationControls')
  return { found: true, candidates: [], currentPageDomOrder: 1 }
}

export function readColumnValues() {
  record('readColumnValues')
  return { found: true, values: { 0: null, 1: null } }
}

export function fillSgsColumnValues() {
  record('fillSgsColumnValues')
  return { found: true, writtenCount: 1, missingOffsets: [] }
}

export function readSingleColumnCellValue() {
  record('readSingleColumnCellValue')
  return { found: true, value: 8 }
}

export function readGridFingerprint() {
  record('readGridFingerprint')
  return 'fingerprint-before'
}

export function clickPaginationControl() {
  record('clickPaginationControl')
}

// ---- tableExtraction -----------------------------------------------
export function pickBestStudentGridCandidate() {
  record('pickBestStudentGridCandidate')
  return DEFAULT_CANDIDATE
}

export function detectPagination() {
  record('detectPagination')
  return { currentPage: 1, totalPages: 1, totalStudentRows: 2, pageSize: 2 }
}

export function buildSgsRowKey(offset) {
  return `sgs-row-${offset}`
}

export function extractSgsStudentCandidates() {
  record('extractSgsStudentCandidates')
  return [{ sgsRowKey: 'sgs-row-0', sgsStudentNumber: 1, sgsStudentId: '12345', sgsFullNameRaw: 'ทดสอบ ระบบ' }]
}

// ---- pagination ----------------------------------------------------
export function buildPaginationHintsFromInspection() {
  record('buildPaginationHintsFromInspection')
  return {}
}

export function shouldAttemptPageAdvance() {
  record('shouldAttemptPageAdvance')
  return false
}

export function findSgsNextPageControl() {
  return { control: null, confidence: 'none', reason: 'not found' }
}

export function isConfidentEnoughToAutoClick() {
  return false
}

export function verifyPageAdvance() {
  return { ok: false, kind: 'unconfirmed', reason: 'n/a' }
}

// ---- wholeColumn ---------------------------------------------------
export function locateColumnOnCurrentPage(columns, columnKey) {
  record('locateColumnOnCurrentPage')
  return columns.find((c) => c.key === columnKey) ?? null
}

export function computeWholeColumnPlan() {
  record('computeWholeColumnPlan')
  return [{ studentId: 's1', sgsRowOffset: 0, krunameScore: 8, status: 'READY', fullName: 'ทดสอบ ระบบ', studentNumber: 1 }]
}

export function revalidateWholeColumnContext() {
  return { ok: true, reason: null }
}

export function collectFailedStudents() {
  return []
}

// ---- subjectClassroom ----------------------------------------------
export function evaluateSubjectClassroomMatch() {
  record('evaluateSubjectClassroomMatch')
  return { ok: true, subject: { ok: true }, classroom: { ok: true } }
}

// ---- mapping -------------------------------------------------------
export function matchStudentsToSgs() {
  record('matchStudentsToSgs')
  return [{ studentId: 's1', status: 'MATCHED', matchedSgsRowKey: 'sgs-row-0', reason: null }]
}

// ---- roster --------------------------------------------------------
export function buildFullRosterFromPayload() {
  record('buildFullRosterFromPayload')
  return [{ studentId: 's1', studentNumber: 1, studentCode: '12345', fullName: 'ทดสอบ ระบบ', score: 8 }]
}

// ---- autoRun -------------------------------------------------------
export function evaluateAutoRunStopCondition() {
  record('evaluateAutoRunStopCondition')
  return { shouldStop: false, reason: null }
}

export function isPaginationReadyForAutoRun() {
  return true
}

export function planHasAmbiguousWriteCandidate() {
  return false
}

export function summarizeAutoRunPageResult() {
  return { written: 1, skippedNoScore: 0, skippedExisting: 0, invalid: 0, notFound: 0, ambiguous: 0, failed: 0 }
}

export function mergeAutoRunSummaries(a, b) {
  return { ...a, ...b }
}

export function pageFailureExceedsThreshold() {
  return false
}
