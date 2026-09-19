/**
 * This is the ONLY file in this extension that runs inside the SGS page
 * itself, via `chrome.scripting.executeScript`, and only ever on an
 * explicit teacher button click — never automatically.
 *
 * `chrome.scripting.executeScript({ func })` serializes whichever
 * function it is given (`Function.prototype.toString`) and re-runs it
 * standalone inside the target page — it has NO access to this file's
 * module scope, its imports, or any sibling function here. That is why
 * `inspectSgsScoreTable` and `fillSgsColumnValues` below each declare
 * their own local copy of `findBestScoreTable` and a MINIMAL identifier-
 * column check: there is no way for them to share code across that
 * boundary. Anything that doesn't need to run inside the page (parsing
 * a header's max score, building a columnKey, matching a teacher's
 * chosen column to a real one, deciding skip vs. write) lives in
 * ./lib/sgs-table-extraction.js and ./lib/sgs-real-fill.js instead,
 * imported normally by popup.js — an extension page, which fully
 * supports ES modules unlike an injected content script.
 */

/**
 * Two selectors CONFIRMED against the real SGS page (never guessed):
 * the subject and classroom filter inputs. Read via `getElementById`
 * (which takes the literal id string, dot and all — no CSS-selector
 * escaping needed) purely to LABEL a diagnostic capture with which
 * subject/classroom it came from; neither is ever used to decide
 * anything about the score table itself, and neither is a credential —
 * a filter dropdown's current selection is exactly the kind of page
 * state a teacher already sees on screen.
 */
export const KNOWN_SGS_FILTER_IDS = {
  subject: 'ctl00_PageContent_ClassSubjectIDFilter.Filter_Input',
  classroom: 'ctl00_PageContent_ClassSectionNoFilter.Filter_Input',
}

/**
 * Phase 5 generic diagnostic — collects STRUCTURE only:
 *   - page URL / title
 *   - form and table counts
 *   - each table's row count, a safe CSS selector candidate
 *     (tag + id + first class — never an index into real data), and its
 *     VISIBLE header text (from <thead> or the first row)
 *   - every input/select/textarea's TYPE (never its current value) and
 *     a safe selector candidate for it
 *   - whether the two known subject/classroom filters are present, and
 *     their current selection (see KNOWN_SGS_FILTER_IDS above)
 *
 * Deliberately NEVER reads: document.cookie, localStorage,
 * sessionStorage, any OTHER input's `.value`, or any table BODY row's
 * text (only header cells) — there is no student personal data or SGS
 * credential this function could return even if asked to. Intended to
 * be run once per distinct SGS page/subject/classroom combination (the
 * teacher expects roughly 18 of these) so every capture is directly
 * comparable.
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
    // Presence-only (never a value) — lets buildDiagnosticReport guess
    // which columns are score columns for EVERY table on the page, not
    // just whichever one inspectSgsScoreTable picks as "best."
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

  // Duplicates KNOWN_SGS_FILTER_IDS's two literal values (this function
  // is itself injected via executeScript's `func` and can't reference
  // this file's own module-level export once serialized — same
  // constraint explained in the file header).
  const knownFilterIds = {
    subject: 'ctl00_PageContent_ClassSubjectIDFilter.Filter_Input',
    classroom: 'ctl00_PageContent_ClassSectionNoFilter.Filter_Input',
  }
  const knownFilters = {}
  for (const [name, id] of Object.entries(knownFilterIds)) {
    const el = document.getElementById(id)
    knownFilters[name] = { present: Boolean(el), currentValue: el ? el.value || null : null }
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
 * Phase 2 — finds the real student score table and reports its
 * structure PLUS (only once a column has been chosen) that one column's
 * current values. Never invents a selector for a score input: the table
 * is found by a plain structural heuristic (has a recognizable
 * เลขที่/รหัส/ชื่อ header AND at least one input in its body rows), and
 * every score column reported is simply "a non-identifier column that
 * contains an input," derived from what's actually on the page.
 *
 * `targetColumnIndex`: pass `null` on the FIRST call (structure only,
 * before the teacher has picked a column) or the column's index (from
 * a PRIOR call's own `scoreColumns`) once the teacher has confirmed
 * which real column to inspect — this second call re-finds the SAME
 * table via the SAME deterministic heuristic and reads that one
 * column's current values, never any other column's.
 */
export function inspectSgsScoreTable(targetColumnIndex) {
  function textOf(el) {
    return el && el.textContent ? el.textContent.trim().replace(/\s+/g, ' ') : ''
  }

  function findBestScoreTable() {
    const tables = Array.from(document.querySelectorAll('table'))
    let best = null
    let bestScore = -1
    for (const table of tables) {
      const headerRow = table.querySelector('thead tr') || table.rows[0]
      if (!headerRow) continue
      const headerCells = Array.from(headerRow.querySelectorAll('th,td'))
      if (headerCells.length === 0) continue
      const headerTexts = headerCells.map(textOf)
      const allRows = Array.from(table.querySelectorAll('tr'))
      const bodyRows = allRows.filter((r) => r !== headerRow)
      if (bodyRows.length < 1) continue
      const inputCount = bodyRows[0].querySelectorAll('input,select').length
      const hasIdentifierHeader = headerTexts.some((h) => /เลขที่|ลำดับ|รหัส|ชื่อ/.test(h))
      const score = (hasIdentifierHeader ? 2 : 0) + (inputCount > 0 ? 2 : 0) + Math.min(bodyRows.length, 10) / 10
      if (score > bestScore) {
        bestScore = score
        best = { table, headerCells, headerTexts, bodyRows }
      }
    }
    return best
  }

  const best = findBestScoreTable()
  if (!best) {
    return { found: false }
  }

  // Minimal, duplicated-on-purpose identifier check (see file header) —
  // the full, tested version is identifyIdentifierColumns in
  // ./lib/sgs-table-extraction.js.
  function findIdentifierIndex(pattern) {
    const index = best.headerTexts.findIndex((text) => pattern.test(text))
    return index === -1 ? null : index
  }
  const identifierColumns = {
    numberColumnIndex: findIdentifierIndex(/เลขที่|ลำดับ/),
    codeColumnIndex: findIdentifierIndex(/รหัสนักเรียน|รหัสประจำตัว|เลขประจำตัว/),
    nameColumnIndex: findIdentifierIndex(/ชื่อ.?สกุล|ชื่อ-นามสกุล|ชื่อนักเรียน|^ชื่อ$/),
  }

  const columnsHaveInput = best.headerCells.map((_, columnIndex) =>
    best.bodyRows.some((row) => {
      const cell = row.children[columnIndex]
      return cell ? cell.querySelector('input,select') !== null : false
    }),
  )

  const rows = best.bodyRows.map((row) => {
    const cells = Array.from(row.children)
    return {
      number: identifierColumns.numberColumnIndex !== null ? textOf(cells[identifierColumns.numberColumnIndex]) : null,
      code: identifierColumns.codeColumnIndex !== null ? textOf(cells[identifierColumns.codeColumnIndex]) : null,
      name: identifierColumns.nameColumnIndex !== null ? textOf(cells[identifierColumns.nameColumnIndex]) : null,
    }
  })

  let columnValues = null
  if (targetColumnIndex !== null && targetColumnIndex !== undefined) {
    columnValues = {}
    best.bodyRows.forEach((row, rowIndex) => {
      const cell = row.children[targetColumnIndex]
      const input = cell ? cell.querySelector('input,select') : null
      const raw = input ? input.value : textOf(cell)
      const parsed = raw === '' || raw === null || raw === undefined ? null : Number(raw)
      columnValues[rowIndex] = Number.isFinite(parsed) ? parsed : null
    })
  }

  return {
    found: true,
    headerTexts: best.headerTexts,
    columnsHaveInput,
    identifierColumns,
    rows,
    columnValues,
  }
}

/**
 * Phase 2 — writes ONLY the given column's cells, ONLY for the given
 * row indexes, and dispatches the `input`/`change` events a plain HTML
 * form (or JS listening for them) expects — then returns without ever
 * looking for, let alone clicking, any Save/Submit control. Re-finds
 * the same table via the SAME deterministic heuristic
 * `inspectSgsScoreTable` uses (duplicated here for the same
 * closure-serialization reason — see the file header), so it never
 * relies on a DOM handle kept from an earlier call.
 *
 * `writesByRowIndex`: a plain object `{ [rowIndex]: value }` — the
 * caller (popup.js, via buildSgsRealWriteInstructions) already decided
 * exactly which rows get a value and what it is; this function only
 * ever writes what it's told, into the ONE column it's told, and
 * reports which rows it could not find a writable input for.
 */
export function fillSgsColumnValues(targetColumnIndex, writesByRowIndex) {
  function textOf(el) {
    return el && el.textContent ? el.textContent.trim().replace(/\s+/g, ' ') : ''
  }

  function findBestScoreTable() {
    const tables = Array.from(document.querySelectorAll('table'))
    let best = null
    let bestScore = -1
    for (const table of tables) {
      const headerRow = table.querySelector('thead tr') || table.rows[0]
      if (!headerRow) continue
      const headerCells = Array.from(headerRow.querySelectorAll('th,td'))
      if (headerCells.length === 0) continue
      const headerTexts = headerCells.map(textOf)
      const allRows = Array.from(table.querySelectorAll('tr'))
      const bodyRows = allRows.filter((r) => r !== headerRow)
      if (bodyRows.length < 1) continue
      const inputCount = bodyRows[0].querySelectorAll('input,select').length
      const hasIdentifierHeader = headerTexts.some((h) => /เลขที่|ลำดับ|รหัส|ชื่อ/.test(h))
      const score = (hasIdentifierHeader ? 2 : 0) + (inputCount > 0 ? 2 : 0) + Math.min(bodyRows.length, 10) / 10
      if (score > bestScore) {
        bestScore = score
        best = { table, bodyRows }
      }
    }
    return best
  }

  const best = findBestScoreTable()
  if (!best) {
    return { found: false, writtenCount: 0, missingRowIndexes: Object.keys(writesByRowIndex).map(Number) }
  }

  let writtenCount = 0
  const missingRowIndexes = []
  for (const [rowIndexKey, value] of Object.entries(writesByRowIndex)) {
    const rowIndex = Number(rowIndexKey)
    const row = best.bodyRows[rowIndex]
    // Only ever indexes into `targetColumnIndex` — the one column
    // requested — never anything derived from another column.
    const cell = row ? row.children[targetColumnIndex] : null
    const input = cell ? cell.querySelector('input,select') : null
    if (!input) {
      missingRowIndexes.push(rowIndex)
      continue
    }
    input.value = String(value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    writtenCount += 1
  }

  return { found: true, writtenCount, missingRowIndexes }
}
