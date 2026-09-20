import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf-8')
}

function sliceFunction(source: string, name: string, nextNames: string[]): string {
  // `export async function` for a function that needs to await
  // (advanceToNextSgsPage's own bounded polling loop) is still just this
  // SAME "one function, sliced to its own text" convention — matched
  // here too so it isn't silently treated as "not found."
  const startIndex = (fnName: string) => {
    const plain = source.indexOf(`export function ${fnName}`)
    const async = source.indexOf(`export async function ${fnName}`)
    if (plain === -1) return async
    if (async === -1) return plain
    return Math.min(plain, async)
  }
  const start = startIndex(name)
  const ends = nextNames
    .map((n) => startIndex(n))
    .filter((i) => i !== -1 && i > start)
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
const CONTENT_DIAGNOSTIC_FUNCTIONS = [
  'collectRawSgsFacts',
  'collectAllTableRowFacts',
  'readColumnValues',
  'fillSgsColumnValues',
  'readSingleCellRevalidationState',
  'readSingleColumnCellValue',
  'advanceToNextSgsPage',
]

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

  it('LIVE DISCOVERY: always captures a cell\'s text, even when it also hasInput — a header checkbox cell carries its column label alongside the checkbox', () => {
    // Previously an input-bearing cell always reported `text: ''`,
    // silently discarding a header checkbox cell's own visible label
    // (e.g. "10" next to its checkbox). Both branches must now use the
    // SAME textOf(cell) call.
    expect(source).not.toContain("text: ''")
    const textAssignments = [...source.matchAll(/const text = ([^\n]+)/g)]
    expect(textAssignments.length).toBeGreaterThan(0)
    expect(textAssignments.every((m) => m[1].trim() === 'textOf(cell)')).toBe(true)
  })

  it('reports input structure (count/type/disabled/readonly/checked/visible) instead of a value, for a cell that has an input', () => {
    expect(source).toContain('inputMeta')
    expect(source).toContain('disabled: chosen.disabled === true')
    expect(source).toContain('readonly: chosen.readOnly === true')
    expect(source).not.toMatch(/chosen\.value/)
    expect(source).not.toMatch(/inputEl/)
  })

  it('SECTION 6 fix: chooses the VISIBLE control (offsetParent !== null), never blindly the first match in DOM order', () => {
    expect(source).toContain('offsetParent !== null')
    expect(source).toContain('visibleCandidates')
  })

  it('only a checkbox control ever reports a `checked` state — every other type reports null, never a guessed boolean', () => {
    expect(source).toMatch(/checked:\s*type === 'checkbox' \? chosen\.checked === true : null/)
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

describe('content-diagnostic.js: readSingleCellRevalidationState — the GUARD AGAINST STALE DOM read, entirely read-only', () => {
  const source = sliceFunction(contentDiagnosticSource, 'readSingleCellRevalidationState', CONTENT_DIAGNOSTIC_FUNCTIONS)

  it('never writes to .value, never calls .click(), never toggles a checkbox — read-only', () => {
    expect(source).not.toMatch(/\.value\s*=(?!=)/)
    expect(source).not.toMatch(/\.click\(\)/)
    expect(source).not.toMatch(/\.checked\s*=(?!=)/)
  })

  it('locates the table by the CONFIRMED tableIndex argument, never a re-run heuristic guess', () => {
    expect(source).toContain("document.querySelectorAll('table')[tableIndex]")
  })

  it('reads the two known subject/classroom filters — the SAME "same subject, same classroom" facts the write-time revalidation compares against', () => {
    expect(source).toContain("readKnownFilterInline('ctl00_PageContent_ClassSubjectIDFilter')")
    expect(source).toContain("readKnownFilterInline('ctl00_PageContent_ClassSectionNoFilter')")
  })

  it('reads the identifier columns (number/code/name) at the ONE requested row — never a scan of the whole run', () => {
    expect(source).toContain('identifierColumns.numberColumnIndex')
    expect(source).toContain('identifierColumns.codeColumnIndex')
    expect(source).toContain('identifierColumns.nameColumnIndex')
  })

  it('reports the target cell\'s visible/enabled state and visible input COUNT — the exact facts evaluateSingleCellTestPreconditions/revalidateSingleCellTestContext need to refuse an unsafe cell', () => {
    expect(source).toContain('cellVisible')
    expect(source).toContain('cellEnabled')
    expect(source).toContain('visibleInputCount')
  })

  it('prefers the VISIBLE control the same way fillSgsColumnValues/readColumnValues do, never trusting the first DOM-order match blindly', () => {
    expect(source).toContain('el.offsetParent !== null')
  })
})

describe('NEXT PHASE — content-diagnostic.js: readSingleColumnCellValue, the auto-run per-cell verification read, entirely read-only', () => {
  const source = sliceFunction(contentDiagnosticSource, 'readSingleColumnCellValue', CONTENT_DIAGNOSTIC_FUNCTIONS)

  it('never writes to .value, never calls .click(), never toggles a checkbox — read-only', () => {
    expect(source).not.toMatch(/\.value\s*=(?!=)/)
    expect(source).not.toMatch(/\.click\(\)/)
    expect(source).not.toMatch(/\.checked\s*=(?!=)/)
  })

  it('locates the table by the CONFIRMED tableIndex argument, never a re-run heuristic guess', () => {
    expect(source).toContain("document.querySelectorAll('table')[tableIndex]")
  })

  it('only ever indexes into the ONE requested rowIndex/columnIndex — never a range or loop', () => {
    expect(source).not.toContain('for (')
    expect(source).not.toContain('.map(')
  })
})

describe('NEXT PHASE — content-diagnostic.js: advanceToNextSgsPage, the ONLY page-advance mechanism, and only via an already-confirmed pagination shape', () => {
  const source = sliceFunction(contentDiagnosticSource, 'advanceToNextSgsPage', CONTENT_DIAGNOSTIC_FUNCTIONS)

  it('never touches document.cookie, localStorage, or sessionStorage', () => {
    expect(source).not.toMatch(/document\.cookie/)
    expect(source).not.toMatch(/localStorage|sessionStorage/)
  })

  it('the ONLY .click() call in this whole file is here, and only ever on a link cell found by the SAME row-of-page-number-links shape detectPagination already trusts — never a guessed "next"/arrow/icon button selector', () => {
    expect(contentDiagnosticSource.match(/\.click\(\)/g)?.length).toBe(1)
    expect(source).toContain('nextLink.click()')
    expect(source).toContain('PAGE_NUMBER_PATTERN')
    expect(source).toContain("match.querySelector('a')")
  })

  it('never clicks anything inside the confirmed student grid run — the pager search explicitly excludes the run\'s own row range', () => {
    expect(source).toMatch(/isGridTable && ri >= runStartIndex && ri < runStartIndex \+ runLength\) continue/)
  })

  it('never assumes a click alone means the page changed — polls a fingerprint of the SAME confirmed grid range for an actual change, bounded by timeoutMs, before ever reporting advanced: true', () => {
    expect(source).toContain('fingerprintGrid()')
    expect(source).toMatch(/while \(Date\.now\(\) - start < timeoutMs\)/)
    expect(source).toMatch(/after !== null && after !== beforeFingerprint/)
  })

  it('reports an honest "no confirmed control" reason (never advancing) when no row-of-links pager is found — the real, live-confirmed SGS page (text-only pagination) always takes this path', () => {
    expect(source).toContain("reason: 'no_confirmed_next_page_control'")
    const noLinkPaths = [...source.matchAll(/return \{ advanced: false, reason: '([^']+)' \}/g)].map((m) => m[1])
    expect(noLinkPaths).toContain('no_confirmed_next_page_control')
    expect(noLinkPaths).toContain('timeout_waiting_for_page_change')
  })

  it('never toggles a checkbox and never writes an input value — the click target is only ever an <a> pager link', () => {
    expect(source).not.toMatch(/\.checked\s*=(?!=)/)
    expect(source).not.toMatch(/\.value\s*=(?!=)/)
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

  it('never auto-runs the real-table inspection or the re-scan/single-cell-preview actions without a button click', () => {
    expect(source).toContain("inspectBtn.addEventListener('click'")
    expect(source).toContain("realRescanBtn.addEventListener('click'")
    expect(source).toContain("sctPreviewBtn.addEventListener('click'")
  })

  it('CONTROLLED LIVE TEST: sctWriteBtn and sctConfirmCheckbox ARE wired up — exactly one click listener, exactly one change listener, and both are referenced by id', () => {
    expect(source).toContain("getElementById('sct-write-btn')")
    expect(source).toContain("getElementById('sct-confirm')")
    const writeBtnClicks = [...source.matchAll(/sctWriteBtn\.addEventListener\('click'/g)]
    expect(writeBtnClicks.length).toBe(1)
    const confirmChanges = [...source.matchAll(/sctConfirmCheckbox\.addEventListener\('change'/g)]
    expect(confirmChanges.length).toBe(1)
  })

  it('CONTROLLED LIVE TEST: sctWriteBtn is NEVER enabled by a bare `.disabled = false` — only updateSingleCellWriteButtonState (itself driven by canEnableSingleCellTestWrite) ever touches it; sctConfirmCheckbox has exactly ONE such assignment, gated behind a passing evaluateSingleCellTestPreconditions call', () => {
    expect(source).not.toMatch(/sctWriteBtn\.disabled\s*=\s*false/)
    const confirmEnableCalls = [...source.matchAll(/sctConfirmCheckbox\.disabled\s*=\s*false/g)]
    expect(confirmEnableCalls.length).toBe(1)
    const fn = source.slice(source.indexOf('async function runSingleCellTestPreview'), source.indexOf('function resetSingleCellTestGateOnly'))
    expect(fn).toContain('sctConfirmCheckbox.disabled = false')
    expect(fn.indexOf('preconditions.ok')).toBeLessThan(fn.indexOf('sctConfirmCheckbox.disabled = false'))
    expect(source).toContain('canEnableSingleCellTestWrite')
    expect(source).toContain('evaluateSingleCellTestPreconditions')
    expect(source).toContain('revalidateSingleCellTestContext')
  })

  it('CONTROLLED LIVE TEST: every path that finds a reason to refuse (invalid plan, failed precondition, failed revalidation) DISABLES the write button and checkbox — never merely skips enabling them', () => {
    const fn = source.slice(source.indexOf('async function runSingleCellTestWrite'), source.indexOf('fileInput.addEventListener'))
    expect(fn).toContain('disarmSingleCellTestWrite()')
    expect(fn).toMatch(/if \(!revalidation\.ok\)[\s\S]{0,300}disarmSingleCellTestWrite\(\)/)
    expect(fn).toMatch(/if \(!plan\.valid\)[\s\S]{0,300}disarmSingleCellTestWrite\(\)/)
  })

  it('NEXT PHASE: fillSgsColumnValues is called exactly three times — the single-cell path, the whole-column (semi-automatic) path, and the auto-run per-cell loop — and STILL never via the old ad hoc bulk instruction builders (buildSgsRealWriteInstructions/summarizeSgsRealFillPlan from sgs-real-fill.js remain unused; every whole-column-shaped path uses ONLY the structurally single-column buildWholeColumnWriteInstructions or a single-offset writesByOffset built inline in the auto-run loop)', () => {
    expect(source).toContain('fillSgsColumnValues')
    const fillCalls = [...source.matchAll(/func:\s*fillSgsColumnValues,/g)]
    expect(fillCalls.length).toBe(3)
    expect(source).not.toMatch(/buildSgsRealWriteInstructions/)
    expect(source).not.toMatch(/summarizeSgsRealFillPlan/)
    expect(source).not.toContain('runFillSelectedColumn')
    expect(source).not.toContain("getElementById('fill-selected-column')")
    expect(source).toContain('buildWholeColumnWriteInstructions')
  })

  it('NEXT PHASE: the whole-column write call passes writesByOffset straight from buildWholeColumnWriteInstructions — never a hand-built object', () => {
    const fn = source.slice(source.indexOf('async function runWholeColumnWrite'), source.indexOf('wcStartBtn.addEventListener'))
    expect(fn).toMatch(/const { writesByOffset } = buildWholeColumnWriteInstructions\(context\.plan, context\.columnIndex\)/)
    expect(fn).toMatch(/func:\s*fillSgsColumnValues,\s*\n\s*args:\s*\[context\.tableIndex, context\.run\.startIndex, context\.columnIndex, writesByOffset\]/)
  })

  it('the single write call passes writesByOffset straight from buildSingleCellTestPlan — never a hand-built object that could contain more than one offset', () => {
    const fn = source.slice(source.indexOf('async function runSingleCellTestWrite'), source.indexOf('fileInput.addEventListener'))
    expect(fn).toMatch(/func:\s*fillSgsColumnValues,\s*\n\s*args:\s*\[context\.tableIndex, currentGridCandidate\.run\.startIndex, context\.columnIndex, plan\.writesByOffset\]/)
  })

  it('BUG FIX: renderMappingResult ("ตรวจสอบการจับคู่นักเรียน") now feeds REAL extracted SGS candidates into matchStudentsToSgs — never a hardcoded empty array (that was the original bug: real detection existed elsewhere in the file but this button never used it)', () => {
    const fn = source.slice(source.indexOf('function renderMappingResult'), source.indexOf('fileInput.addEventListener'))
    expect(fn).not.toContain('matchStudentsToSgs(krunameStudents, [])')
    expect(fn).toContain('extractCurrentSgsStudentCandidates()')
    expect(fn).toMatch(/matchStudentsToSgs\(krunameStudents,\s*sgsCandidates\)/)
  })

  it('extractCurrentSgsStudentCandidates is the ONE shared extraction path — both renderMappingResult and runColumnPreview call it, so they can never disagree about which SGS rows exist', () => {
    expect(source).toContain('function extractCurrentSgsStudentCandidates')
    const calls = [...source.matchAll(/extractCurrentSgsStudentCandidates\(\)/g)]
    // one definition's own name doesn't match the no-arg call pattern, so
    // every match here is a genuine call site — expect at least the two
    // known callers (renderMappingResult, runColumnPreview).
    expect(calls.length).toBeGreaterThanOrEqual(2)
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

  it('NEXT PHASE: readColumnValues is invoked exactly three times — the read-only section-4 preview, the whole-column page scan (existing scores for the preview table), and the whole-column write\'s own post-write verification read-back — the single-cell path uses its own atomic read instead (see below)', () => {
    const allCalls = [...source.matchAll(/func:\s*readColumnValues,[\s\S]*?args:\s*\[([^\]]*)\]/g)]
    expect(allCalls.length).toBe(3)
    expect(allCalls[0][1]).toMatch(/tableIndex, run\.startIndex, run\.length, confirmedRealColumn\.columnIndex/)
    expect(allCalls[1][1]).toMatch(/candidate\.tableIndex, candidate\.run\.startIndex, candidate\.run\.length, column\.columnIndex/)
    expect(allCalls[2][1]).toMatch(/context\.tableIndex, context\.run\.startIndex, context\.run\.length, context\.columnIndex/)
  })

  it('readSingleCellRevalidationState is invoked exactly twice: once for the single-cell preview, once as the write-time stale-DOM revalidation — never a range, always the SAME one row/column', () => {
    const allCalls = [...source.matchAll(/func:\s*readSingleCellRevalidationState,[\s\S]*?args:\s*\[([^\]]*)\]/g)]
    expect(allCalls.length).toBe(2)
    // The preview call reads the offset row within the confirmed run —
    // never a range, never the confirmed bulk column.
    expect(allCalls[0][1]).toMatch(/tableIndex, absoluteRowIndex, columnIndex, identifierColumns/)
    // The write-time call re-reads the EXACT same cell the preview
    // confirmed (context.*), never re-deriving it from a fresh scan.
    expect(allCalls[1][1]).toMatch(/context\.tableIndex, context\.rowIndex, context\.columnIndex, context\.identifierColumns/)
  })

  it('NEXT PHASE: buildWholeColumnWriteInstructions is called exactly once in the whole file, with a single columnIndex — structurally, no code path here can smuggle a second column into one write', () => {
    const calls = [...source.matchAll(/buildWholeColumnWriteInstructions\(([^)]*)\)/g)]
    expect(calls.length).toBe(1)
    expect(calls[0][1]).toBe('context.plan, context.columnIndex')
  })

  it('NEXT PHASE: never auto-navigates SGS pages — no click()/navigation call anywhere near pagination, and the semi-automatic "เปิดหน้าถัดไปแล้วกด...ดำเนินการต่อ" message is what popup.js shows instead', () => {
    expect(source).not.toMatch(/pagination[\s\S]{0,200}\.click\(\)/i)
    expect(source).not.toMatch(/next[A-Z]?\w*(Page|Btn)[\s\S]{0,100}\.click\(\)/i)
    expect(source).toMatch(/กรุณาเปิดหน้าที่ \$\{pagination\.currentPage \+ 1\} แล้วกด/)
  })

  it('NEXT PHASE: the whole-column write revalidates against a FRESH scan (performLiveGridScan) before writing — a genuine "guard against stale DOM" step, not merely reusing the preview\'s own scan', () => {
    const fn = source.slice(source.indexOf('async function runWholeColumnWrite'), source.indexOf('wcStartBtn.addEventListener'))
    expect(fn).toContain('await performLiveGridScan()')
    expect(fn).toContain('revalidateWholeColumnContext(')
    expect(fn).toMatch(/if \(!revalidation\.ok\)[\s\S]{0,300}disarmWholeColumnWrite\(\)/)
  })

  it('NEXT PHASE: locateColumnOnCurrentPage (never a raw stored columnIndex) is what re-finds the confirmed column on every fresh scan — the shared scan primitive (used by both section 6 and auto-run) and the write-time revalidation both use it', () => {
    const scanFn = source.slice(source.indexOf('async function scanCurrentSgsPageForColumn'), source.indexOf('async function scanCurrentSgsPageForWholeColumn'))
    expect(scanFn).toContain('locateColumnOnCurrentPage(candidate.writableScoreColumns, columnKey)')
    const wrapperFn = source.slice(source.indexOf('async function scanCurrentSgsPageForWholeColumn'), source.indexOf('function renderWholeColumnPreviewFromScan'))
    expect(wrapperFn).toContain('scanCurrentSgsPageForColumn(wcConfirmedColumnKey)')
    const writeFn = source.slice(source.indexOf('async function runWholeColumnWrite'), source.indexOf('wcStartBtn.addEventListener'))
    expect(writeFn).toContain('locateColumnOnCurrentPage(freshCandidate.writableScoreColumns, context.columnKey)')
  })

  it('NEXT PHASE: only "ส่งคอลัมน์นี้ทั้งห้อง" (a brand new session) resets the cumulative cross-page summary — "ดำเนินการต่อ" (the next page of the SAME session) never does', () => {
    const startFn = source.slice(source.indexOf("wcStartBtn.addEventListener"), source.indexOf("wcContinueBtn.addEventListener"))
    expect(startFn).toContain('wcCumulativeSummary = emptyWholeColumnSummary()')
    const continueFn = source.slice(source.indexOf("wcContinueBtn.addEventListener"), source.indexOf("wcOverwriteCheckbox.addEventListener"))
    expect(continueFn).not.toContain('wcCumulativeSummary = emptyWholeColumnSummary()')
    expect(continueFn).not.toContain('wcCumulativeFailedStudents = []')
  })

  it('NEXT PHASE: computeWholeColumnPlan is given the CONFIRMED real column\'s own maxScore, never the Bridge Payload\'s own claimed max', () => {
    const fn = source.slice(source.indexOf('function renderWholeColumnPreviewFromScan'), source.indexOf('function renderWcSubjectClassroomCheck'))
    expect(fn).toMatch(/computeWholeColumnPlan\(krunameStudents, mappingResults, existingScoresBySgsRowKey, overwriteMode, column\.maxScore\)/)
  })

  it('NEXT PHASE (auto-run): runAutoRun checks evaluateAutoRunStopCondition before every write batch, and stops the ENTIRE run (never a partial continue) the moment it fails', () => {
    const fn = source.slice(source.indexOf('async function runAutoRun('), source.indexOf('arStartBtn.addEventListener'))
    expect(fn).toContain('evaluateAutoRunStopCondition(')
    expect(fn).toMatch(/if \(stop\.shouldStop\) \{\s*\n\s*abortAutoRun\(stop\.reason\)\s*\n\s*return\s*\n\s*\}/)
  })

  it('NEXT PHASE (auto-run): every page is revalidated against the SAME first-page snapshot (arConfirmedRunContext), never the previous page\'s own values — a slow drift across pages is caught the same way a sudden one is', () => {
    const fn = source.slice(source.indexOf('async function runAutoRun('), source.indexOf('arStartBtn.addEventListener'))
    expect(fn).toContain('if (!arConfirmedRunContext && scan.ok) arConfirmedRunContext = freshSnapshot')
    expect(fn).toContain('revalidateWholeColumnContext(arConfirmedRunContext, freshSnapshot)')
  })

  it('NEXT PHASE (auto-run): writes exactly one cell at a time (item 7) — a single-entry writesByOffset built fresh per row, never a batch of multiple offsets in one call', () => {
    const fn = source.slice(source.indexOf('async function runAutoRun('), source.indexOf('arStartBtn.addEventListener'))
    expect(fn).toMatch(/const writesByOffset = \{ \[baseRow\.sgsRowOffset\]: baseRow\.krunameScore \}/)
    // Only ONE fillSgsColumnValues call site exists inside this loop.
    const fillCallsInLoop = [...fn.matchAll(/func:\s*fillSgsColumnValues,/g)]
    expect(fillCallsInLoop.length).toBe(1)
  })

  it('NEXT PHASE (auto-run): every write instruction inside the loop carries the SAME confirmed column.columnIndex — structurally, no second column can ever be targeted', () => {
    const fn = source.slice(source.indexOf('async function runAutoRun('), source.indexOf('arStartBtn.addEventListener'))
    const fillArgs = [...fn.matchAll(/func:\s*fillSgsColumnValues,\s*\n\s*args:\s*\[([^\]]*)\]/g)].map((m) => m[1])
    expect(fillArgs.length).toBe(1)
    expect(fillArgs[0]).toContain('column.columnIndex')
    expect(fillArgs[0]).not.toMatch(/columnIndex\s*\+|columnIndex\s*-|column\.columnIndex\s*,\s*.*column\.columnIndex/)
  })

  it('NEXT PHASE (auto-run): each write is followed by a read-back (readSingleColumnCellValue) before the outcome is ever recorded as WRITTEN — never trusting the write call alone', () => {
    const fn = source.slice(source.indexOf('async function runAutoRun('), source.indexOf('arStartBtn.addEventListener'))
    const writeIndex = fn.indexOf('func: fillSgsColumnValues,')
    const readIndex = fn.indexOf('func: readSingleColumnCellValue,')
    expect(writeIndex).toBeGreaterThan(-1)
    expect(readIndex).toBeGreaterThan(writeIndex)
    expect(fn).toMatch(/const outcome = !missing && actualValue === baseRow\.krunameScore \? 'WRITTEN' : 'FAILED'/)
  })

  it('NEXT PHASE (auto-run): "หยุด" only sets a flag the loop checks between rows — never calls anything that could abort a write already in flight, and the loop never starts a NEW write once the flag is set', () => {
    expect(source).toMatch(/arStopBtn\.addEventListener\('click', \(\) => \{\s*\n\s*arStopRequested = true/)
    const fn = source.slice(source.indexOf('async function runAutoRun('), source.indexOf('arStartBtn.addEventListener'))
    expect(fn).toMatch(/if \(arStopRequested\) \{[\s\S]{0,400}continue\s*\n\s*\}/)
  })

  it('NEXT PHASE (auto-run, item 4): after a click reports advanced, the run does NOT trust that alone — the NEXT fresh scan\'s own currentPage is compared against the expected page number before pageAdvancement is ever considered ok', () => {
    const fn = source.slice(source.indexOf('async function runAutoRun('), source.indexOf('arStartBtn.addEventListener'))
    expect(fn).toContain('expectedPageAfterAdvance = expectedNextPage')
    expect(fn).toMatch(/if \(expectedPageAfterAdvance !== null\) \{[\s\S]{0,400}actualPage === expectedPageAfterAdvance/)
    // The click-success branch itself never sets pageAdvancement directly.
    const advancedBranch = fn.slice(fn.indexOf('if (advanceResult.advanced)'), fn.indexOf('if (advanceResult.reason ==='))
    expect(advancedBranch).not.toContain('pageAdvancement = { ok: true')
  })

  it('NEXT PHASE (auto-run): a page-advance is only ever attempted through advanceToNextSgsPage (never a bespoke click), and "no confirmed control" pauses for manual continue rather than aborting or guessing', () => {
    const fn = source.slice(source.indexOf('async function runAutoRun('), source.indexOf('arStartBtn.addEventListener'))
    expect(fn).toContain('func: advanceToNextSgsPage,')
    expect(fn).toMatch(/if \(advanceResult\.reason === 'no_confirmed_next_page_control'\) \{\s*\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*pauseForManualContinue\(/)
  })

  it('NEXT PHASE (auto-run): a failed page-advance that ISN\'T "no confirmed control" (e.g. a timeout after a click) aborts the run — it never silently re-scans the same stale page', () => {
    const fn = source.slice(source.indexOf('async function runAutoRun('), source.indexOf('arStartBtn.addEventListener'))
    const afterPauseCheck = fn.slice(fn.indexOf("no_confirmed_next_page_control'"))
    expect(afterPauseCheck).toContain('abortAutoRun(')
  })

  it('NEXT PHASE (auto-run): a per-page write-failure rate above the safe threshold aborts the run — never silently absorbed into the summary alone', () => {
    const fn = source.slice(source.indexOf('async function runAutoRun('), source.indexOf('arStartBtn.addEventListener'))
    expect(fn).toContain('pageFailureExceedsThreshold(')
    expect(fn).toMatch(/if \(pageThresholdExceeded\) \{\s*\n\s*abortAutoRun\(/)
  })

  it('NEXT PHASE (auto-run): only "เริ่มส่งครบทั้งห้อง" (a brand new run) resets the cumulative summary/report state — "ดำเนินการต่อ" (resuming the SAME run after a manual-continue pause) never does', () => {
    const runBtnFn = source.slice(source.indexOf("arRunBtn.addEventListener"), source.indexOf("arManualContinueBtn.addEventListener"))
    expect(runBtnFn).toContain('arCumulativeSummary = emptyAutoRunSummary()')
    expect(runBtnFn).toContain('arConfirmedRunContext = null')
    const continueBtnFn = source.slice(source.indexOf("arManualContinueBtn.addEventListener"), source.indexOf("arStopBtn.addEventListener"))
    expect(continueBtnFn).not.toContain('arCumulativeSummary = emptyAutoRunSummary()')
    expect(continueBtnFn).not.toContain('arConfirmedRunContext = null')
  })

  it('NEXT PHASE (auto-run): the run report never includes a credential/session/cookie/studentId — buildAutoRunReport\'s own shape is trusted, this only checks popup.js never adds extra fields on top', () => {
    const fn = source.slice(source.indexOf('function renderAutoRunFinalSummary'), source.indexOf('function abortAutoRun'))
    expect(fn).toContain('buildAutoRunReport(')
    expect(fn).not.toMatch(/studentId/)
    expect(fn).not.toMatch(/password|token|cookie|secret|credential/i)
  })

  it('SGS Score Workspace payload: loading and restoring a payload both dispatch by `kind` via validateAnySgsBridgePayload, never the single-kind validator', () => {
    expect(source).toContain('validateAnySgsBridgePayload')
    expect(source).not.toMatch(/\bvalidateSgsBridgePayload\(/)
    const allCalls = [...source.matchAll(/validateAnySgsBridgePayload\(([^)]*)\)/g)]
    expect(allCalls.length).toBe(2)
  })

  it('every loaded/restored payload is normalized via normalizeLoadedPayload before any other function reads it, so the rest of this file never branches on payload shape itself', () => {
    const loadFn = source.slice(source.indexOf('async function loadPayloadFromFile'), source.indexOf('function renderMappingResult'))
    expect(loadFn).toContain('loadedPayload = normalizeLoadedPayload(parsed)')
    const restoreFn = source.slice(source.indexOf('async function restoreSessionPayload'))
    expect(restoreFn).toContain('loadedPayload = normalizeLoadedPayload(payload)')
  })

  it('normalizeLoadedPayload never invents an assignment title for the workspace-kind payload, and never fabricates an overwriteMode not present in the file', () => {
    const fn = source.slice(source.indexOf('function normalizeLoadedPayload'), source.indexOf('function renderPreview'))
    expect(fn).toContain('assignmentTitle: null')
    expect(fn).toContain("overwriteMode: 'skip_existing'")
    expect(fn).toContain('raw.subject.name')
    expect(fn).toContain('raw.classroom.name')
  })

  it('the real-page mapping (matchStudentsToSgs against the ACTUAL extracted rows) only runs from within runColumnPreview, using row text already read by collectAllTableRowFacts', () => {
    const fn = source.slice(source.indexOf('async function runColumnPreview'), source.indexOf('function renderRealFillPreview'))
    expect(fn).toContain('matchStudentsToSgs(krunameStudents, sgsCandidates)')
    expect(fn).toContain('currentGridFacts')
  })

  it('gridMeetsFillRequirements is checked before EVER previewing or populating the single-cell test pickers', () => {
    const gateChecks = [...source.matchAll(/gridMeetsFillRequirements\(/g)]
    expect(gateChecks.length).toBeGreaterThanOrEqual(2)
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

  it('item 5: runColumnPreview re-checks isConfirmedColumnWritable before doing anything real', () => {
    const previewFn = source.slice(source.indexOf('async function runColumnPreview'), source.indexOf('function renderRealFillPreview'))
    expect(previewFn).toContain('isConfirmedColumnWritable(currentGridCandidate, confirmedRealColumn)')
  })

  it('renderRealColumnPicker only ever offers writableScoreColumns as radio options — activatable/derived columns are listed read-only, never selectable, never auto-checked', () => {
    const fn = source.slice(source.indexOf('function renderRealColumnPicker'), source.indexOf('async function runColumnPreview'))
    expect(fn).toContain('gridCandidate.writableScoreColumns.map(')
    expect(fn).toContain('gridCandidate.activatableScoreColumns.map(')
    expect(fn).toContain('gridCandidate.derivedColumns.map(')
    // Neither the activatable nor the derived list may attach a radio
    // input, a change handler, or ever set confirmedRealColumn — and
    // item 3: this file never checks/toggles an SGS checkbox itself.
    const activatableBlock = fn.slice(fn.indexOf('realActivatableColumnsEl.replaceChildren'), fn.indexOf('realDerivedColumnsEl.replaceChildren'))
    const derivedBlock = fn.slice(fn.indexOf('realDerivedColumnsEl.replaceChildren'))
    for (const block of [activatableBlock, derivedBlock]) {
      expect(block).not.toContain("input.type = 'radio'")
      expect(block).not.toContain('confirmedRealColumn = ')
    }
  })

  it('item 3: this file never clicks or toggles an SGS header checkbox — every `.checked =` assignment is either the (unrelated) radio-picker selection state, or one of this extension\'s OWN local popup consent/option toggles (sctConfirmCheckbox, wcConfirmCheckbox, wcOverwriteCheckbox — never anything read from or written into the SGS page itself)', () => {
    const checkedAssignments = [...source.matchAll(/(\w+)\.checked\s*=\s*([^\n]+)/g)]
    expect(checkedAssignments.length).toBeGreaterThan(0)
    const ownConsentCheckboxes = [
      'sctConfirmCheckbox',
      'wcConfirmCheckbox',
      'wcOverwriteCheckbox',
      'arOverwriteCheckbox',
      'arConfirmSubjectClassroomCheckbox',
      'arConfirmAutosaveCheckbox',
    ]
    for (const [, target, rhs] of checkedAssignments) {
      expect(target === 'input' || ownConsentCheckboxes.includes(target)).toBe(true)
      if (target === 'input') expect(rhs).toMatch(/^matchResult\.column/)
      if (ownConsentCheckboxes.includes(target)) expect(rhs.trim()).toBe('false')
    }
    expect(source).not.toMatch(/headerCheckbox.*\.click\(\)/)
    // These consent/option checkboxes are never passed into an injected
    // content-script function — each can only ever be read/set from this
    // extension's own popup DOM, never forwarded into (or read back
    // from) the SGS page. Bounded to a plausible single
    // executeScript({...}) call's length (never unbounded — this
    // codebase has no semicolons, so an unbounded [^;]* would scan past
    // the end of the call entirely).
    for (const checkbox of ownConsentCheckboxes) {
      expect(source).not.toMatch(new RegExp(`executeScript\\([\\s\\S]{0,300}${checkbox}`))
    }
  })

  it('LIVE DISCOVERY: a persistent auto-save warning banner is present in the HTML — the extension never claims a Save button exists', () => {
    const html = read('../src/popup.html')
    expect(html).toMatch(/auto-save-warning/)
    expect(html).toMatch(/Auto-Save/)
  })

  it('CONTROLLED LIVE TEST: the single-cell preview shows นักเรียน/เลขที่/รหัส/ช่อง SGS/คะแนนเดิม SGS/คะแนนใหม่ — the full preview the task requires, not just column/current/new', () => {
    const html = read('../src/popup.html')
    const section = html.slice(html.indexOf('id="single-cell-test-wrap"'), html.indexOf('<script'))
    for (const id of ['sct-student-name', 'sct-student-number', 'sct-student-code', 'sct-column-label', 'sct-current-value', 'sct-new-value']) {
      expect(section).toContain(`id="${id}"`)
    }
  })

  it('CONTROLLED LIVE TEST: the exact required warning string and consent checkbox label are present verbatim', () => {
    const html = read('../src/popup.html')
    const section = html.slice(html.indexOf('id="single-cell-test-wrap"'), html.indexOf('<script'))
    expect(section).toContain('SGS บันทึกอัตโนมัติ การยืนยันจะเปลี่ยนข้อมูลจริงทันที')
    expect(section).toContain('ฉันเข้าใจว่าคะแนนจะถูกบันทึกจริงใน SGS')
  })

  it('CONTROLLED LIVE TEST: sctConfirmCheckbox and sctWriteBtn ship `disabled` in the HTML itself — the safe default holds even before popup.js runs', () => {
    const html = read('../src/popup.html')
    const checkboxTag = html.slice(html.indexOf('id="sct-confirm"') - 40, html.indexOf('id="sct-confirm"') + 40)
    const buttonTag = html.slice(html.indexOf('id="sct-write-btn"') - 40, html.indexOf('id="sct-write-btn"') + 60)
    expect(checkboxTag).toContain('disabled')
    expect(buttonTag).toContain('disabled')
  })

  it('CONTROLLED LIVE TEST: a result panel (student/column/previous/new/status) exists for reporting the outcome of a write', () => {
    const html = read('../src/popup.html')
    const section = html.slice(html.indexOf('id="single-cell-test-wrap"'), html.indexOf('<script'))
    for (const id of ['sct-result', 'sct-result-student', 'sct-result-column', 'sct-result-previous', 'sct-result-new', 'sct-result-status']) {
      expect(section).toContain(`id="${id}"`)
    }
  })

  it('never invents a student grid — always derives it via pickBestStudentGridCandidate over collectAllTableRowFacts\'s real output', () => {
    // BUG FIX: this scan-and-pick logic was extracted into a shared
    // performLiveGridScan() so BOTH runRealColumnInspection (step 4) and
    // runMappingCheck (the mapping button) always read the LIVE page —
    // never a table invented from nothing, and never one caller's stale
    // copy of another caller's scan.
    const scanFn = source.slice(source.indexOf('async function performLiveGridScan'), source.indexOf('async function runRealColumnInspection'))
    expect(scanFn).toContain('collectAllTableRowFacts')
    expect(scanFn).toContain('pickBestStudentGridCandidate(facts.tables)')

    const inspectFn = source.slice(source.indexOf('async function runRealColumnInspection'), source.indexOf('function renderRealColumnPicker'))
    expect(inspectFn).toContain('await performLiveGridScan()')
  })

  it('BUG FIX: the mapping button ("ตรวจสอบการจับคู่นักเรียน") always performs its OWN fresh live scan (performLiveGridScan) before mapping — it never depends on a previous diagnostic run or a previous step-4 inspection having already populated currentGridCandidate/currentGridFacts', () => {
    const fn = source.slice(source.indexOf('async function runMappingCheck'), source.indexOf('fileInput.addEventListener'))
    expect(fn).toContain('await performLiveGridScan()')
    expect(fn).toContain('renderMappingResult(loadedPayload)')
    // The mapping button's click handler calls this atomic function
    // directly — never the old bare renderMappingResult(loadedPayload).
    const listenerBlock = source.slice(source.indexOf("mappingBtn.addEventListener('click'"), source.indexOf("mappingBtn.addEventListener('click'") + 200)
    expect(listenerBlock).toContain('runMappingCheck()')
    expect(listenerBlock).not.toContain('renderMappingResult(loadedPayload)')
  })

  it('the compact diagnostic (section 3, debug-only) never touches currentGridCandidate/currentGridFacts — only performLiveGridScan and runMappingCheck/runRealColumnInspection are allowed to', () => {
    const diagnosticFn = source.slice(
      source.indexOf("diagnosticBtn.addEventListener('click'"),
      source.indexOf("diagnosticDebugBtn.addEventListener('click'"),
    )
    expect(diagnosticFn).not.toContain('currentGridCandidate =')
    expect(diagnosticFn).not.toContain('currentGridFacts =')
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
