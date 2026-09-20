import { existsSync, readFileSync } from 'node:fs'

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

describe('manifest.json — minimal permissions, ONE SGS-only host permission, no remote code', () => {
  const manifest = JSON.parse(read('../manifest.json'))

  it('requests only activeTab/scripting/storage/alarms — never "tabs"/"cookies" or any other broad API permission. FINAL AUTO-RUN EXECUTION BUG FIX: "alarms" is the ONE addition, needed only for the item-6 watchdog (chrome.alarms, unlike setTimeout, survives service worker suspension) — never a background poller/tracker', () => {
    expect(manifest.permissions.sort()).toEqual(['activeTab', 'alarms', 'scripting', 'storage'])
  })

  it('TRUE unattended auto-run: the ONLY host permission is the real SGS domain, scoped to its /sgs/ path — never <all_urls>, never a bare origin, never a second host', () => {
    expect(manifest.host_permissions).toEqual(['https://sgs.bopp-obec.info/sgs/*'])
  })

  it('is Manifest V3', () => {
    expect(manifest.manifest_version).toBe(3)
  })

  it('TRUE unattended auto-run: a background service worker exists, as an ES module (so it can import run-orchestrator.js)', () => {
    expect(manifest.background).toEqual({ service_worker: 'src/background.js', type: 'module' })
  })

  it('TRUE unattended auto-run: exactly one content script, registered ONLY for the same SGS host pattern the host permission grants — never a broader match', () => {
    expect(manifest.content_scripts).toHaveLength(1)
    const [entry] = manifest.content_scripts
    expect(entry.matches).toEqual(['https://sgs.bopp-obec.info/sgs/*'])
    expect(entry.js).toEqual(['src/content-script.js'])
  })

  it('FINAL SGS AUTO-RUN FIX (item 1 — "verify static content script registration"): loads automatically at document_idle on every matching page load/reload/postback — this is what re-populates a fresh, working content script after an ASP.NET postback, never something this extension must trigger itself', () => {
    const [entry] = manifest.content_scripts
    expect(entry.run_at).toBe('document_idle')
  })

  it('FINAL SGS CONTENT SCRIPT FIX (item 1/2/3, exact literal check): the ONE content_scripts entry matches the precise object the fix spec requires, host_permissions grants the SAME pattern, and the referenced js file actually exists on disk at that exact path relative to manifest.json', () => {
    expect(manifest.content_scripts).toEqual([
      {
        matches: ['https://sgs.bopp-obec.info/sgs/*'],
        js: ['src/content-script.js'],
        run_at: 'document_idle',
      },
    ])
    expect(manifest.host_permissions).toContain('https://sgs.bopp-obec.info/sgs/*')
    expect(existsSync(new URL(`../${manifest.content_scripts[0].js[0]}`, import.meta.url))).toBe(true)
  })

  it('TRUE unattended auto-run: web_accessible_resources (needed for content-script.js\'s dynamic import of the pure lib modules) are scoped to the SAME SGS host only — never exposed to any other site. Chrome requires a web_accessible_resources match pattern\'s path to be exactly /* (it rejects the narrower /sgs/* the host permission and content script use), so this one match is intentionally broader than those two, while staying on the SAME host — never a different domain, never <all_urls>', () => {
    expect(manifest.web_accessible_resources).toHaveLength(1)
    const [entry] = manifest.web_accessible_resources
    expect(entry.matches).toEqual(['https://sgs.bopp-obec.info/*'])
    expect(entry.resources).toEqual(
      expect.arrayContaining([
        'src/content-diagnostic.js',
        'src/lib/auto-run.js',
        'src/lib/pagination-control.js',
        'src/lib/whole-column-write.js',
        'src/lib/subject-classroom-match.js',
        'src/lib/mapping.js',
        'src/lib/sgs-table-extraction.js',
        'src/lib/roster.js',
      ]),
    )
  })
})

describe('LIVE-BUG FIX — src/lib/sgs-tab-connection.js: the ONE shared tab-discovery/connection function, so the diagnostic and AR_START can never disagree about which tab is real', () => {
  const source = read('../src/lib/sgs-tab-connection.js')
  const backgroundSource = read('../src/background.js')
  const popupSource = read('../src/popup.js')

  it('never assumes a "current" window — no chrome.tabs.query({active: true, ...}) anywhere in this file\'s CODE (the exact old mechanism that resolved the WRONG tab live; only this file\'s own doc comment mentions the phrase, describing the bug it fixes)', () => {
    const code = source.slice(source.indexOf('import { AR_MESSAGE }'))
    expect(code).not.toMatch(/active:\s*true/)
    expect(code).not.toMatch(/currentWindow:\s*true/)
  })

  it('resolveConnectedSgsTab searches EVERY tab (chrome.tabs.query filtered only by the real SGS url pattern) and PINGs each candidate — a URL match alone is never enough to call a tab "connected"', () => {
    const fn = source.slice(source.indexOf('export async function resolveConnectedSgsTab'))
    expect(fn).toContain('chrome.tabs.query({ url: SGS_TAB_URL_MATCH_PATTERN })')
    expect(fn).toContain('orderCandidatesByPreferredTabId(candidates, preferredTabId)')
    expect(fn).toContain('pingTab(tab.id)')
    expect(fn).toMatch(/connected: true/)
    expect(fn).toMatch(/connected: false/)
  })

  it('a preferredTabId is only ever a HINT — TRACE FIX: it is now PINGed DIRECTLY first (never waiting on chrome.tabs.query to even enumerate it), and if that direct ping fails it is STILL re-tried exactly like every other candidate in the broad search below, never trusted/returned without a fresh PING either way', () => {
    const fn = source.slice(source.indexOf('export async function resolveConnectedSgsTab'))
    const directPingIndex = fn.indexOf('await pingTab(preferredTabId)')
    const queryIndex = fn.indexOf('chrome.tabs.query({ url: SGS_TAB_URL_MATCH_PATTERN })')
    const orderIndex = fn.indexOf('orderCandidatesByPreferredTabId(')
    const loopPingIndex = fn.indexOf('pingTab(tab.id)')
    expect(directPingIndex).toBeGreaterThan(-1)
    expect(directPingIndex).toBeLessThan(queryIndex)
    expect(orderIndex).toBeGreaterThan(queryIndex)
    expect(loopPingIndex).toBeGreaterThan(orderIndex)
  })

  it('item 4: saveVerifiedSgsTab/loadVerifiedSgsTabId persist to chrome.storage.session only — never .local (would survive a browser restart) or .sync (leaves the machine)', () => {
    expect(source).toContain('chrome.storage.session.set({ [VERIFIED_TAB_ID_KEY]: tabId, [VERIFIED_PAGE_URL_KEY]: pageUrl })')
    expect(source).toContain('chrome.storage.session.get(VERIFIED_TAB_ID_KEY)')
    expect(source).not.toMatch(/chrome\.storage\.(local|sync)\.(get|set)\(/)
  })

  it('items 1/2: BOTH background.js (handleStart) and popup.js (the connection diagnostic AND the AR_START click handler) import resolveConnectedSgsTab from THIS exact module — neither ever re-implements its own tab-discovery/ping query. background.js (a service worker with no "current popup window" of its own) never uses the old active-tab pattern at all; popup.js still keeps getActiveTab() (active:true/currentWindow:true) for its OTHER, unrelated features — see the arRunBtn/checkContentScriptConnection-scoped tests above confirming NEITHER of those two calls it any more', () => {
    expect(backgroundSource).toContain("from './lib/sgs-tab-connection.js'")
    expect(backgroundSource).toContain('resolveConnectedSgsTab')
    expect(popupSource).toContain("from './lib/sgs-tab-connection.js'")
    expect(popupSource).toContain('resolveConnectedSgsTab')
    expect(backgroundSource).not.toMatch(/active:\s*true/)
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
  'inspectPaginationControls',
  'clickPaginationControl',
  'readGridFingerprint',
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
    // FINAL PAGINATION FIX: pagination reading (which does read input
    // values) has moved OUT of this function entirely, into
    // inspectPaginationControls — see that function's own describe block.
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

describe('BUG FIX — content-diagnostic.js: inspectPaginationControls, read-only collection of the REAL "<< < 1 ของ 4 > >>" pager cluster', () => {
  const source = sliceFunction(contentDiagnosticSource, 'inspectPaginationControls', CONTENT_DIAGNOSTIC_FUNCTIONS)

  it('never touches document.cookie, localStorage, or sessionStorage', () => {
    expect(source).not.toMatch(/document\.cookie/)
    expect(source).not.toMatch(/localStorage|sessionStorage/)
  })

  it('never calls .click() — this function only ever COLLECTS candidates, never decides or acts', () => {
    expect(source).not.toMatch(/\.click\(\)/)
  })

  it('never writes to .value/.checked — read-only', () => {
    expect(source).not.toMatch(/\.value\s*=(?!=)/)
    expect(source).not.toMatch(/\.checked\s*=(?!=)/)
  })

  it('anchors on the real live-reported "N ของ M" text pattern for total pages, never a guessed selector', () => {
    expect(source).toContain('OF_PATTERN')
    expect(source).toContain('ของ')
  })

  it('supports every real ASP.NET control mechanism the spec lists — anchors, buttons, inputs, images, and a plain onclick — never assumes only one', () => {
    expect(source).toContain('CLICKABLE_SELECTOR')
    expect(source).toMatch(/'a,button,input,img,\[onclick\]'/)
  })

  it('returns the full diagnostic metadata the spec requires: tag, id, name, type, onclick/href, disabled', () => {
    for (const field of ['tag', 'id', 'name', 'type', 'onclick', 'href', 'disabled']) {
      expect(source).toContain(field)
    }
  })

  it('FINAL PAGINATION FIX: also reports value/title/src/className/surroundingText — the full live-diagnostic metadata "ตรวจปุ่มเปลี่ยนหน้า SGS" needs', () => {
    for (const field of ['value', 'title', 'src', 'className', 'surroundingText']) {
      expect(source).toContain(field)
    }
  })

  it('LIVE DOM EVIDENCE: reads currentPage/pageSize/totalPages/totalRows DIRECTLY from their own confirmed ids (findBySuffix) — never nearby/shared text parsing for any of the four', () => {
    expect(source).toContain('findBySuffix')
    expect(source).toMatch(/findBySuffix\('CurrentPage'\)/)
    expect(source).toMatch(/findBySuffix\('PageSize'\)/)
    expect(source).toMatch(/findBySuffix\('TotalPages'\)/)
    expect(source).toMatch(/findBySuffix\('TotalItems'\)/)
    expect(source).toContain('currentPageValue')
    expect(source).toContain('pageSizeValue')
    expect(source).toContain('readOwnNumber')
  })

  it('BUG FIX: never regexes over a SHARED container\'s concatenated text for totalPages/totalRows — the exact bug that turned "4" + "32" into "432" when the two numbers rendered with no separating whitespace', () => {
    expect(source).toMatch(/if \(totalPagesText === null && container\)/)
    const readOwnNumberFn = source.slice(source.indexOf('function readOwnNumber'), source.indexOf('function readOwnNumber') + 300)
    expect(readOwnNumberFn).not.toMatch(/textOf\(container\)/)
  })

  it('enumerates the ENTIRE TblTranscriptsPagination namespace FIRST, never filtered by a guessed suffix before that', () => {
    expect(source).toMatch(/document\.querySelectorAll\(`\[id\*="\$\{NAMESPACE_TOKEN\}"\]`\)/)
    expect(source).toContain("NAMESPACE_TOKEN = 'TblTranscriptsPagination'")
  })

  it('finds the shared pagination container by walking up from the CONFIRMED CurrentPage/PageSize element — never a guessed text anchor first — with a whole-body text-anchor fallback only when no such element exists at all', () => {
    expect(source).toContain('valueAnchorEl')
    expect(source).toMatch(/const valueAnchorEl = currentPageEl \|\| pageSizeEl/)
  })

  it('preserves DOCUMENT ORDER across every collected candidate, and reports which index is CurrentPage — the basis for the DOM-order fallback (item 6), never screen coordinates', () => {
    expect(source).toContain('currentPageDomOrder')
    expect(source).not.toMatch(/getBoundingClientRect|clientX|clientY|offsetLeft|offsetTop/)
  })

  it('total pages/records text-parsing fallback only ever runs when the confirmed TotalPages/TotalItems ids were absent', () => {
    expect(source).toMatch(/if \(totalRowsText === null\) \{/)
    expect(source).toContain('inContainer')
    expect(source).toContain('wholePage')
  })
})

describe('BUG FIX — content-diagnostic.js: clickPaginationControl, the ONLY page-advance click in this whole file', () => {
  const source = sliceFunction(contentDiagnosticSource, 'clickPaginationControl', CONTENT_DIAGNOSTIC_FUNCTIONS)

  it('the ONLY .click() calls anywhere in content-diagnostic.js — both live inside clickPaginationControl (the id-based path and the no-id fallback path)', () => {
    const allClicks = [...contentDiagnosticSource.matchAll(/\.click\(\)/g)]
    expect(allClicks.length).toBe(2)
    expect(source).toContain('byId.click()')
    expect(source).toContain('target.click()')
  })

  it('never calls preventDefault — item 4: "allow the normal page event/postback to execute"', () => {
    expect(contentDiagnosticSource).not.toMatch(/\.preventDefault\(/)
  })

  it('FINAL PAGINATION FIX: re-locates the element fresh via document.getElementById when the confirmed descriptor has an id (globally unique, the now-PREFERRED path since every real pager control is found by its own id) — falling back to an EXACT match on every other captured field only when there is no id to trust, never a loose/partial match', () => {
    expect(source).toMatch(/document\.getElementById\(descriptor\.id\)/)
    expect(source).toMatch(/d\.tag === descriptor\.tag && d\.text === descriptor\.text && d\.onclick === descriptor\.onclick && d\.href === descriptor\.href/)
  })

  it('never toggles a checkbox and never writes an input value — the click target is only ever a pagination control, never a score cell', () => {
    expect(source).not.toMatch(/\.checked\s*=(?!=)/)
    expect(source).not.toMatch(/\.value\s*=(?!=)/)
  })
})

describe('BUG FIX — content-diagnostic.js: readGridFingerprint, a standalone read reusable both before and after a click', () => {
  const source = sliceFunction(contentDiagnosticSource, 'readGridFingerprint', CONTENT_DIAGNOSTIC_FUNCTIONS)

  it('locates the table by the CONFIRMED tableIndex argument, never a re-run heuristic guess', () => {
    expect(source).toContain("document.querySelectorAll('table')[tableIndex]")
  })

  it('read-only, and scoped to only the confirmed run range (runStartIndex..+runLength)', () => {
    expect(source).not.toMatch(/\.value\s*=(?!=)/)
    expect(source).not.toMatch(/\.click\(\)/)
    expect(source).toContain('runStartIndex, runStartIndex + runLength')
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

  it('TRUE unattended auto-run: fillSgsColumnValues is called exactly twice in popup.js — the single-cell path and the whole-column (semi-automatic) path; the auto-run per-cell loop now lives in content-script.js instead, calling the SAME function directly (no executeScript) — and STILL never via the old ad hoc bulk instruction builders (buildSgsRealWriteInstructions/summarizeSgsRealFillPlan from sgs-real-fill.js remain unused; every whole-column-shaped path uses ONLY the structurally single-column buildWholeColumnWriteInstructions or a single-offset writesByOffset)', () => {
    expect(source).toContain('fillSgsColumnValues')
    const fillCalls = [...source.matchAll(/func:\s*fillSgsColumnValues,/g)]
    expect(fillCalls.length).toBe(2)
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

  it('TRUE unattended auto-run: popup.js never runs the loop itself any more — no chrome.scripting.executeScript call anywhere near auto-run, and no local runAutoRun/pollForConfirmedPageAdvance/persistActiveAutoRunState function exists', () => {
    expect(source).not.toMatch(/\basync function runAutoRun\(/)
    expect(source).not.toMatch(/\bpollForConfirmedPageAdvance\b/)
    expect(source).not.toMatch(/\bpersistActiveAutoRunState\b/)
    expect(source).not.toMatch(/\bAUTO_RUN_STORAGE_KEY\b/)
  })

  it('FINAL PAGINATION FIX: "ตรวจปุ่มเปลี่ยนหน้า SGS" runs a read-only inspection and renders buildPaginationDiagnosticReport\'s output — it never starts, stops, or otherwise touches an active run', () => {
    const fn = source.slice(source.indexOf('async function runPaginationDiagnostic'), source.indexOf('arInspectPaginationBtn.addEventListener'))
    expect(fn).toContain('func: inspectPaginationControls')
    expect(fn).toContain('buildPaginationDiagnosticReport(')
    expect(fn).not.toMatch(/AR_MESSAGE\.(START|STOP|MANUAL_CONTINUE)/)
  })

  it('LIVE-BUG FIX (item 5): "ตรวจสอบการเชื่อมต่อ Content Script" is a standalone, on-demand diagnostic calling the SAME resolveConnectedSgsTab AR_START itself uses (never its own separate getActiveTab/PING logic — the exact divergence that caused the live bug) and renders CONNECTED/NOT CONNECTED plus the content script\'s own reported pageUrl and the resolved tab\'s own id — never a value merely assumed. A CONNECTED result is persisted via saveVerifiedSgsTab so a later AR_START can reuse it', () => {
    const fn = source.slice(source.indexOf('async function checkContentScriptConnection'), source.indexOf('arCheckConnectionBtn.addEventListener') + 100)
    expect(fn).toContain('resolveConnectedSgsTab(await loadVerifiedSgsTabId())')
    expect(fn).toContain("resolved.connected ? 'CONNECTED' : 'NOT CONNECTED'")
    expect(fn).toContain('arConnectionPageUrlEl.textContent = resolved.pageUrl')
    expect(fn).toContain('arConnectionTabIdEl.textContent')
    expect(fn).toContain('await saveVerifiedSgsTab(resolved.tabId, resolved.pageUrl)')
    expect(fn).not.toMatch(/AR_MESSAGE\.(START|STOP|MANUAL_CONTINUE)/)
    expect(fn).not.toContain('getActiveTab()')
  })

  it('FINAL SGS CONTENT SCRIPT FIX (item 5): the connection check only ever runs from an explicit button click — never automatically on popup open (the SAME "no diagnostic runs without a click" rule every other on-demand check in this file follows)', () => {
    expect(source).toMatch(/arCheckConnectionBtn\.addEventListener\('click', \(\) => \{\s*\n\s*void checkContentScriptConnection\(\)/)
  })

  it('TRUE unattended auto-run (item 3): "เริ่มส่งครบทั้งห้อง" sends exactly one AR_START message carrying the teacher\'s approval (subject/classroom/targetColumn/payload/overwriteMode/tabId) to background.js — the run itself is never started any other way', () => {
    const fn = source.slice(source.indexOf("arRunBtn.addEventListener"), source.indexOf("arManualContinueBtn.addEventListener"))
    expect(fn).toContain('type: AR_MESSAGE.START')
    expect(fn).toContain('tabId: resolvedTab.tabId')
    expect(fn).toContain('subject: loadedPayload.subjectName')
    expect(fn).toContain('classroom: loadedPayload.classroomName')
    expect(fn).toContain('payload: loadedPayload')
    const startCalls = [...fn.matchAll(/chrome\.runtime\s*\n?\s*\.sendMessage\(/g)]
    expect(startCalls.length).toBe(1)
  })

  it('LIVE-BUG FIX (item 1/3): "เริ่มส่งครบทั้งห้อง" resolves its tab via resolveConnectedSgsTab (the SAME shared function the connection-check diagnostic uses) — never chrome.tabs.query({active:true, currentWindow:true})/getActiveTab(), which resolves relative to whichever window is merely "current," not an actual search for the real SGS tab. Refuses to send AR_START at all (with CONTENT_SCRIPT_UNAVAILABLE_MESSAGE) if no connected SGS tab can be found — before it even inspects pagination', () => {
    const fn = source.slice(source.indexOf('arRunBtn.addEventListener'), source.indexOf('arManualContinueBtn.addEventListener'))
    const resolveIndex = fn.indexOf('resolveConnectedSgsTab(await loadVerifiedSgsTabId())')
    const guardIndex = fn.indexOf('if (!resolvedTab.connected)')
    const inspectIndex = fn.indexOf('func: inspectPaginationControls')
    expect(resolveIndex).toBeGreaterThan(-1)
    expect(guardIndex).toBeGreaterThan(resolveIndex)
    expect(inspectIndex).toBeGreaterThan(guardIndex)
    expect(fn).toContain('target: { tabId: resolvedTab.tabId }')
    expect(fn).toContain('await saveVerifiedSgsTab(resolvedTab.tabId, resolvedTab.pageUrl)')
    expect(fn).toMatch(/if \(!resolvedTab\.connected\) \{\s*\n\s*arAbortReasonEl\.textContent = CONTENT_SCRIPT_UNAVAILABLE_MESSAGE/)
    expect(fn).not.toContain('getActiveTab()')
    expect(fn).not.toMatch(/chrome\.tabs\.query\(\{\s*active:\s*true/)
  })

  it('FINAL AUTO-RUN STATE BUG FIX (item 1): "เริ่มส่งครบทั้งห้อง" ALWAYS takes a brand-new live pagination inspection (chrome.scripting.executeScript with func: inspectPaginationControls, then buildPaginationDiagnosticReport) at the exact moment of the click — never reading from a stale/previously-computed snapshot such as currentPagination — and that fresh read happens BEFORE the AR_START message is sent', () => {
    const fn = source.slice(source.indexOf('arRunBtn.addEventListener'), source.indexOf('arManualContinueBtn.addEventListener'))
    const inspectIndex = fn.indexOf('func: inspectPaginationControls')
    const reportIndex = fn.indexOf('buildPaginationDiagnosticReport(paginationInjection.result)')
    const sendIndex = fn.indexOf('type: AR_MESSAGE.START')
    expect(inspectIndex).toBeGreaterThan(-1)
    expect(reportIndex).toBeGreaterThan(inspectIndex)
    expect(sendIndex).toBeGreaterThan(reportIndex)
    expect(fn).not.toMatch(/\bcurrentPagination\b/)
  })

  it('FINAL AUTO-RUN STATE BUG FIX (item 6): "เริ่มส่งครบทั้งห้อง" refuses to send AR_START at all when the fresh inspection fails isPaginationHydrationValid — shows the shared PAGINATION_HYDRATION_FAILED_MESSAGE via arAbortReasonEl instead, and also surfaces background.js\'s own reason (its independent, authoritative copy of the same guard) if THAT refuses', () => {
    const fn = source.slice(source.indexOf('arRunBtn.addEventListener'), source.indexOf('arManualContinueBtn.addEventListener'))
    const guardIndex = fn.indexOf('isPaginationHydrationValid(pagination)')
    const sendIndex = fn.indexOf('type: AR_MESSAGE.START')
    expect(guardIndex).toBeGreaterThan(-1)
    expect(guardIndex).toBeLessThan(sendIndex)
    expect(fn).toMatch(/if \(!isPaginationHydrationValid\(pagination\)\) \{\s*\n\s*arAbortReasonEl\.textContent = PAGINATION_HYDRATION_FAILED_MESSAGE\s*\n\s*arAbortReasonEl\.hidden = false/)
    expect(fn).toMatch(/if \(!response\?\.ok\) \{\s*\n\s*arAbortReasonEl\.textContent = response\?\.reason \?\? PAGINATION_HYDRATION_FAILED_MESSAGE/)
    // TRACE THE EXACT AR_START FAILURE — every one of this handler's own
    // refusal paths ALSO records a visibly distinct debug-panel entry, so
    // a live test can tell a popup-side pre-flight abort (PRERUN_*, no
    // AR_START ever sent) apart from a background-side handleStart abort.
    expect(fn).toContain("step: 'PRERUN_PAGINATION_INVALID'")
    expect(fn).toContain("step: 'PRERUN_RESOLVE_FAILED'")
    expect(fn).toContain('await refreshStartupTraceFromBackground()')
    expect(source).toContain(
      "import { AR_MESSAGE, CONTENT_SCRIPT_UNAVAILABLE_MESSAGE, isPaginationHydrationValid, PAGINATION_HYDRATION_FAILED_MESSAGE } from './lib/run-orchestrator.js'",
    )
  })

  it('FINAL AUTO-RUN STATE BUG FIX (item 4): the AR_START message carries the ONE canonical pagination shape (currentPage/totalPages/totalStudentRows/pageSize), translated from buildPaginationDiagnosticReport\'s teacher-facing totalRows field — never sent as totalRows itself, and never dropped', () => {
    const fn = source.slice(source.indexOf('arRunBtn.addEventListener'), source.indexOf('arManualContinueBtn.addEventListener'))
    expect(fn).toContain('currentPage: paginationReport.currentPage,')
    expect(fn).toContain('totalPages: paginationReport.totalPages,')
    expect(fn).toContain('totalStudentRows: paginationReport.totalRows,')
    expect(fn).toContain('pageSize: paginationReport.pageSize,')
    expect(fn).toContain('pagination,')
  })

  it('TRUE unattended auto-run (item 6): "หยุด" only ever sends AR_STOP to background.js — it never sets a local flag or touches any write in flight itself', () => {
    const fn = source.slice(source.indexOf("arStopBtn.addEventListener"), source.indexOf("arCopyReportBtn.addEventListener"))
    expect(fn).toContain('type: AR_MESSAGE.STOP')
    expect(fn).not.toMatch(/arStopRequested/)
  })

  it('TRUE unattended auto-run (item 6): "ดำเนินการต่อ" only ever sends AR_MANUAL_CONTINUE to background.js — it never re-drives any scan/write loop itself', () => {
    const fn = source.slice(source.indexOf("arManualContinueBtn.addEventListener"), source.indexOf("arStopBtn.addEventListener"))
    expect(fn).toContain('type: AR_MESSAGE.MANUAL_CONTINUE')
  })

  it('TRUE unattended auto-run (item 3): popup.js renders run state from a SINGLE function (renderAutoRunFromState), fed by both an AR_GET_STATE reply and an AR_STATE_CHANGED broadcast — never two different rendering paths that could show conflicting progress', () => {
    expect(source).toContain('function renderAutoRunFromState(state)')
    const getStateFn = source.slice(source.indexOf('async function restoreAutoRunStateFromBackground'), source.length)
    expect(getStateFn).toContain('renderAutoRunFromState(response?.state ?? null)')
    const listenerFn = source.slice(
      source.indexOf('chrome.runtime.onMessage.addListener((message) => {'),
      source.indexOf('chrome.runtime.onMessage.addListener((message) => {') + 400,
    )
    expect(listenerFn).toContain('AR_MESSAGE.STATE_CHANGED')
    expect(listenerFn).toContain('renderAutoRunFromState(message.state)')
  })

  it('FINAL SGS AUTO-RUN FIX (item 6): the SAME onMessage listener also renders AR_STARTUP_TRACE broadcasts (renderStartupTrace) — the connection-handshake trace shows up live in Section 7 exactly like run-state progress does, without needing a separate listener', () => {
    const listenerFn = source.slice(
      source.indexOf('chrome.runtime.onMessage.addListener((message) => {'),
      source.indexOf('chrome.runtime.onMessage.addListener((message) => {') + 500,
    )
    expect(listenerFn).toContain('AR_MESSAGE.STARTUP_TRACE')
    expect(listenerFn).toContain('renderStartupTrace(message.step, message.detail)')
  })

  it('FINAL SGS AUTO-RUN FIX (item 6): renderStartupTrace shows the step and visually flags PING_FAILED (or any step whose own detail says failed) — "if it aborts, show exactly which step failed"', () => {
    const fn = source.slice(source.indexOf('function renderStartupTrace('), source.indexOf('function renderStartupTrace(') + 500)
    expect(fn).toContain("step === 'PING_FAILED'")
    expect(fn).toContain('arStartupTraceEl.textContent')
    expect(fn).toContain('arStartupTraceEl.hidden = false')
  })

  it('FINAL SGS AUTO-RUN FIX: "เริ่มส่งครบทั้งห้อง" clears/hides the previous attempt\'s startup trace before taking a fresh pagination reading, and hides it again once a run actually starts successfully', () => {
    const fn = source.slice(source.indexOf('arRunBtn.addEventListener'), source.indexOf('arManualContinueBtn.addEventListener'))
    expect(fn).toContain('arStartupTraceEl.hidden = true')
    const hideOccurrences = [...fn.matchAll(/arStartupTraceEl\.hidden = true/g)]
    expect(hideOccurrences.length).toBe(2)
  })

  it('TRUE unattended auto-run (item 7): the final summary/report is built entirely from background.js\'s own reported state (state.summary/state.pagesProcessed/state.allStudentResults) — never a local module-level accumulator', () => {
    const fn = source.slice(source.indexOf('function renderAutoRunFinalSummary('), source.indexOf('function renderAutoRunFromState'))
    expect(fn).toContain('buildAutoRunReport(')
    expect(fn).toContain('state.summary')
    expect(fn).toContain('state.pagesProcessed')
    expect(fn).toContain('state.allStudentResults')
    expect(fn).not.toMatch(/studentId/)
    expect(fn).not.toMatch(/password|token|cookie|secret|credential/i)
  })

  it('TRUE unattended auto-run (item 3/4): on every popup open, background.js reports its own current state for the active tab, which is fetched and rendered — never anything reconstructed from a previous popup session\'s own local state', () => {
    expect(source).toMatch(/void restoreSessionPayload\(\)\.then\(\(\) => restoreAutoRunStateFromBackground\(\)\)/)
    const fn = source.slice(source.indexOf('async function restoreAutoRunStateFromBackground'), source.length)
    expect(fn).toContain('type: AR_MESSAGE.GET_STATE')
  })

  it('TRUE unattended auto-run: a fresh step-4 rescan (resetAutoRunState) tells background.js to stop any active run for this tab, rather than only clearing local state popup.js no longer keeps', () => {
    const fn = source.slice(source.indexOf('function resetAutoRunState'), source.indexOf('/**\n * Item 5, kept hidden'))
    expect(fn).toContain('type: AR_MESSAGE.STOP')
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
      if (ownConsentCheckboxes.includes(target)) {
        // Every reset path sets these to a literal `false`. The ONE
        // exception is arOverwriteCheckbox being restored from a
        // PREVIOUSLY PERSISTED run's own overwriteMode choice on popup
        // reopen (item 4/5) — still this extension's OWN stored state,
        // never anything read from the SGS page itself.
        const isRestoredOverwriteChoice = target === 'arOverwriteCheckbox' && rhs.trim() === "state.overwriteMode === 'overwrite_selected_column'"
        expect(rhs.trim() === 'false' || isRestoredOverwriteChoice).toBe(true)
      }
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

describe('TRUE unattended auto-run — background.js: the ONE place run state lives, never the DOM/cookies/tabs content itself', () => {
  const source = read('../src/background.js')

  it('never reads document/window/cookies — it is a service worker with no DOM, and this file never pretends otherwise', () => {
    expect(source).not.toMatch(/\bdocument\./)
    expect(source).not.toMatch(/\bwindow\./)
    expect(source).not.toMatch(/document\.cookie/)
    expect(source).not.toMatch(/\.password\b|\.authToken\b|\.secret\b|\.credential\b/i)
  })

  it('never performs a network request — no fetch/XHR, this stays a purely local message router', () => {
    expect(source).not.toMatch(/\bfetch\(/)
    expect(source).not.toMatch(/XMLHttpRequest/)
  })

  it('persists run state only under chrome.storage.session — never chrome.storage.sync (leaves the machine) or chrome.storage.local (survives a browser restart, which a same-session run must never do)', () => {
    expect(source).toContain('chrome.storage.session.get')
    expect(source).toContain('chrome.storage.session.set')
    expect(source).not.toMatch(/chrome\.storage\.sync\.(get|set)\(/)
    expect(source).not.toMatch(/chrome\.storage\.local\.(get|set)\(/)
  })

  it('every state transition is a pure call into run-orchestrator.js — this file never mutates a stored state object by hand', () => {
    expect(source).toContain("from './lib/run-orchestrator.js'")
    for (const fn of ['createInitialRunState', 'applyStopRequested', 'applyResume', 'applyPageProgress', 'applyPageComplete', 'applyManualPause', 'applyAbort', 'applyStopped', 'applyCompleted']) {
      expect(source).toContain(fn)
    }
  })

  it('item 3: AR_START stores runId/tabId/subject/classroom/targetColumn/payload/overwriteMode/currentPage/totalPages/summary/approved (via createInitialRunState) and immediately kicks off content-script.js in that SAME tab — never a different tab. TRACE FIX: the kickoff send is now AWAITED (never fire-and-forget) so its own success/failure is a real, reportable checkpoint', () => {
    const fn = source.slice(source.indexOf('async function handleStart'), source.indexOf('async function handleWatchdogAlarm'))
    expect(fn).toContain('createInitialRunState(')
    expect(fn).toMatch(/await chrome\.tabs\.sendMessage\(tabId, \{ type: AR_MESSAGE\.KICKOFF, runId: state\.runId \}\)/)
    // Still only ever the resolved tab's own id — never message.tabId.
    expect(fn).not.toMatch(/sendMessage\(message\.tabId/)
  })

  it('FINAL AUTO-RUN STATE BUG FIX (item 2/6): handleStart is the SECOND, authoritative pagination-hydration guard — it checks isPaginationHydrationValid(pagination) and refuses to EVER call createInitialRunState (or persist any state) when that check fails, returning the shared PAGINATION_HYDRATION_FAILED_MESSAGE instead', () => {
    const fn = source.slice(source.indexOf('async function handleStart'), source.indexOf('async function handleStop'))
    const guardIndex = fn.indexOf('isPaginationHydrationValid(pagination)')
    const createIndex = fn.indexOf('createInitialRunState(')
    expect(guardIndex).toBeGreaterThan(-1)
    expect(createIndex).toBeGreaterThan(guardIndex)
    // REMOVE GENERIC ERROR COLLAPSING — the teacher-facing Thai sentence
    // is unchanged, but the refusal now ALSO carries its own machine
    // readable errorCode, and records a PAGINATION_VALID checkpoint
    // naming the abort reason.
    expect(fn).toMatch(
      /if \(!isPaginationHydrationValid\(pagination\)\) \{[\s\S]{0,220}return \{ ok: false, state: null, reason: PAGINATION_HYDRATION_FAILED_MESSAGE, errorCode: AR_ERROR_CODE\.PAGINATION_INVALID \}/,
    )
    expect(source).toContain("isPaginationHydrationValid,\n  PAGINATION_HYDRATION_FAILED_MESSAGE,")
  })

  it('handleStart passes the CALLER\'s own fresh pagination fields straight through to createInitialRunState — never re-deriving or defaulting currentPage/totalPages itself (only the optional totalStudentRows/pageSize fall back to null)', () => {
    const fn = source.slice(source.indexOf('async function handleStart'), source.indexOf('async function handleStop'))
    expect(fn).toContain('currentPage: pagination.currentPage,')
    expect(fn).toContain('totalPages: pagination.totalPages,')
    expect(fn).toContain('totalStudentRows: pagination.totalStudentRows ?? null,')
    expect(fn).toContain('pageSize: pagination.pageSize ?? null,')
  })

  it('LIVE-BUG FIX (item 1/2): handleStart resolves its tab via resolveConnectedSgsTab (the SAME shared function popup.js\'s diagnostic AND its own AR_START handler both call — never its own separate tab-discovery/ping logic) BEFORE ever calling createInitialRunState — pagination succeeding is never itself treated as proof the tab can be messaged, and popup\'s own message.tabId is only ever a PREFERRED hint, never trusted outright', () => {
    const fn = source.slice(source.indexOf('async function handleStart'), source.indexOf('async function handleWatchdogAlarm'))
    const resolveIndex = fn.indexOf('resolveConnectedSgsTab(suppliedTabId)')
    const createIndex = fn.indexOf('createInitialRunState(')
    expect(resolveIndex).toBeGreaterThan(-1)
    expect(createIndex).toBeGreaterThan(resolveIndex)
    // popup's own tabId is read into `suppliedTabId` and passed ONLY as
    // resolveConnectedSgsTab's preferred hint — never destructured into a
    // bare `tabId` that could be mistaken for the resolved one (the
    // resolved id is a SEPARATE `const tabId = resolved.tabId`, below).
    expect(fn).toContain('const suppliedTabId = message?.tabId ?? null')
    expect(fn).not.toMatch(/const \{ tabId,/)
  })

  it('FINAL AUTO-RUN EXECUTION BUG FIX (item 2/6 — "missing content script aborts clearly"): when NEITHER the initial resolveConnectedSgsTab NOR the ensureContentScriptReady healing fallback finds a connected tab, handleStart returns ok:false with CONTENT_SCRIPT_UNAVAILABLE_MESSAGE and NEVER reaches createInitialRunState/setState at all — no run is ever left dangling at 0/32 for a tab this file could never even reach', () => {
    const fn = source.slice(source.indexOf('async function handleStart'), source.indexOf('async function handleWatchdogAlarm'))
    // The healing fallback is still tried ONLY after the first resolve
    // failed, and the final refusal still returns the SAME teacher-facing
    // message — now alongside its own machine-readable errorCode (REMOVE
    // GENERIC ERROR COLLAPSING) and an AR_START_ABORTED trace entry.
    expect(fn).toMatch(/if \(!resolved\.connected\) \{\s*\n\s*resolved = await ensureContentScriptReady\(suppliedTabId\)\s*\n\s*\}/)
    expect(fn).toContain('return { ok: false, state: null, reason: abortReason, errorCode }')
    expect(fn).toContain("const errorCode = resolved.errorCode ?? AR_ERROR_CODE.SGS_TAB_NOT_FOUND")
    const abortGuardIndex = fn.indexOf('const abortReason = CONTENT_SCRIPT_UNAVAILABLE_MESSAGE')
    const setStateIndex = fn.indexOf('await setState(state)')
    const createIndex = fn.indexOf('createInitialRunState(')
    expect(abortGuardIndex).toBeGreaterThan(-1)
    expect(setStateIndex).toBeGreaterThan(abortGuardIndex)
    expect(createIndex).toBeGreaterThan(abortGuardIndex)
  })

  it('TRACE THE EXACT AR_START FAILURE: handleStart records EVERY required checkpoint, in order — AR_START_ENTER first (before the message body is even read), then INPUT_RECEIVED/PAGINATION_VALID/RESOLVER_BEGIN/RESOLVER_RESULT/PING_BEGIN/PING_RESULT/RUN_STATE_CREATED/KICKOFF_BEGIN/PROCESS_CURRENT_PAGE_SEND_BEGIN/PROCESS_CURRENT_PAGE_SEND_RESULT/AR_START_SUCCESS — and every early return identifies itself with an AR_START_ABORTED entry carrying the real errorCode', () => {
    const fn = source.slice(source.indexOf('async function handleStart'), source.indexOf('async function handleWatchdogAlarm'))
    const ordered = [
      'AR_START_ENTER',
      'AR_START_INPUT_RECEIVED',
      'PAGINATION_VALID',
      'RESOLVER_BEGIN',
      'RESOLVER_RESULT',
      'PING_BEGIN',
      'PING_RESULT',
      'RUN_STATE_CREATED',
      'KICKOFF_BEGIN',
      'PROCESS_CURRENT_PAGE_SEND_BEGIN',
      'PROCESS_CURRENT_PAGE_SEND_RESULT',
      'AR_START_SUCCESS',
    ]
    let previousIndex = -1
    for (const step of ordered) {
      const index = fn.indexOf(`recordStartupTrace('${step}'`)
      expect(index, `missing checkpoint ${step}`).toBeGreaterThan(-1)
      expect(index, `checkpoint ${step} out of order`).toBeGreaterThan(previousIndex)
      previousIndex = index
    }
    // AR_START_ENTER is genuinely FIRST — nothing (not even reading the
    // message body) happens before it.
    expect(fn).toMatch(/async function handleStart\(message\) \{[\s\S]{0,600}?await recordStartupTrace\('AR_START_ENTER'/)
    // Every early return identifies itself.
    const abortCalls = [...fn.matchAll(/recordStartupTrace\('AR_START_ABORTED'/g)]
    expect(abortCalls.length).toBeGreaterThanOrEqual(2)
  })

  it('REMOVE GENERIC ERROR COLLAPSING: every failed AR_START response carries a machine-readable errorCode from the shared AR_ERROR_CODE vocabulary — never only the collapsed Thai sentence', () => {
    const fn = source.slice(source.indexOf('async function handleStart'), source.indexOf('async function handleWatchdogAlarm'))
    const failedReturns = [...fn.matchAll(/return \{ ok: false, state: null, reason: [^}]*\}/g)].map((m) => m[0])
    expect(failedReturns.length).toBeGreaterThanOrEqual(3)
    for (const failedReturn of failedReturns) {
      expect(failedReturn, failedReturn).toMatch(/errorCode/)
    }
    expect(source).toContain('AR_ERROR_CODE')
  })

  it('FINAL AUTO-RUN EXECUTION BUG FIX (item 1 — "start page 1 immediately"): once both guards pass, AR_KICKOFF is dispatched in the SAME handleStart call, using the RESOLVED tab\'s own id (never necessarily message.tabId) — never deferred to a navigation/reload event', () => {
    const fn = source.slice(source.indexOf('async function handleStart'), source.indexOf('async function handleWatchdogAlarm'))
    const setStateIndex = fn.indexOf('await setState(state)')
    const kickoffIndex = fn.indexOf('await chrome.tabs.sendMessage(tabId, { type: AR_MESSAGE.KICKOFF')
    expect(setStateIndex).toBeGreaterThan(-1)
    expect(kickoffIndex).toBeGreaterThan(setStateIndex)
    expect(fn).toContain('const tabId = resolved.tabId')
    expect(fn).toContain('await saveVerifiedSgsTab(tabId, resolved.pageUrl)')
  })

  it('TRACE FIX: a KICKOFF that cannot reach the tab is reported (KICKOFF_SEND_FAILED) but never itself aborts the already-created run — content-script.js\'s own AR_CHECK_ACTIVE/AR_SGS_CONTENT_READY paths still pick it up', () => {
    const fn = source.slice(source.indexOf('async function handleStart'), source.indexOf('async function handleWatchdogAlarm'))
    const kickoffBlock = fn.slice(fn.indexOf('PROCESS_CURRENT_PAGE_SEND_BEGIN'))
    expect(kickoffBlock).toContain('AR_ERROR_CODE.KICKOFF_SEND_FAILED')
    // Never turns into a refusal — AR_START_SUCCESS is still reached.
    expect(kickoffBlock).not.toMatch(/return \{ ok: false/)
    expect(kickoffBlock).toContain("recordStartupTrace('AR_START_SUCCESS'")
  })

  it('LIVE-BUG FIX (item 3): ensureContentScriptReady is ONLY called after handleStart\'s own initial resolveConnectedSgsTab already failed to find ANY connected tab — it injects once, then RE-RESOLVES via the SAME shared resolveConnectedSgsTab (never a separate/duplicated ping call) before ever trying the reload tier', () => {
    const fn = source.slice(source.indexOf('async function ensureContentScriptReady'), source.indexOf('async function handleStart'))
    expect(fn).toContain("chrome.scripting.executeScript({ target: { tabId }, files: ['src/content-script.js'] })")
    const injectIndex = fn.indexOf('chrome.scripting.executeScript(')
    const firstResolveIndex = fn.indexOf('resolveConnectedSgsTab(tabId)')
    expect(firstResolveIndex).toBeGreaterThan(injectIndex)
    const injectCalls = [...fn.matchAll(/chrome\.scripting\.executeScript\(/g)]
    expect(injectCalls.length).toBe(1)
    const resolveCalls = [...fn.matchAll(/resolveConnectedSgsTab\(tabId\)/g)]
    expect(resolveCalls.length).toBe(2)
  })

  it('FINAL SGS AUTO-RUN FIX (item 3): "only abort if retry still fails" — a SECOND tier (chrome.tabs.reload, then one more resolveConnectedSgsTab) is tried before ever giving up, since re-injecting more code cannot heal an ORPHANED content script (its own already-loaded guard blocks a second registration) — only a real navigation can', () => {
    const fn = source.slice(source.indexOf('async function ensureContentScriptReady'), source.indexOf('async function handleStart'))
    const injectIndex = fn.indexOf('chrome.scripting.executeScript(')
    const reloadIndex = fn.indexOf('chrome.tabs.reload(tabId)')
    // TRACE FIX: the final give-up now returns the resolver's OWN result
    // (which already carries connected:false PLUS the real errorCode/
    // errorMessage) rather than a hand-built, information-free object.
    const finalReturn = fn.lastIndexOf('return resolved')
    expect(reloadIndex).toBeGreaterThan(injectIndex)
    expect(finalReturn).toBeGreaterThan(reloadIndex)
    expect(fn).toMatch(/recordStartupTrace\('PING_FAILED'[\s\S]{0,160}afterReload|failed_after_reload/)
  })

  it('FINAL AUTO-RUN EXECUTION BUG FIX (item 3 — service worker lifecycle): the watchdog itself is scheduled via chrome.alarms, which keeps firing even after this service worker is suspended — never setInterval, which does not survive suspension and would silently never fire. (waitForTabLoadComplete\'s own bounded setTimeout is a different, short-lived wait entirely WITHIN one already-in-flight AR_START response — see its own doc comment — never a substitute for the alarm)', () => {
    expect(source).toContain('chrome.alarms.create(watchdogAlarmName(state.runId)')
    expect(source).toContain('chrome.alarms.onAlarm.addListener(')
    expect(source).not.toMatch(/\bsetInterval\(/)
  })

  it('the one setTimeout in this file exists ONLY inside waitForTabLoadComplete\'s own bounded reload-wait — never used to schedule the watchdog itself', () => {
    const setTimeoutCalls = [...source.matchAll(/\bsetTimeout\(/g)]
    expect(setTimeoutCalls.length).toBe(1)
    const fn = source.slice(source.indexOf('function waitForTabLoadComplete'), source.indexOf('const RELOAD_WAIT_TIMEOUT_MS'))
    expect(fn).toContain('setTimeout(finish, timeoutMs)')
  })

  it('FINAL AUTO-RUN EXECUTION BUG FIX (item 6 — "never leave a dead run"): handleWatchdogAlarm re-reads the PERSISTED state fresh (never a module-level variable this worker could have lost across a suspension) and applies the pure shouldAbortForMissingProcessing/applyAbort pair, never inlining its own ad hoc condition', () => {
    const fn = source.slice(source.indexOf('async function handleWatchdogAlarm'), source.indexOf('chrome.alarms.onAlarm.addListener'))
    expect(fn).toContain('runIdFromWatchdogAlarmName(alarmName)')
    expect(fn).toContain('await getState()')
    expect(fn).toContain('shouldAbortForMissingProcessing(state, alarmRunId)')
    expect(fn).toContain('applyAbort(state, CONTENT_SCRIPT_UNAVAILABLE_MESSAGE)')
  })

  it('FINAL AUTO-RUN EXECUTION BUG FIX (item 6): the FIRST AR_PAGE_PROGRESS for a run clears its own watchdog alarm — a run that proved it started processing can never be aborted by a stale timer', () => {
    const fn = source.slice(source.indexOf('async function handlePageProgress'), source.indexOf('async function handleDebugEvent'))
    expect(fn).toContain('applyPageProgress(state,')
    expect(fn).toMatch(/chrome\.alarms\.clear\(watchdogAlarmName\(state\.runId\)\)/)
  })

  it('FINAL AUTO-RUN EXECUTION BUG FIX (item 4): AR_DEBUG_EVENT is routed to handleDebugEvent, which only ever appends to the run\'s own debugLog (appendDebugEvent) — never a state field any gate/transition reads back', () => {
    expect(source).toMatch(/case AR_MESSAGE\.DEBUG_EVENT:\s*\n\s*void handleDebugEvent\(senderTabId, message\)\.then\(sendResponse\)/)
    const fn = source.slice(source.indexOf('async function handleDebugEvent'), source.indexOf('async function handlePageComplete'))
    expect(fn).toContain('appendDebugEvent(state, { event, detail })')
  })

  it('FINAL SGS AUTO-RUN FIX (item 5 — "active run resumes after reload, no popup reopen required"): AR_SGS_CONTENT_READY is routed to handleContentReady, which dispatches AR_KICKOFF ONLY when shouldContentScriptProcess says this run is still approved+active+running for THIS exact tab — never for an unrelated/finished run, and never requiring popup to be open at all (this handler is driven purely by the content script\'s own message, with no popup involved anywhere in its call chain)', () => {
    expect(source).toMatch(/case AR_MESSAGE\.CONTENT_READY:\s*\n\s*void handleContentReady\(senderTabId, message\)\.then\(sendResponse\)/)
    const fn = source.slice(source.indexOf('async function handleContentReady'), source.indexOf('async function handlePendingAdvance'))
    expect(fn).toContain('shouldContentScriptProcess(state, tabId)')
    // The gate is unchanged — it still refuses to dispatch for anything
    // shouldContentScriptProcess rejects. It just no longer returns
    // SILENTLY: declining now records CONTENT_READY_NO_ACTIVE_RUN first,
    // so the trace never dead-ends on CONTENT_SCRIPT_RECEIVED with
    // nothing to explain it.
    expect(fn).toMatch(/if \(!shouldContentScriptProcess\(state, tabId\)\) \{[\s\S]{0,900}return \{ ok: true \}\s*\n\s*\}/)
    expect(fn).toContain("recordStartupTrace('CONTENT_READY_NO_ACTIVE_RUN'")
    expect(fn).toContain('sendToTab(tabId, { type: AR_MESSAGE.KICKOFF, runId: state.runId })')
  })

  it('FINAL SGS AUTO-RUN FIX (item 6): handleContentReady records CONTENT_SCRIPT_RECEIVED and (only on an actual dispatch) PROCESS_CURRENT_PAGE_SEND_RESULT — the SAME startup-trace vocabulary handleStart\'s own first run uses, so a page-2/3/4 reconnect is exactly as visible in Section 7 as the initial start', () => {
    const fn = source.slice(source.indexOf('async function handleContentReady'), source.indexOf('async function handlePendingAdvance'))
    expect(fn).toContain("recordStartupTrace('CONTENT_SCRIPT_RECEIVED'")
    expect(fn).toContain("recordStartupTrace('PROCESS_CURRENT_PAGE_SEND_RESULT'")
  })

  it('TRACE THE EXACT AR_START FAILURE: every startup-trace checkpoint is PERSISTED (chrome.storage.session), not only broadcast — so a reopened popup can still show the last step reached via AR_GET_STARTUP_TRACE, even after an abort closed it', () => {
    expect(source).toContain("const STARTUP_TRACE_KEY = 'sgsBridgeLastStartupTrace'")
    const fn = source.slice(source.indexOf('async function recordStartupTrace'), source.indexOf('async function getStartupTrace'))
    expect(fn).toContain('chrome.storage.session.set({ [STARTUP_TRACE_KEY]: entry })')
    expect(fn).toContain('chrome.runtime.sendMessage({ type: AR_MESSAGE.STARTUP_TRACE')
    expect(source).toMatch(/case AR_MESSAGE\.GET_STARTUP_TRACE:\s*\n\s*void getStartupTrace\(\)\.then\(\(trace\) => sendResponse\(\{ trace \}\)\)/)
    // Never broadcast-only any more — the old helper name is gone.
    expect(source).not.toMatch(/broadcastStartupTrace/)
  })

  it('item 6: AR_STOP only ever sets a flag (applyStopRequested) — it never itself aborts/completes a run, and a popup on an unrelated tab can neither see nor stop this tab\'s run (stateForTab)', () => {
    const fn = source.slice(source.indexOf('async function handleStop'), source.indexOf('async function handleManualContinue'))
    expect(fn).toContain('stateForTab(')
    expect(fn).toContain('applyStopRequested(')
    expect(fn).not.toMatch(/applyAbort|applyCompleted|applyStopped/)
  })

  it('item 6: a run only ever resumes via an explicit AR_MANUAL_CONTINUE from the popup — never automatically on its own, and never for a different tab than the one asking', () => {
    const fn = source.slice(source.indexOf('async function handleManualContinue'), source.indexOf('async function handleCheckActive'))
    expect(fn).toContain('stateForTab(')
    expect(fn).toContain('applyResume(')
  })

  it('item 4: content-script.js\'s AR_CHECK_ACTIVE is answered using the SENDER\'s own tab id only — never a tab id supplied in the message body, which a compromised/unrelated page could forge', () => {
    expect(source).toMatch(/const senderTabId = sender\.tab \? sender\.tab\.id : null/)
    expect(source).toMatch(/handleCheckActive\(senderTabId\)/)
  })

  it('FINAL SGS AUTO-RUN FIX (item 4 — "use the real tab... all later messages must use that stored tabId"): the tabId captured at AR_START (createInitialRunState\'s own tabId param) is the ONE value every later content-script-originated handler compares its sender against (`state.tabId !== tabId` / shouldContentScriptProcess) — never re-reading getActiveTab() or any other tab reference after the run is created', () => {
    for (const fnName of ['handleCheckActive', 'handlePendingAdvance', 'handleAdvanceConfirmed', 'handlePageProgress', 'handleDebugEvent', 'handlePageComplete', 'handleManualPause', 'handleAbort', 'handleStopped', 'handleComplete', 'handleContentReady']) {
      const start = source.indexOf(`async function ${fnName}`)
      expect(start).toBeGreaterThan(-1)
      const fn = source.slice(start, start + 350)
      expect(fn).toMatch(/state\.tabId (!==|===) tabId|shouldContentScriptProcess\(state, tabId\)/)
    }
  })

  it('AR_STATE_CHANGED is broadcast on every state-changing write (setState) — a closed popup\'s failed delivery is always swallowed, never thrown', () => {
    const fn = source.slice(source.indexOf('function broadcastStateChanged'), source.indexOf('function sendToTab'))
    expect(fn).toContain('.catch(()')
    expect(source).toMatch(/async function setState\(state\) \{[\s\S]{0,200}broadcastStateChanged\(state\)/)
  })
})

describe('TRUE unattended auto-run — content-script.js: registered only for the SGS host, never collects credentials, never clicks Save/another column/a header checkbox', () => {
  const source = read('../src/content-script.js')

  it('never reads document.cookie/localStorage/sessionStorage, and never touches a password/authToken/credential value — checked against the CODE only, past this file\'s own header comment describing that same guarantee in prose', () => {
    const code = source.slice(source.indexOf(';(function () {'))
    expect(code).not.toMatch(/document\.cookie/)
    expect(code).not.toMatch(/\blocalStorage\b/)
    expect(code).not.toMatch(/\bsessionStorage\b/)
    expect(code).not.toMatch(/\.password\b|\.authToken\b|\.credential\b/i)
  })

  it('FINAL SGS AUTO-RUN FIX (item 3 — "do not create duplicate listeners if the content script is already loaded"): the top-of-file already-loaded guard returns BEFORE registering chrome.runtime.onMessage.addListener or sending AR_SGS_CONTENT_READY — re-injecting this same file into a tab that already has a WORKING instance is a safe no-op, never a second overlapping listener/pipeline', () => {
    const guardIndex = source.indexOf('if (window.__sgsBridgeAutoRunLoaded) return')
    const listenerIndex = source.indexOf('chrome.runtime.onMessage.addListener(')
    const contentReadyIndex = source.indexOf('AR_MESSAGE.CONTENT_READY, pageUrl: location.href')
    expect(guardIndex).toBeGreaterThan(-1)
    expect(listenerIndex).toBeGreaterThan(guardIndex)
    expect(contentReadyIndex).toBeGreaterThan(guardIndex)
    expect(source).toContain('window.__sgsBridgeAutoRunLoaded = true')
  })

  it('is a classic script — no static ES `import`/`export` syntax (manifest content_scripts entries have no "type": "module" field); every pure/DOM module is loaded via a dynamic import() of the extension\'s own bundled file instead', () => {
    expect(source).not.toMatch(/^import /m)
    expect(source).not.toMatch(/^export /m)
    expect(source).toMatch(/import\(chrome\.runtime\.getURL\('src\/content-diagnostic\.js'\)\)/)
    expect(source).toMatch(/import\(chrome\.runtime\.getURL\('src\/lib\/auto-run\.js'\)\)/)
    expect(source).toMatch(/import\(chrome\.runtime\.getURL\('src\/lib\/pagination-control\.js'\)\)/)
    expect(source).toMatch(/import\(chrome\.runtime\.getURL\('src\/lib\/whole-column-write\.js'\)\)/)
    expect(source).toMatch(/import\(chrome\.runtime\.getURL\('src\/lib\/roster\.js'\)\)/)
  })

  it('never clicks anything except the confirmed pagination Next control (clickPaginationControl) — no other .click() call exists anywhere in this file, so Save/another column/a header checkbox can never be clicked', () => {
    const clickCalls = [...source.matchAll(/\.click\(\)/g)]
    expect(clickCalls.length).toBe(0)
    expect(source).toContain('libs.diagnostic.clickPaginationControl(nextControlResult.control)')
  })

  it('every write instruction carries exactly one columnIndex (scan.column.columnIndex) — structurally, no code path here can target a second column', () => {
    const writeCalls = [...source.matchAll(/fillSgsColumnValues\(([^)]*)\)/g)]
    expect(writeCalls.length).toBeGreaterThan(0)
    for (const call of writeCalls) {
      expect(call[1]).toContain('scan.column.columnIndex')
    }
  })

  it('writes exactly one cell at a time (a single-entry writesByOffset built fresh per row) — never a batch of multiple offsets in one call', () => {
    expect(source).toMatch(/const writesByOffset = \{ \[baseRow\.sgsRowOffset\]: baseRow\.krunameScore \}/)
    const fillCalls = [...source.matchAll(/fillSgsColumnValues\(/g)]
    expect(fillCalls.length).toBe(1)
  })

  it('every write is followed by a read-back (readSingleColumnCellValue) before the outcome is ever recorded as WRITTEN — never trusting the write call alone', () => {
    const writeIndex = source.indexOf('libs.diagnostic.fillSgsColumnValues(')
    const readIndex = source.indexOf('libs.diagnostic.readSingleColumnCellValue(')
    expect(writeIndex).toBeGreaterThan(-1)
    expect(readIndex).toBeGreaterThan(writeIndex)
    expect(source).toMatch(/const outcome = !missing && actualValue === baseRow\.krunameScore \? 'WRITTEN' : 'FAILED'/)
  })

  it('item 5: evaluates a REAL subject/classroom match against the KrunameClass payload itself (evaluateSubjectClassroomMatch) before every page\'s write — never only a page-to-page drift check', () => {
    const fn = source.slice(source.indexOf('function evaluatePageGate'), source.indexOf('async function processCurrentPage'))
    expect(fn).toContain('libs.subjectClassroom.evaluateSubjectClassroomMatch(')
    expect(fn).toContain('krunameSubjectName: runState.subject')
    expect(fn).toContain('krunameClassroomName: runState.classroom')
  })

  it('item 5: "abort immediately on mismatch" — the FIRST failing gate stops the whole page/run via AR_ABORT, never a partial continue', () => {
    const fn = source.slice(source.indexOf('async function processCurrentPage'), source.indexOf('async function attemptAdvance'))
    // The gate may first record a checkpoint so the abort is visible in the
    // debug panel, but nothing else may happen between the failing gate and
    // the AR_ABORT — in particular no write and no page advance.
    expect(fn).toMatch(/if \(stop\.shouldStop\) \{[\s\S]{0,260}await sendMessage\(\{ type: AR_MESSAGE\.ABORT, reason: stop\.reason \}\)/)
    expect(fn).toContain("processTrace('PROCESS_STOPPED_BY_GATE'")
  })

  it('item 6: "หยุด" is only ever checked as a flag reported by background.js (AR_GET_STATE\'s stopRequested) — this file never calls anything to abort a write already in flight, and starts no new write once the flag is set', () => {
    const fn = source.slice(source.indexOf('async function processCurrentPage'), source.indexOf('async function attemptAdvance'))
    expect(fn).toContain('stateCheck?.state?.stopRequested')
    expect(fn).toMatch(/if \(stoppedMidPage\) \{[\s\S]{0,400}continue\s*\n\s*\}/)
  })

  it('item 4: a page-advance is only ever ATTEMPTED at high/medium confidence (isConfidentEnoughToAutoClick) — a low-confidence or absent finding sends AR_MANUAL_PAUSE instead of clicking anything', () => {
    const fn = source.slice(source.indexOf('async function attemptAdvance'), source.indexOf('async function verifyPendingAdvance'))
    expect(fn).toContain('findSgsNextPageControl(inspection.candidates, inspection.currentPageDomOrder)')
    expect(fn).toMatch(/if \(!nextControlResult\.control \|\| !libs\.pagination\.isConfidentEnoughToAutoClick\(nextControlResult\.confidence\)\) \{[\s\S]{0,300}AR_MESSAGE\.MANUAL_PAUSE/)
  })

  it('item 4/5: pending-advance state is reported to background.js BEFORE the click — the click itself never calls preventDefault, since a real ASP.NET postback may destroy this script\'s own execution context the instant it fires', () => {
    const fn = source.slice(source.indexOf('async function attemptAdvance'), source.indexOf('async function verifyPendingAdvance'))
    const pendingIndex = fn.indexOf('AR_MESSAGE.PENDING_ADVANCE')
    const clickIndex = fn.indexOf('libs.diagnostic.clickPaginationControl(nextControlResult.control)')
    expect(pendingIndex).toBeGreaterThan(-1)
    expect(clickIndex).toBeGreaterThan(pendingIndex)
    expect(fn).not.toMatch(/preventDefault/)
  })

  it('item 4: a click\'s success is NEVER trusted alone — verifyPendingAdvance checks pagination-control.js\'s own verifyPageAdvance for the page number, grid fingerprint, and subject/classroom before treating an advance as confirmed', () => {
    const fn = source.slice(source.indexOf('async function verifyPendingAdvance'), source.indexOf('async function main'))
    expect(fn).toContain('libs.pagination.verifyPageAdvance(')
    expect(fn).toContain('AR_MESSAGE.ADVANCE_CONFIRMED')
  })

  it('item 6: every page-advance failure mode falls back to the SAME manual-continue message this codebase has always used — only a CONFIRMED context mismatch aborts the run', () => {
    const fn = source.slice(source.indexOf('async function verifyPendingAdvance'), source.indexOf('async function main'))
    expect(fn).toContain("reason: 'ไม่สามารถเปลี่ยนหน้าอัตโนมัติได้ กรุณาเปิดหน้าถัดไปแล้วกดดำเนินการต่อ'")
    expect(fn).toMatch(/if \(result\.kind === 'context_mismatch'\) \{[\s\S]{0,200}AR_MESSAGE\.ABORT/)
  })

  it('a per-page write-failure rate above the safe threshold aborts the run — never silently absorbed into the summary alone', () => {
    const fn = source.slice(source.indexOf('async function processCurrentPage'), source.indexOf('async function attemptAdvance'))
    expect(fn).toContain('pageFailureExceedsThreshold(')
    expect(fn).toMatch(/if \(pageThresholdExceeded\) \{\s*\n\s*await sendMessage\(\{\s*\n\s*type: AR_MESSAGE\.ABORT,/)
  })

  it('item 4: on every fresh page load, main() asks background.js whether an approved run is active for THIS tab (AR_CHECK_ACTIVE) — the teacher never needs to reopen the popup for page 2/3/4 to proceed', () => {
    expect(source).toMatch(/async function main\(\) \{[\s\S]{0,200}AR_MESSAGE\.CHECK_ACTIVE/)
    expect(source).toMatch(/void main\(\)\s*\n\s*\}\)\(\)/)
  })

  it('FINAL AUTO-RUN EXECUTION BUG FIX (item 2 — "verify content script is available"): AR_PING is answered SYNCHRONOUSLY and FIRST, before the KICKOFF/RESUME branches and before loadLibs() is ever called — background.js\'s ensureContentScriptReady must never be blocked on this file\'s own (possibly slow) library loading', () => {
    const listenerBody = source.slice(source.indexOf('chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {'))
    const pingIndex = listenerBody.indexOf('AR_MESSAGE.PING')
    const kickoffIndex = listenerBody.indexOf('AR_MESSAGE.KICKOFF')
    expect(pingIndex).toBeGreaterThan(-1)
    expect(pingIndex).toBeLessThan(kickoffIndex)
    const pingBranch = listenerBody.slice(pingIndex - 40, kickoffIndex)
    expect(pingBranch).toContain('sendResponse({ ok: true, pageUrl: location.href, ready: true })')
    expect(pingBranch).not.toContain('loadLibs()')
  })

  it('FINAL SGS AUTO-RUN FIX (item 2): the PING response includes pageUrl (location.href) alongside ok/ready — background\'s ensureContentScriptReady/isSgsTab check the TAB\'s own URL via chrome.tabs.get, but this gives a second, content-script-reported confirmation of which page actually answered', () => {
    expect(source).toContain('sendResponse({ ok: true, pageUrl: location.href, ready: true })')
  })

  it('FINAL SGS AUTO-RUN FIX (item 2/5): a content script announces AR_SGS_CONTENT_READY (with pageUrl) the moment it starts — a fresh load, a reload, OR an ASP.NET postback — never only in reply to a PING background happened to send; sent fire-and-forget, never blocking or delaying main()\'s own independent CHECK_ACTIVE-driven startup', () => {
    const bootSection = source.slice(source.lastIndexOf('void sendMessage({ type: AR_MESSAGE.CONTENT_READY') - 10, source.indexOf('void main()') + 20)
    expect(bootSection).toContain("void sendMessage({ type: AR_MESSAGE.CONTENT_READY, pageUrl: location.href })")
    expect(bootSection).not.toContain('await sendMessage({ type: AR_MESSAGE.CONTENT_READY')
  })

  it('FINAL AUTO-RUN EXECUTION BUG FIX (item 4 — "message trace"): every one of PAGE_SCAN_OK/PAGE_PLAN_READY/CELL_WRITE_START/PAGE_DONE/NEXT_PAGE_REQUESTED is sent via the shared fire-and-forget debugEvent helper, in that same pipeline order, and debugEvent itself never awaits/blocks on background.js\'s reply', () => {
    const debugEventFn = source.slice(source.indexOf('function debugEvent('), source.indexOf('function debugEvent(') + 200)
    expect(debugEventFn).toContain('void sendMessage({ type: AR_MESSAGE.DEBUG_EVENT')

    const processFn = source.slice(source.indexOf('async function processCurrentPage'), source.indexOf('async function attemptAdvance'))
    const scanIndex = processFn.indexOf("debugEvent('PAGE_SCAN_OK'")
    const planIndex = processFn.indexOf("debugEvent('PAGE_PLAN_READY'")
    const writeStartIndex = processFn.indexOf("debugEvent('CELL_WRITE_START'")
    const doneIndex = processFn.indexOf("debugEvent('PAGE_DONE'")
    expect(scanIndex).toBeGreaterThan(-1)
    expect(planIndex).toBeGreaterThan(scanIndex)
    expect(writeStartIndex).toBeGreaterThan(planIndex)
    expect(doneIndex).toBeGreaterThan(writeStartIndex)

    const advanceFn = source.slice(source.indexOf('async function attemptAdvance'), source.indexOf('async function verifyPendingAdvance'))
    expect(advanceFn).toContain("debugEvent('NEXT_PAGE_REQUESTED'")
  })

  it('FINAL AUTO-RUN EXECUTION BUG FIX (item 5 — "page 1 must process before any NextPage click"): CELL_WRITE_START/PAGE_DONE (this page\'s own writes) both occur, in processCurrentPage, strictly BEFORE attemptAdvance is ever called — a page\'s writes always finish before this file even considers clicking Next', () => {
    const processFn = source.slice(source.indexOf('async function processCurrentPage'), source.indexOf('async function attemptAdvance'))
    const writeStartIndex = processFn.indexOf("debugEvent('CELL_WRITE_START'")
    const doneIndex = processFn.indexOf("debugEvent('PAGE_DONE'")
    const advanceCallIndex = processFn.indexOf('await attemptAdvance(libs, lastPageContext)')
    expect(writeStartIndex).toBeGreaterThan(-1)
    expect(doneIndex).toBeGreaterThan(writeStartIndex)
    expect(advanceCallIndex).toBeGreaterThan(doneIndex)
  })
})
