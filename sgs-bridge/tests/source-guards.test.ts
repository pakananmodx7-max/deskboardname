import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf-8')
}

function sliceFunction(source: string, name: string, nextNames: string[]): string {
  const start = source.indexOf(`export function ${name}`)
  const ends = nextNames.map((n) => source.indexOf(`export function ${n}`, start + 1)).filter((i) => i !== -1)
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
const CONTENT_DIAGNOSTIC_FUNCTIONS = ['collectRawSgsFacts', 'inspectSgsScoreTable', 'fillSgsColumnValues']

describe('content-diagnostic.js: collectRawSgsFacts — never reads cookies, storage, or arbitrary input values', () => {
  const source = sliceFunction(contentDiagnosticSource, 'collectRawSgsFacts', CONTENT_DIAGNOSTIC_FUNCTIONS)

  it('never touches document.cookie', () => {
    expect(source).not.toMatch(/document\.cookie/)
  })

  it('never touches localStorage/sessionStorage', () => {
    expect(source).not.toMatch(/localStorage|sessionStorage/)
  })

  it('never reads an arbitrary input/select/textarea\'s .value — only the two known filter inputs\' .value', () => {
    const withoutKnownFilterRead = source.replace(/el\s*\?\s*el\.value.*?:\s*null/g, '')
    expect(withoutKnownFilterRead).not.toMatch(/\.value\b/)
  })

  it('reads the known filter inputs only via getElementById with the literal confirmed ids — never a guessed selector', () => {
    expect(source).toContain("document.getElementById(id)")
    expect(source).toContain('ctl00_PageContent_ClassSubjectIDFilter.Filter_Input')
    expect(source).toContain('ctl00_PageContent_ClassSectionNoFilter.Filter_Input')
  })

  it('never reads a data table BODY row\'s text — only header cells\' text and column input PRESENCE (never a value)', () => {
    expect(source).toContain('headerCells')
    expect(source).not.toMatch(/rows\[.*\]\.textContent|Array\.from\(rows\)\.map/)
    expect(source).toContain('columnsHaveInput')
    // The body-row scan (sampleRow) only ever checks for an input's
    // PRESENCE via querySelector, and must never also read that same
    // cell's .textContent — header cells are the only ones read as text.
    const start = source.indexOf('const columnsHaveInput =')
    const columnsHaveInputBlock = source.slice(start, source.indexOf('return {', start))
    expect(columnsHaveInputBlock).not.toMatch(/\.textContent/)
  })
})

describe('content-diagnostic.js: inspectSgsScoreTable — reads only what item 1-5 of the spec allows', () => {
  const source = sliceFunction(contentDiagnosticSource, 'inspectSgsScoreTable', CONTENT_DIAGNOSTIC_FUNCTIONS)

  it('never touches document.cookie, localStorage, or sessionStorage', () => {
    expect(source).not.toMatch(/document\.cookie/)
    expect(source).not.toMatch(/localStorage|sessionStorage/)
  })

  it('only reads a cell\'s .value inside the targetColumnIndex-guarded columnValues block — identifier columns use textOf, never .value', () => {
    const rowsBlock = source.slice(source.indexOf('const rows = best.bodyRows.map'), source.indexOf('let columnValues'))
    expect(rowsBlock).not.toMatch(/\.value\b/)
    expect(rowsBlock).toContain('textOf(cells[')
    const columnValuesBlock = source.slice(source.indexOf('let columnValues'))
    expect(columnValuesBlock).toContain('input.value')
  })

  it('reading a column\'s values happens only when targetColumnIndex is explicitly given — never unconditionally', () => {
    expect(source).toContain('if (targetColumnIndex !== null && targetColumnIndex !== undefined)')
  })

  it('never invents a score-input selector — the table is found by structural heuristic, not a hardcoded id/class', () => {
    expect(source).not.toMatch(/getElementById\(['"](?!)/)
    expect(source).not.toMatch(/querySelector\(['"]#/)
  })

  it('never clicks anything — this function only inspects, never mutates', () => {
    expect(source).not.toMatch(/\.click\(\)/)
  })
})

describe('content-diagnostic.js: fillSgsColumnValues — writes ONLY the requested column, never clicks Save', () => {
  const source = sliceFunction(contentDiagnosticSource, 'fillSgsColumnValues', CONTENT_DIAGNOSTIC_FUNCTIONS)

  it('never calls .click() anywhere — no Save/Submit is ever triggered', () => {
    expect(source).not.toMatch(/\.click\(\)/)
  })

  it('only ever indexes into targetColumnIndex — never loops over or reads a different column index', () => {
    expect(source).toContain('row.children[targetColumnIndex]')
    // No OTHER numeric or variable column index is ever used to locate a cell in this function.
    const cellLookups = [...source.matchAll(/\.children\[([^\]]+)\]/g)].map((m) => m[1])
    expect(cellLookups.every((expr) => expr === 'targetColumnIndex')).toBe(true)
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

  it('reports rows it could not find a writable input for, rather than silently skipping them', () => {
    expect(source).toContain('missingRowIndexes')
  })

  it('re-derives the table via the same structural heuristic — never a cached/passed-in DOM handle', () => {
    expect(source).toContain('findBestScoreTable()')
    expect(source).not.toMatch(/function fillSgsColumnValues\([^)]*table/i)
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

  it('never auto-runs the diagnostic or mapping check without a button click', () => {
    expect(source).toContain("diagnosticBtn.addEventListener('click'")
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

  it('fillSgsColumnValues (the real DOM write) is only ever invoked with the confirmed real column\'s own columnIndex — never a hardcoded index', () => {
    const allCalls = [...source.matchAll(/func:\s*fillSgsColumnValues,\s*args:\s*\[([^\]]*)\]/g)]
    expect(allCalls.length).toBe(1)
    expect(allCalls[0][1]).toMatch(/confirmedRealColumn\.columnIndex/)
  })

  it('the real-page mapping (matchStudentsToSgs against the ACTUAL extracted rows) only runs after inspectSgsScoreTable has returned real rows — never against an invented list', () => {
    const fn = source.slice(source.indexOf('async function runRealColumnInspection'), source.indexOf('fillBtn.addEventListener'))
    expect(fn).toContain('matchStudentsToSgs(krunameStudents, sgsCandidates)')
    expect(fn).toContain('inspectSgsScoreTable')
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
