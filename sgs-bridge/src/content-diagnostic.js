/**
 * This is the ONLY file in this extension that runs inside the SGS page
 * itself, via `chrome.scripting.executeScript`, and only ever on an
 * explicit teacher button click — never automatically.
 *
 * `chrome.scripting.executeScript({ func })` serializes whichever
 * function it is given (`Function.prototype.toString`) and re-runs it
 * standalone inside the target page — it has NO access to this file's
 * module scope, its imports, or any sibling function here. Every
 * exported function below is therefore closure-free and self-contained;
 * anything that doesn't need to run inside the page (interpreting the
 * raw facts these functions return: finding the real grid among ~200
 * tables, classifying columns, parsing a header's max score) lives in
 * ./lib/sgs-table-extraction.js instead, imported normally by popup.js
 * — an extension page, which fully supports ES modules unlike an
 * injected content script.
 *
 * BUG FIX: the original filter-detection code called `getElementById`
 * with `.Filter_Input` appended to the id string
 * (`'ctl00_PageContent_ClassSubjectIDFilter.Filter_Input'`). That
 * string was actually a CSS SELECTOR copied from the live diagnostic
 * (`select#ctl00_PageContent_ClassSubjectIDFilter.Filter_Input`), where
 * `#ctl00_PageContent_ClassSubjectIDFilter` is the id and
 * `.Filter_Input` is a CLASS on that same element — not part of the id.
 * `getElementById` takes a literal id, so appending the class name to
 * it could never match anything, and `present` was always reported as
 * `false`. Fixed by using the id alone.
 */

/**
 * Two elements CONFIRMED against the real SGS page (never guessed): the
 * subject and classroom filter `<select>`s. Read only to LABEL a
 * diagnostic capture with which subject/classroom it came from —
 * nothing about the score table itself ever depends on these, and
 * nothing here ever changes their selection (only `.value` and the
 * selected `<option>`'s visible text are read).
 */
export const KNOWN_SGS_FILTER_IDS = {
  subject: 'ctl00_PageContent_ClassSubjectIDFilter',
  classroom: 'ctl00_PageContent_ClassSectionNoFilter',
}

/**
 * Generic, verbose structural diagnostic — every table's row count, a
 * safe CSS selector candidate, its visible header text, and per-column
 * input PRESENCE (never a value); every input/select/textarea's TYPE
 * (never its current value); and the two known filters' current
 * selection. Deliberately NEVER reads: document.cookie, localStorage,
 * sessionStorage, any OTHER input's `.value`, or any table BODY row's
 * text (only header cells). This is the "optional verbose/debug mode"
 * — the primary diagnostic is collectAllTableRowFacts below, whose
 * output feeds the compact studentGrid report.
 */
export function collectRawSgsFacts() {
  function selectorCandidateFor(el) {
    const tag = el.tagName.toLowerCase()
    const id = el.id ? `#${el.id}` : ''
    const firstClass = el.classList && el.classList.length > 0 ? `.${el.classList[0]}` : ''
    return `${tag}${id}${firstClass}`
  }

  const allTables = Array.from(document.querySelectorAll('table'))
  const tables = allTables.slice(0, 20).map((table) => {
    const rows = table.querySelectorAll('tr')
    const headerRow = table.querySelector('thead tr') || rows[0] || null
    const headerCells = headerRow ? Array.from(headerRow.querySelectorAll('th,td')).slice(0, 30) : []
    const bodyRows = headerRow ? Array.from(rows).filter((r) => r !== headerRow) : Array.from(rows)
    const sampleRow = bodyRows[0] || null
    const columnsHaveInput = headerCells.map((_, columnIndex) => {
      if (!sampleRow) return false
      const cell = sampleRow.children[columnIndex]
      return cell ? cell.querySelector('input,select') !== null : false
    })
    return {
      selectorCandidate: selectorCandidateFor(table),
      rowCount: rows.length,
      columnHeaders: headerCells.map((cell) => (cell.textContent || '').trim().slice(0, 60)),
      columnsHaveInput,
    }
  })

  const inputTypeCounts = {}
  const inputSelectorCandidates = []
  Array.from(document.querySelectorAll('input,select,textarea'))
    .slice(0, 200)
    .forEach((el) => {
      const kind = el.tagName.toLowerCase() === 'input' ? el.getAttribute('type') || 'text' : el.tagName.toLowerCase()
      inputTypeCounts[kind] = (inputTypeCounts[kind] || 0) + 1
      if (inputSelectorCandidates.length < 20) {
        inputSelectorCandidates.push(selectorCandidateFor(el))
      }
    })

  // Duplicates KNOWN_SGS_FILTER_IDS's two literal id values (and the
  // same read-only lookup logic collectAllTableRowFacts's own inline
  // copy below uses) — this function is itself injected via
  // executeScript's `func` and can't reference this file's other
  // module-level exports once serialized (see the file header).
  const knownFilterIds = {
    subject: 'ctl00_PageContent_ClassSubjectIDFilter',
    classroom: 'ctl00_PageContent_ClassSectionNoFilter',
  }
  const knownFilters = {}
  for (const [name, id] of Object.entries(knownFilterIds)) {
    const el = document.getElementById(id)
    if (!el) {
      knownFilters[name] = { present: false, selectedText: null }
      continue
    }
    const selectedOption = el.options ? el.options[el.selectedIndex] : null
    const selectedText = selectedOption ? selectedOption.text.trim() : el.value || null
    knownFilters[name] = { present: true, selectedText: selectedText || null }
  }

  return {
    pageUrl: location.href,
    pageTitle: document.title,
    formCount: document.forms.length,
    tableCount: allTables.length,
    tables,
    inputTypeCounts,
    inputSelectorCandidates,
    knownFilters,
  }
}

/**
 * Primary diagnostic — reads RAW structural facts only for EVERY row of
 * EVERY table on the page, with no interpretation at all: finding "the"
 * student grid among these ~200 tables, and deciding which of its
 * columns are genuinely WRITABLE score inputs versus calculated/
 * read-only columns (รวมตลอดภาค, %, ปกติ, ...), is
 * sgs-table-extraction.js's job, run afterward in the extension/popup
 * context on the plain data this returns.
 *
 * LIVE DISCOVERY (see the header-checkbox comment on inspectCellFormControl
 * below): a real SGS score column's header holds a checkbox that gates
 * whether that column's row inputs are editable — checking it is what
 * turns a "disabled" column into an editable one, and the header cell
 * containing that checkbox usually ALSO carries the column's visible
 * label text (e.g. a checkbox next to "10"). Every cell's `text` is
 * therefore now captured regardless of whether it also has an input —
 * previously an input-bearing cell always reported `text: ''`, which
 * silently discarded a header checkbox cell's own label.
 *
 * For every cell, this always records its trimmed, length-capped text.
 * For a cell WITH an input, it additionally records structural metadata
 * about the ACTUAL VISIBLE control inside it (never a hidden/cloned
 * sibling control, and never the outer table or a header row's own
 * unrelated input) — its count of candidate controls, the visible one's
 * type, disabled/readonly/checked state, and whether a visible control
 * was found at all — which is exactly what's needed to tell a real
 * editable score box apart from a calculated total rendered as a locked
 * input, or a score column whose header checkbox simply hasn't been
 * checked yet. Also records whether a cell contains a link (`<a>`), used
 * only for pagination-row detection (see detectPagination) — never for
 * score-column classification.
 *
 * Deliberately never reads an input's `.value` (a score's current
 * value is only ever read later, for the ONE column/table/row-range the
 * teacher has confirmed — see readColumnValues below), never reads
 * document.cookie/localStorage/sessionStorage, and caps how much it
 * collects (tables/rows/cells/text length) so a single capture stays a
 * reasonable size even on a page with hundreds of layout tables.
 */
export function collectAllTableRowFacts() {
  function textOf(el) {
    return el && el.textContent ? el.textContent.trim().replace(/\s+/g, ' ').slice(0, 80) : ''
  }
  function selectorFingerprintFor(el, index) {
    const tag = el.tagName.toLowerCase()
    const id = el.id ? `#${el.id}` : ''
    const firstClass = el.classList && el.classList.length > 0 ? `.${el.classList[0]}` : ''
    return id || firstClass ? `${tag}${id}${firstClass}` : `${tag}[${index}]`
  }

  /**
   * SECTION 6 fix: inspects the ACTUAL VISIBLE form control inside a
   * cell — never the outer table, never a cloned/hidden control, never a
   * header row's own unrelated input, and never merely the FIRST control
   * `querySelector` happens to find in DOM order. An ASP.NET page can
   * render more than one input/select inside a single cell (a hidden
   * ViewState-style helper alongside the real one); if the FIRST one in
   * DOM order were always trusted, a genuinely enabled, visible,
   * keyboard-editable score box could be misreported as disabled just
   * because a hidden sibling control happens to be disabled. Visibility
   * is checked via `offsetParent !== null`, which is `null` for any
   * element that is `display:none` or not in the rendered layout (it is
   * NOT null for `visibility:hidden`, which the SGS page has not been
   * observed to use for these controls — offsetParent is the cheapest,
   * most standard visibility check available without a full computed-
   * style read).
   */
  function inspectCellFormControl(cell) {
    const candidates = Array.from(cell.querySelectorAll('input,select,textarea'))
    if (candidates.length === 0) return null
    const visibleCandidates = candidates.filter((el) => el.offsetParent !== null)
    // If NO candidate is visible, fall back to the first one so a type/
    // disabled reading is still reported — but `visible: false` on the
    // result means "never treat this as something a teacher could type
    // into," which is exactly how analyzeColumnRowInputState in
    // sgs-table-extraction.js is required to read it (item 6).
    const chosen = visibleCandidates[0] || candidates[0]
    const tag = chosen.tagName.toLowerCase()
    const type = tag === 'input' ? (chosen.getAttribute('type') || 'text').toLowerCase() : tag
    return {
      count: candidates.length,
      visibleCount: visibleCandidates.length,
      type,
      disabled: chosen.disabled === true,
      readonly: chosen.readOnly === true,
      // Only meaningful for a checkbox (a score column's header-gate
      // control per item 1) — null for every other control type.
      checked: type === 'checkbox' ? chosen.checked === true : null,
      visible: visibleCandidates.length > 0,
    }
  }

  const MAX_TABLES = 300
  const MAX_ROWS_PER_TABLE = 200
  const MAX_CELLS_PER_ROW = 40

  const tables = Array.from(document.querySelectorAll('table'))
    .slice(0, MAX_TABLES)
    .map((table, tableIndex) => ({
      tableIndex,
      selectorFingerprint: selectorFingerprintFor(table, tableIndex),
      // `table.rows` is the table's OWN rows only — a nested `<table>`
      // inside one of its cells has its own separate entry in
      // `document.querySelectorAll('table')` with its own `.rows`, so
      // this never conflates an outer layout table's row count with an
      // inner grid's. This is what lets the ranking step in
      // sgs-table-extraction.js find "the deepest/most specific
      // repeating row structure" without any special nesting logic —
      // the deepest table simply IS one of the entries in this list.
      rows: Array.from(table.rows)
        .slice(0, MAX_ROWS_PER_TABLE)
        .map((row) =>
          Array.from(row.cells)
            .slice(0, MAX_CELLS_PER_ROW)
            .map((cell) => {
              const hasInput = cell.querySelector('input,select,textarea') !== null
              const hasLink = cell.querySelector('a') !== null
              // Always captured, even when hasInput is true — a real SGS
              // header checkbox cell carries its column's visible label
              // text ALONGSIDE the checkbox (see inspectCellFormControl's
              // doc comment above); discarding text for input-bearing
              // cells would silently lose that label.
              const text = textOf(cell)
              const inputMeta = hasInput ? inspectCellFormControl(cell) : null
              return { hasInput, hasLink, text, inputMeta }
            }),
        ),
    }))

  return {
    pageUrl: location.href,
    pageTitle: document.title,
    subjectFilter: readKnownFilterInline('ctl00_PageContent_ClassSubjectIDFilter'),
    classroomFilter: readKnownFilterInline('ctl00_PageContent_ClassSectionNoFilter'),
    tables,
  }

  // FINAL PAGINATION FIX — pagination is no longer detected here at all.
  // It never belonged to "collect every table row's facts" in the first
  // place, and folding it in here meant it could only ever be computed
  // ONE step behind the actual DOM (this function has no way to also
  // return live element references for a caller to click). Callers now
  // get pagination facts from inspectPaginationControls below instead —
  // ONE single, more thorough implementation, shared by the live
  // diagnostic button, the real auto-run detection, and the actual
  // page-advance click, rather than a second, easily-drifting copy of
  // the same parsing logic living in here.

  // Duplicates collectRawSgsFacts's own inline filter-reading logic —
  // this function is itself injected via executeScript's `func` and
  // can't share code with a sibling function once serialized (see the
  // file header).
  function readKnownFilterInline(id) {
    const el = document.getElementById(id)
    if (!el) return { present: false, selectedText: null }
    const selectedOption = el.options ? el.options[el.selectedIndex] : null
    const selectedText = selectedOption ? selectedOption.text.trim() : el.value || null
    return { present: true, selectedText: selectedText || null }
  }
}

/**
 * Reads ONE column's CURRENT values, for ONE confirmed table and row
 * range — never any other column, and never before the teacher has
 * confirmed which real column to inspect (popup.js only ever calls
 * this after that confirmation). `runStartIndex`/`runLength` describe
 * the accepted student-row run WITHIN `table.rows` (as found by
 * pickBestStudentGridCandidate against this same function's sibling,
 * collectAllTableRowFacts) — the returned `values` are keyed by OFFSET
 * within that run (0 = the run's first row), matching
 * buildSgsRowKey/sgsRowIndexFromKey's convention.
 */
export function readColumnValues(tableIndex, runStartIndex, runLength, columnIndex) {
  const table = document.querySelectorAll('table')[tableIndex]
  if (!table) return { found: false, values: {} }

  // Duplicates inspectCellFormControl's visible-preference logic (see
  // its doc comment in collectAllTableRowFacts above) — never trusts the
  // FIRST input `querySelector` finds when a hidden sibling control
  // exists; this function is itself injected via executeScript's `func`
  // and can't share code with a sibling function once serialized (see
  // the file header).
  function pickVisibleControlInline(cell) {
    const candidates = Array.from(cell.querySelectorAll('input,select'))
    if (candidates.length === 0) return null
    return candidates.find((el) => el.offsetParent !== null) || candidates[0]
  }

  const rows = Array.from(table.rows)
  const values = {}
  for (let offset = 0; offset < runLength; offset++) {
    const row = rows[runStartIndex + offset]
    // Only ever indexes into `columnIndex` — the one column requested.
    const cell = row ? row.cells[columnIndex] : null
    const input = cell ? pickVisibleControlInline(cell) : null
    const raw = input ? input.value : cell ? cell.textContent.trim() : ''
    const parsed = raw === '' ? null : Number(raw)
    values[offset] = Number.isFinite(parsed) ? parsed : null
  }
  return { found: true, values }
}

/**
 * Writes ONLY the given column's cells, ONLY for the given row offsets
 * (within the SAME confirmed table/run readColumnValues used), and
 * dispatches the `input`/`change` events a plain HTML form (or JS
 * listening for them) expects — then returns without ever looking for,
 * let alone clicking, any Save/Submit control.
 *
 * `writesByOffset`: a plain object `{ [offset]: value }` — the caller
 * (popup.js, via buildSingleCellTestPlan) already decided exactly which
 * row(s) get a value and what it is; this function only ever writes what
 * it's told, into the ONE column it's told. In this phase the ONLY
 * caller is the single-cell test write path, and buildSingleCellTestPlan
 * guarantees `writesByOffset` can never contain more than one entry.
 */
export function fillSgsColumnValues(tableIndex, runStartIndex, columnIndex, writesByOffset) {
  const table = document.querySelectorAll('table')[tableIndex]
  if (!table) {
    return { found: false, writtenCount: 0, missingOffsets: Object.keys(writesByOffset).map(Number) }
  }

  // Duplicates inspectCellFormControl's visible-preference logic (see
  // its doc comment in collectAllTableRowFacts above) — never writes
  // into a hidden sibling control when a visible one exists in the same
  // cell; this function is itself injected via executeScript's `func`
  // and can't share code with a sibling function once serialized (see
  // the file header).
  function pickVisibleControlInline(cell) {
    const candidates = Array.from(cell.querySelectorAll('input,select'))
    if (candidates.length === 0) return null
    return candidates.find((el) => el.offsetParent !== null) || candidates[0]
  }

  const rows = Array.from(table.rows)
  let writtenCount = 0
  const missingOffsets = []
  for (const [offsetKey, value] of Object.entries(writesByOffset)) {
    const offset = Number(offsetKey)
    const row = rows[runStartIndex + offset]
    // Only ever indexes into `columnIndex` — the one column requested —
    // never anything derived from another column.
    const cell = row ? row.cells[columnIndex] : null
    const input = cell ? pickVisibleControlInline(cell) : null
    if (!input) {
      missingOffsets.push(offset)
      continue
    }
    input.value = String(value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    writtenCount += 1
  }

  return { found: true, writtenCount, missingOffsets }
}

/**
 * The single-cell test's "guard against stale DOM" read: everything
 * revalidateSingleCellTestContext (single-cell-test.js) needs to decide
 * whether it is still safe to write, gathered in ONE atomic pass right
 * before the write — never a separate round-trip per fact, which would
 * leave a window for the page to change between reads. Read-only: this
 * never sets a value, never dispatches an event, never touches the SGS
 * header checkbox.
 *
 * `identifierColumns`: `{numberColumnIndex, codeColumnIndex,
 * nameColumnIndex}` from the SAME confirmed grid candidate the teacher's
 * preview was built from — this function only ever reads those columns
 * at the ONE requested row, never scans for them itself.
 */
export function readSingleCellRevalidationState(tableIndex, rowIndex, columnIndex, identifierColumns) {
  // Duplicates the known-filter read in collectAllTableRowFacts above —
  // this function is itself injected via executeScript's `func` and
  // can't share code with a sibling function once serialized (see the
  // file header).
  function readKnownFilterInline(id) {
    const el = document.getElementById(id)
    if (!el) return null
    const selectedOption = el.options ? el.options[el.selectedIndex] : null
    return (selectedOption ? selectedOption.text.trim() : el.value || null) || null
  }
  function textOf(el) {
    return el && el.textContent ? el.textContent.trim().replace(/\s+/g, ' ').slice(0, 80) : ''
  }

  const subjectFilterText = readKnownFilterInline('ctl00_PageContent_ClassSubjectIDFilter')
  const classroomFilterText = readKnownFilterInline('ctl00_PageContent_ClassSectionNoFilter')

  const table = document.querySelectorAll('table')[tableIndex]
  const row = table ? Array.from(table.rows)[rowIndex] : null
  if (!row) {
    return {
      subjectFilterText,
      classroomFilterText,
      studentNumber: null,
      studentCode: null,
      studentName: '',
      cellVisible: false,
      cellEnabled: false,
      visibleInputCount: 0,
      currentValue: null,
    }
  }

  const numberText = row.cells[identifierColumns.numberColumnIndex] ? textOf(row.cells[identifierColumns.numberColumnIndex]) : ''
  const parsedNumber = numberText === '' ? null : Number(numberText)
  const codeText = row.cells[identifierColumns.codeColumnIndex] ? textOf(row.cells[identifierColumns.codeColumnIndex]) : null
  const nameText = row.cells[identifierColumns.nameColumnIndex] ? textOf(row.cells[identifierColumns.nameColumnIndex]) : ''

  const cell = row.cells[columnIndex] || null
  const candidates = cell ? Array.from(cell.querySelectorAll('input,select')) : []
  const visibleCandidates = candidates.filter((el) => el.offsetParent !== null)
  const chosen = visibleCandidates[0] || null
  const rawValue = chosen ? chosen.value : ''
  const parsedValue = rawValue === '' ? null : Number(rawValue)

  return {
    subjectFilterText,
    classroomFilterText,
    studentNumber: Number.isFinite(parsedNumber) ? parsedNumber : null,
    studentCode: codeText || null,
    studentName: nameText,
    cellVisible: visibleCandidates.length > 0,
    cellEnabled: chosen ? chosen.disabled !== true : false,
    visibleInputCount: visibleCandidates.length,
    currentValue: Number.isFinite(parsedValue) ? parsedValue : null,
  }
}

/**
 * NEXT PHASE — auto-run's per-cell verification read: the CURRENT value
 * of exactly ONE cell (never a range), used immediately after writing
 * that one cell so auto-run's progress can update per-student rather
 * than only once per whole page. Read-only — never sets a value, never
 * dispatches an event.
 */
export function readSingleColumnCellValue(tableIndex, rowIndex, columnIndex) {
  function pickVisibleControlInline(cell) {
    const candidates = Array.from(cell.querySelectorAll('input,select'))
    if (candidates.length === 0) return null
    return candidates.find((el) => el.offsetParent !== null) || candidates[0]
  }

  const table = document.querySelectorAll('table')[tableIndex]
  const row = table ? Array.from(table.rows)[rowIndex] : null
  const cell = row ? row.cells[columnIndex] : null
  if (!cell) return { found: false, value: null }

  const input = pickVisibleControlInline(cell)
  const raw = input ? input.value : cell.textContent.trim()
  const parsed = raw === '' ? null : Number(raw)
  return { found: true, value: Number.isFinite(parsed) ? parsed : null }
}

/**
 * FINAL PAGINATION FIX — auto-run's page-advance previously only ever
 * looked for a ROW OF PLAIN-TEXT NUMERIC LINKS (the old ASP.NET
 * GridView pager shape), then a single text node combining both page
 * numbers ("1 ของ 4"). Neither shape exists on the real page: its
 * current-page/page-size numbers each live in their OWN `<input>`
 * (never visible to a text-node walk at all), and its Next/Last
 * controls are ASP.NET templated-pager controls identified far more
 * reliably by their own CONFIRMED, stable id suffix
 * (`...__FirstPage`/`...__PreviousPage`/`...__NextPage`/`...__LastPage`)
 * than by a glyph or a generic "contains next" guess.
 *
 * This function only ever COLLECTS candidates — it never decides which
 * one is "Next"/"Last"/etc (that pure classification, DOM-free and
 * fully unit tested, lives in pagination-control.js). It never touches
 * document.cookie or any browser-side storage, and reads nothing beyond
 * this page-wide pagination widget's own controls. Read-only.
 *
 * Anchored on the Thai "ของ N" (of N) text for the total page count,
 * then walks up a bounded number of ancestor levels to the smallest
 * container that also holds either a clickable-looking control or a
 * plain (non-button-type) `<input>` — the current-page box. A SEPARATE,
 * independent anchor+walk does the same for "หน้า" (the page-size
 * label) and its own residual input, and "รายการ" (the total record
 * count) is read directly from its own plain text — no input involved
 * there at all. Finally, once ANY control's id is found to end with one
 * of the four confirmed suffixes, this derives and looks up the other
 * three by that SAME id namespace (pagination-control.js's
 * computeSiblingPagerIds) — a literal, deterministic `getElementById`
 * lookup, never a guess, and a safety net for a control that a bounded
 * container walk alone might not reach.
 */
export function inspectPaginationControls() {
  const OF_PATTERN = /ของ\s*(\d+)/
  const ITEMS_PATTERN = /(\d+)\s*รายการ/
  const PAGE_SIZE_LABEL_PATTERN = /หน้า/
  const CLICKABLE_SELECTOR = 'a,button,input[type="button"],input[type="submit"],input[type="image"],[onclick]'
  const PLAIN_INPUT_SELECTOR = 'input:not([type="button"]):not([type="submit"]):not([type="image"])'
  const PAGER_ID_SUFFIXES = ['FirstPage', 'PreviousPage', 'NextPage', 'LastPage']
  const MAX_ANCESTOR_DEPTH = 6

  function textOf(el) {
    return el && el.textContent ? el.textContent.trim().replace(/\s+/g, ' ') : ''
  }

  function describeCandidate(el) {
    const tag = el.tagName.toLowerCase()
    const type = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : null
    const text = tag === 'input' ? el.value || el.getAttribute('alt') || el.getAttribute('title') || '' : textOf(el)
    return {
      tag,
      id: el.id || null,
      name: el.getAttribute('name') || null,
      type,
      value: tag === 'input' ? (el.value ?? '') : null,
      title: el.getAttribute('title'),
      src: el.getAttribute('src'),
      className: el.className || null,
      text: (text || '').trim(),
      onclick: el.getAttribute('onclick'),
      href: el.getAttribute('href'),
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      surroundingText: el.parentElement ? textOf(el.parentElement).slice(0, 120) : '',
    }
  }

  function findTextAnchor(pattern) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      const text = (node.textContent || '').trim()
      const match = pattern.exec(text)
      if (match) return { node, match }
    }
    return null
  }

  function findContainer(anchorNode, requireSelector) {
    let container = anchorNode.parentElement
    for (let depth = 0; depth < MAX_ANCESTOR_DEPTH && container; depth++) {
      if (container.querySelector(requireSelector)) return container
      container = container.parentElement
    }
    return anchorNode.parentElement
  }

  const candidates = []
  const seenIds = new Set()
  function addCandidate(el) {
    if (!el) return
    if (el.id) {
      if (seenIds.has(el.id)) return
      seenIds.add(el.id)
    }
    candidates.push(describeCandidate(el))
  }

  let totalPagesText = null
  let currentPageValue = null
  const ofAnchor = findTextAnchor(OF_PATTERN)
  if (ofAnchor) {
    totalPagesText = ofAnchor.match[1]
    const container = findContainer(ofAnchor.node, `${CLICKABLE_SELECTOR},${PLAIN_INPUT_SELECTOR}`)
    Array.from(container.querySelectorAll(CLICKABLE_SELECTOR)).forEach(addCandidate)
    const plainInputs = Array.from(container.querySelectorAll(PLAIN_INPUT_SELECTOR))
    plainInputs.forEach(addCandidate)
    // Never guessed: the current-page value is only ever trusted when
    // exactly ONE plain input sits in this container — more than one is
    // honestly ambiguous, never picked at random.
    if (plainInputs.length === 1) currentPageValue = plainInputs[0].value ?? ''
  }

  let totalRowsText = null
  const itemsAnchor = findTextAnchor(ITEMS_PATTERN)
  if (itemsAnchor) totalRowsText = itemsAnchor.match[1]

  let pageSizeValue = null
  const pageSizeAnchor = findTextAnchor(PAGE_SIZE_LABEL_PATTERN)
  if (pageSizeAnchor) {
    const container = findContainer(pageSizeAnchor.node, PLAIN_INPUT_SELECTOR)
    const plainInputs = Array.from(container.querySelectorAll(PLAIN_INPUT_SELECTOR))
    plainInputs.forEach(addCandidate)
    if (plainInputs.length === 1) pageSizeValue = plainInputs[0].value ?? ''
  }

  // "Search the same DOM namespace": once any ONE control's id is found
  // to end with a confirmed pager suffix, derive and look up the other
  // three by that SAME prefix — even if the container walks above
  // didn't happen to reach them.
  for (const candidate of candidates.slice()) {
    if (!candidate.id) continue
    const suffix = PAGER_ID_SUFFIXES.find((s) => candidate.id.toLowerCase().endsWith(s.toLowerCase()))
    if (!suffix) continue
    const prefix = candidate.id.slice(0, candidate.id.length - suffix.length)
    for (const otherSuffix of PAGER_ID_SUFFIXES) {
      if (otherSuffix === suffix) continue
      const otherId = prefix + otherSuffix
      if (seenIds.has(otherId)) continue
      addCandidate(document.getElementById(otherId))
    }
  }

  return {
    found: Boolean(ofAnchor),
    totalPagesText,
    totalRowsText,
    currentPageValue,
    pageSizeValue,
    candidates: candidates.map((c, index) => ({ ...c, domOrder: index })),
  }
}

/**
 * item 4: triggers the REAL Next control's own native handler with a
 * plain, ordinary click call — the default browser action is never
 * suppressed first, so an ASP.NET `__doPostBack` (or any other wiring
 * already on the element) fires exactly as it would for a genuine
 * teacher click; this never simulates a postback itself. Re-locates the
 * element FRESH in this SEPARATE executeScript call (an element
 * reference from inspectPaginationControls' own call cannot be reused
 * here — see popup.js's own note on why the two are split into
 * independent calls) — by `document.getElementById` when the confirmed
 * descriptor has an id (a globally unique, stable identity — and now the
 * PREFERRED way every real pager control here is found in the first
 * place), otherwise by an exact match on every other captured field
 * within the pagination cluster, never a looser guess that could
 * silently click a different control.
 */
export function clickPaginationControl(descriptor) {
  if (descriptor.id) {
    const byId = document.getElementById(descriptor.id)
    if (!byId) return { clicked: false }
    byId.click()
    return { clicked: true }
  }

  const OF_PATTERN = /ของ\s*(\d+)/
  const CLICKABLE_SELECTOR = 'a,button,input[type="button"],input[type="submit"],input[type="image"],[onclick]'

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let anchorNode = null
  let node
  while ((node = walker.nextNode())) {
    if (OF_PATTERN.test((node.textContent || '').trim())) {
      anchorNode = node
      break
    }
  }
  if (!anchorNode) return { clicked: false }

  let container = anchorNode.parentElement
  let elements = []
  for (let depth = 0; depth < 6 && container; depth++) {
    elements = Array.from(container.querySelectorAll(CLICKABLE_SELECTOR))
    if (elements.length > 0) break
    container = container.parentElement
  }

  function describe(el) {
    const tag = el.tagName.toLowerCase()
    const text = tag === 'input' ? el.value || el.getAttribute('alt') || el.getAttribute('title') || '' : (el.textContent || '').trim()
    return { tag, onclick: el.getAttribute('onclick'), href: el.getAttribute('href'), text: (text || '').trim() }
  }

  const target = elements.find((el) => {
    const d = describe(el)
    return d.tag === descriptor.tag && d.text === descriptor.text && d.onclick === descriptor.onclick && d.href === descriptor.href
  })

  if (!target) return { clicked: false }
  target.click()
  return { clicked: true }
}

/**
 * item 3's "current grid fingerprint" — the confirmed run's own row text,
 * read fresh in ITS OWN executeScript call so it can be captured once
 * right before a click and again afterward (from two independent calls,
 * which safely survive an intervening full-page navigation that would
 * destroy any single long-running injected function — see popup.js's own
 * note on why the old single-call polling approach was fragile against a
 * real ASP.NET postback). Read-only.
 */
export function readGridFingerprint(tableIndex, runStartIndex, runLength) {
  const table = document.querySelectorAll('table')[tableIndex]
  if (!table) return null
  const rows = Array.from(table.rows).slice(runStartIndex, runStartIndex + runLength)
  return rows
    .map((row) =>
      Array.from(row.cells)
        .map((c) => (c.textContent || '').trim())
        .join('|'),
    )
    .join('||')
}
