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
 * Primary diagnostic — reads RAW structural facts only (cell counts,
 * which cells contain an input, and the TEXT of non-input cells) for
 * EVERY row of EVERY table on the page, with no interpretation at all:
 * finding "the" student grid among these ~200 tables is
 * sgs-table-extraction.js's job (pickBestStudentGridCandidate), run
 * afterward in the extension/popup context on the plain data this
 * returns.
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
              const hasInput = cell.querySelector('input,select') !== null
              return { hasInput, text: hasInput ? '' : textOf(cell) }
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

  const rows = Array.from(table.rows)
  const values = {}
  for (let offset = 0; offset < runLength; offset++) {
    const row = rows[runStartIndex + offset]
    // Only ever indexes into `columnIndex` — the one column requested.
    const cell = row ? row.cells[columnIndex] : null
    const input = cell ? cell.querySelector('input,select') : null
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
 * (popup.js, via buildSgsRealWriteInstructions) already decided exactly
 * which rows get a value and what it is; this function only ever writes
 * what it's told, into the ONE column it's told.
 */
export function fillSgsColumnValues(tableIndex, runStartIndex, columnIndex, writesByOffset) {
  const table = document.querySelectorAll('table')[tableIndex]
  if (!table) {
    return { found: false, writtenCount: 0, missingOffsets: Object.keys(writesByOffset).map(Number) }
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
    const input = cell ? cell.querySelector('input,select') : null
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
