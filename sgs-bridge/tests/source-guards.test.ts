import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf-8')
}

function sliceFunction(source: string, name: string, nextNames: string[]): string {
  const start = source.indexOf(`export function ${name}`)
  const ends = nextNames
    .map((n) => source.indexOf(`export function ${n}`, start + 1))
    .filter((i) => i !== -1)
    .map((exportIndex) => {
      // Back up to the start of that function's own leading /** doc
      // comment (if any) so it's excluded from THIS slice — otherwise
      // prose in that comment (which may itself mention things like
      // "cookie"/"localStorage" as things the code must never do) would
      // be wrongly attributed to the function ending right before it.
      const commentStart = source.lastIndexOf('/**', exportIndex)
      const precedingBlankLine = source.lastIndexOf('\n\n', exportIndex)
      return commentStart !== -1 && commentStart > precedingBlankLine ? commentStart : exportIndex
    })
  const end = ends.length > 0 ? Math.min(...ends) : source.length
  return source.slice(start, end)
}

describe('manifest.json — minimal permissions, no host_permissions, no remote code', () => {
  const manifest = JSON.parse(read('../manifest.json'))

  it('requests only activeTab/scripting/storage — never a broad host permission or "tabs"/"cookies"', () => {
    expect(manifest.permissions.sort()).toEqual(['activeTab', 'scripting', 'storage'])
    expect(manifest.host_permissions).toBeUndefined()
  })

  it('is Manifest V3', () => {
    expect(manifest.manifest_version).toBe(3)
  })
})

const contentDiagnosticSource = read('../src/content-diagnostic.js')
const CONTENT_DIAGNOSTIC_FUNCTIONS = ['collectRawSgsFacts', 'collectAllTableRowFacts', 'readColumnValues', 'fillSgsColumnValues']

describe('BUG FIX — known filter ids, never a CSS selector string passed to getElementById', () => {
  it('KNOWN_SGS_FILTER_IDS holds bare element ids, never a CSS selector fragment', () => {
    expect(contentDiagnosticSource).toContain("subject: 'ctl00_PageContent_ClassSubjectIDFilter'")
    expect(contentDiagnosticSource).toContain("classroom: 'ctl00_PageContent_ClassSectionNoFilter'")
    // The original bug appended ".Filter_Input" (a CSS class, not part
    // of the id) onto the id string passed to getElementById. The file
    // header documents that history in prose (so it legitimately
    // contains that exact substring once) — this check only looks
    // inside the actual functions, past that documentation.
    const afterHeader = contentDiagnosticSource.slice(contentDiagnosticSource.indexOf('export const KNOWN_SGS_FILTER_IDS'))
    expect(afterHeader).not.toMatch(/getElementById\([^)]*\.Filter_Input/)
    expect(afterHeader).not.toContain('ClassSubjectIDFilter.Filter_Input')
    expect(afterHeader).not.toContain('ClassSectionNoFilter.Filter_Input')
  })

  it('every known-filter lookup reads the selected option\'s visible text, never just raising/changing the selection', () => {
    const matches = [...contentDiagnosticSource.matchAll(/selectedOption \? selectedOption\.text\.trim\(\)/g)]
    expect(matches.length).toBeGreaterThan(0)
  })

  it('never assigns to a known filter\'s value/selectedIndex — read-only', () => {
    expect(contentDiagnosticSource).not.toMatch(/ClassSubjectIDFilter[^;]*\.value\s*=/)
    expect(contentDiagnosticSource).not.toMatch(/selectedIndex\s*=\s*\d/)
  })
})

describe('content-diagnostic.js: collectRawSgsFacts — never reads cookies, storage, or arbitrary input values', () => {
  const source = sliceFunction(contentDiagnosticSource, 'collectRawSgsFacts', CONTENT_DIAGNOSTIC_FUNCTIONS)

  it('never touches document.cookie', () => {
    expect(source).not.toMatch(/document\.cookie/)
  })

  it('never touches localStorage/sessionStorage', () => {
    expect(source).not.toMatch(/localStorage|sessionStorage/)
  })

  it('never reads an arbitrary input/select/textarea\'s .value — only the two known filters\' selection', () => {
    const withoutKnownFilterRead = source.replace(/const selectedOption[\s\S]*?knownFilters\[name\] = \{[\s\S]*?\}\n/g, '')
    expect(withoutKnownFilterRead).not.toMatch(/\.value\b/)
  })

  it('reads the known filters only via getElementById with the literal confirmed (bug-fixed) ids', () => {
    expect(source).toContain('ctl00_PageContent_ClassSubjectIDFilter')
    expect(source).toContain('ctl00_PageContent_ClassSectionNoFilter')
    expect(source).not.toContain('.Filter_Input')
  })

  it('never reads a data table BODY row\'s text — only header cells\' text and column input PRESENCE (never a value)', () => {
    expect(source).toContain('headerCells')
    expect(source).not.toMatch(/rows\[.*\]\.textContent|Array\.from\(rows\)\.map/)
    expect(source).toContain('columnsHaveInput')
    const start = source.indexOf('const columnsHaveInput =')
    const columnsHaveInputBlock = source.slice(start, source.indexOf('return {', start))
    expect(columnsHaveInputBlock).not.toMatch(/\.textContent/)
  })
})

describe('content-diagnostic.js: collectAllTableRowFacts — the ONLY function that walks every table/row for the real grid search', () => {
  const source = sliceFunction(contentDiagnosticSource, 'collectAllTableRowFacts', CONTENT_DIAGNOSTIC_FUNCTIONS)

  it('never touches document.cookie, localStorage, or sessionStorage', () => {
    expect(source).not.toMatch(/document\.cookie/)
    expect(source).not.toMatch(/localStorage|sessionStorage/)
  })

  it('never reads an input cell\'s .value — only whether it HAS an input, and non-input cells\' text', () => {
    // The known-filter reads (subjectFilter/classroomFilter) are a
    // deliberate, separate, documented exception — excluded here.
    const withoutKnownFilterRead = source.replace(/function readKnownFilterInline[\s\S]*$/, '')
    expect(withoutKnownFilterRead).not.toMatch(/\.value\b/)
  })

  it('never assigns a text value for a cell that hasInput — text is always empty for those cells', () => {
    expect(source).toContain("text: ''")
    expect(source).toContain('text: textOf(cell)')
  })

  it('reports input structure (count/type/disabled/readonly) instead of a value, for a cell that has an input', () => {
    expect(source).toContain('inputMeta:')
    expect(source).toContain('disabled: inputEl.disabled === true')
    expect(source).toContain('readonly: inputEl.readOnly === true')
    expect(source).not.toMatch(/inputEl\.value/)
  })

  it('never invents a score-input selector — walks every real table via querySelectorAll, uses each table\'s own .rows', () => {
    expect(source).not.toMatch(/querySelector\(['"]#(?!ctl00)/)
    expect(source).toContain("document.querySelectorAll('table')")
    expect(source).toContain('table.rows')
  })

  it('caps how many tables/rows/cells it reads, so a huge ASP.NET page stays a reasonable size', () => {
    expect(source).toMatch(/MAX_TABLES/)
    expect(source).toMatch(/MAX_ROWS_PER_TABLE/)
    expect(source).toMatch(/MAX_CELLS_PER_ROW/)
  })

  it('never clicks anything — this function only reads structure', () => {
    expect(source).not.toMatch(/\.click\(\)/)
  })
})

describe('content-diagnostic.js: readColumnValues — reads only the ONE requested column, for the ONE confirmed table/run', () => {
  const source = sliceFunction(contentDiagnosticSource, 'readColumnValues', CONTENT_DIAGNOSTIC_FUNCTIONS)

  it('only ever indexes into columnIndex — never a different/derived column', () => {
    const cellLookups = [...source.matchAll(/\.cells\[([^\]]+)\]/g)].map((m) => m[1])
    expect(cellLookups.length).toBeGreaterThan(0)
    expect(cellLookups.every((expr) => expr === 'columnIndex')).toBe(true)
  })

  it('locates the table by the CONFIRMED tableIndex argument, never a re-run heuristic guess', () => {
    expect(source).toContain("document.querySelectorAll('table')[tableIndex]")
  })

  it('never writes to .value — read-only', () => {
    expect(source).not.toMatch(/\.value\s*=/)
  })

  it('never clicks anything', () => {
    expect(source).not.toMatch(/\.click\(\)/)
  })
})

describe('content-diagnostic.js: fillSgsColumnValues — writes ONLY the requested column, never clicks Save', () => {
  const source = sliceFunction(contentDiagnosticSource, 'fillSgsColumnValues', CONTENT_DIAGNOSTIC_FUNCTIONS)

  it('never calls .click() anywhere — no Save/Submit is ever triggered', () => {
    expect(source).not.toMatch(/\.click\(\)/)
  })

  it('locates the table by the CONFIRMED tableIndex argument, never a re-run heuristic guess', () => {
    expect(source).toContain("document.querySelectorAll('table')[tableIndex]")
  })

  it('only ever indexes into columnIndex — never loops over or reads a different column index', () => {
    const cellLookups = [...source.matchAll(/\.cells\[([^\]]+)\]/g)].map((m) => m[1])
    expect(cellLookups.length).toBeGreaterThan(0)
    expect(cellLookups.every((expr) => expr === 'columnIndex')).toBe(true)
  })

  it('dispatches both input and change events after setting the value — never neither, never only one', () => {
    const loopBody = source.slice(source.indexOf('for (const ['))
    expect(loopBody).toContain("new Event('input', { bubbles: true })")
    expect(loopBody).toContain("new Event('change', { bubbles: true })")
    const inputIndex = loopBody.indexOf("new Event('input'")
    const changeIndex = loopBody.indexOf("new Event('change'")
    const valueIndex = loopBody.indexOf('input.value = ')
    expect(valueIndex).toBeGreaterThan(-1)
    expect(inputIndex).toBeGreaterThan(valueIndex)
    expect(changeIndex).toBeGreaterThan(inputIndex)
  })

  it('reports offsets it could not find a writable input for, rather than silently skipping them', () => {
    expect(source).toContain('missingOffsets')
  })
})

describe('popup.js — never sends the loaded payload or diagnostic report anywhere except local chrome.storage', () => {
  const source = read('../src/popup.js')

  it('contains no fetch/XHR/axios call', () => {
    expect(source).not.toMatch(/\bfetch\(/)
    expect(source).not.toMatch(/XMLHttpRequest/)
  })

  it('only uses chrome.storage.session/local, never chrome.storage.sync (which leaves the machine)', () => {
    expect(source).not.toMatch(/chrome\.storage\.sync/)
  })

  it('never auto-runs a diagnostic or mapping check without a button click', () => {
    expect(source).toContain("diagnosticBtn.addEventListener('click'")
    expect(source).toContain("diagnosticDebugBtn.addEventListener('click'")
    expect(source).toContain("diagnosticVerboseBtn.addEventListener('click'")
    expect(source).toContain("mappingBtn.addEventListener('click'")
  })

  it('never auto-runs the real-table inspection or the fill action without a button click', () => {
    expect(source).toContain("inspectBtn.addEventListener('click'")
    expect(source).toContain("fillBtn.addEventListener('click'")
  })

  it('the SGS-candidate list passed into the placeholder mapping-dry-run is empty — no invented selector-based extraction there', () => {
    const fn = source.slice(source.indexOf('function renderMappingResult'), source.indexOf('fileInput.addEventListener'))
    expect(fn).toContain('matchStudentsToSgs(krunameStudents, [])')
  })

  it('buildSgsColumnWriteInstructions (Phase 1.5 preview-only path) is only ever called with payload.targetColumn.key', () => {
    const fn = source.slice(source.indexOf('function renderPreview'), source.indexOf('function loadPayloadFromFile'))
    expect(fn).toContain('buildSgsColumnWriteInstructions(plan, payload.targetColumn.key)')
    const allCalls = [...source.matchAll(/buildSgsColumnWriteInstructions\(([^)]*)\)/g)]
    expect(allCalls.length).toBe(1)
    expect(allCalls[0][1]).toBe('plan, payload.targetColumn.key')
  })

  it('the Phase 1.5 preview plan is computed from payload.overwriteMode — never a hardcoded overwrite choice', () => {
    expect(source).toContain('computeSgsColumnFillPlan(rows, NO_KNOWN_EXISTING_SCORES, payload.overwriteMode)')
    expect(source).not.toMatch(/computeSgsColumnFillPlan\([^)]*'overwrite_selected_column'/)
  })

  it('the real-page write is scoped to the ONE confirmed real column — buildSgsRealWriteInstructions is only ever called with the confirmed real column\'s own key', () => {
    const allCalls = [...source.matchAll(/buildSgsRealWriteInstructions\(([^)]*)\)/g)]
    expect(allCalls.length).toBe(1)
    expect(allCalls[0][1]).toMatch(/confirmedRealColumn\.key/)
  })

  it('fillSgsColumnValues (the real DOM write) is only ever invoked with the CONFIRMED table/run/column — never a hardcoded index', () => {
    const allCalls = [...source.matchAll(/func:\s*fillSgsColumnValues,\s*args:\s*\[([^\]]*)\]/g)]
    expect(allCalls.length).toBe(1)
    expect(allCalls[0][1]).toMatch(/tableIndex, run\.startIndex, confirmedRealColumn\.columnIndex/)
  })

  it('readColumnValues is only ever invoked with the CONFIRMED table/run/column', () => {
    const allCalls = [...source.matchAll(/func:\s*readColumnValues,\s*args:\s*\[([^\]]*)\]/g)]
    expect(allCalls.length).toBe(1)
    expect(allCalls[0][1]).toMatch(/tableIndex, run\.startIndex, run\.length, confirmedRealColumn\.columnIndex/)
  })

  it('the real-page mapping (matchStudentsToSgs against the ACTUAL extracted rows) only runs from within runColumnPreview, using row text already read by collectAllTableRowFacts', () => {
    const fn = source.slice(source.indexOf('async function runColumnPreview'), source.indexOf('function renderRealFillPreview'))
    expect(fn).toContain('matchStudentsToSgs(krunameStudents, sgsCandidates)')
    expect(fn).toContain('currentGridFacts')
  })

  it('item 7: the fill button is only ever enabled when gridMeetsFillRequirements passes', () => {
    const gateChecks = [...source.matchAll(/gridMeetsFillRequirements\(/g)]
    expect(gateChecks.length).toBeGreaterThanOrEqual(2)
    expect(source).toContain('fillBtn.disabled = !gridMeetsFillRequirements(currentGridCandidate)')
  })

  it('gridMeetsFillRequirements requires number/code/name AND at least one WRITABLE score column — never just "a score column"', () => {
    const fn = source.slice(source.indexOf('function gridMeetsFillRequirements'), source.indexOf('function isConfirmedColumnWritable'))
    expect(fn).toContain('numberColumnIndex !== null')
    expect(fn).toContain('codeColumnIndex !== null')
    expect(fn).toContain('nameColumnIndex !== null')
    expect(fn).toContain('candidate.writableScoreColumns.length > 0')
    expect(fn).not.toMatch(/candidate\.scoreColumns\b/)
  })

  it('isConfirmedColumnWritable checks the column is actually IN writableScoreColumns, never trusting a derived column that was merely displayed', () => {
    const fn = source.slice(source.indexOf('function isConfirmedColumnWritable'), source.indexOf('async function runRealColumnInspection'))
    expect(fn).toContain('candidate.writableScoreColumns.some((c) => c.key === column.key)')
  })

  it('item 5: both runColumnPreview and runFillSelectedColumn re-check isConfirmedColumnWritable before doing anything real', () => {
    const previewFn = source.slice(source.indexOf('async function runColumnPreview'), source.indexOf('function renderRealFillPreview'))
    const fillFn = source.slice(source.indexOf('async function runFillSelectedColumn'), source.indexOf('fileInput.addEventListener'))
    expect(previewFn).toContain('isConfirmedColumnWritable(currentGridCandidate, confirmedRealColumn)')
    expect(fillFn).toContain('isConfirmedColumnWritable(currentGridCandidate, confirmedRealColumn)')
  })

  it('renderRealColumnPicker only ever offers writableScoreColumns as radio options — derivedColumns are listed read-only, never selectable', () => {
    const fn = source.slice(source.indexOf('function renderRealColumnPicker'), source.indexOf('async function runColumnPreview'))
    expect(fn).toContain('gridCandidate.writableScoreColumns.map(')
    expect(fn).toContain('gridCandidate.derivedColumns.map(')
    // The derived-columns list must never attach a radio input or a change handler.
    const derivedBlock = fn.slice(fn.indexOf('realDerivedColumnsEl.replaceChildren'))
    expect(derivedBlock).not.toContain("input.type = 'radio'")
    expect(derivedBlock).not.toContain('confirmedRealColumn = ')
  })

  it('never invents a student grid — always derives it via pickBestStudentGridCandidate over collectAllTableRowFacts\'s real output', () => {
    const fn = source.slice(source.indexOf('async function runRealColumnInspection'), source.indexOf('function renderRealColumnPicker'))
    expect(fn).toContain('collectAllTableRowFacts')
    expect(fn).toContain('pickBestStudentGridCandidate(facts.tables)')
  })
})

describe('options.js — only ever writes the non-sensitive keyword setting', () => {
  const source = read('../src/options.js')

  it('only touches the sgsKeyword storage key', () => {
    const matches = [...source.matchAll(/chrome\.storage\.local\.(?:get|set)\(([^)]*)\)/g)]
    expect(matches.length).toBeGreaterThan(0)
    for (const match of matches) {
      expect(match[1]).toContain('sgsKeyword')
    }
  })
})
