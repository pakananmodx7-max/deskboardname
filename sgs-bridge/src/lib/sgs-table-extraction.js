/**
 * BUG FIX (see git history for the original report): the previous
 * version of this module tried to identify the student grid by matching
 * TABLE HEADER TEXT against a few Thai keywords (เลขที่/รหัส/ชื่อ). On
 * the real SGS page that never matched anything, because the real grid
 * is one deeply nested `<table>` among ~200 ASP.NET layout tables, and
 * its header text doesn't necessarily match those exact keywords in the
 * way the old heuristic assumed.
 *
 * This version instead finds the grid by its STRUCTURE: a real student
 * row is one of several CONSECUTIVE rows in the same table that all
 * share the exact same shape (same number of cells, inputs in the same
 * cell positions) — see findRepeatingRowRun. Once that repeating run is
 * found, the actual cell CONTENT of the non-input columns (short numeric
 * = เลขที่, longer/zero-padded numeric = รหัสนักเรียน, Thai text = ชื่อ-
 * นามสกุล) is what identifies which column is which — never the header
 * text alone, and never a hardcoded column index.
 *
 * Every function here is pure — it only ever consumes plain data
 * (`{hasInput, text}` cells) already read off the page by
 * content-diagnostic.js's `collectAllTableRowFacts` (which itself does
 * no interpretation, just raw structural reading) — so all of this is
 * fully unit-testable without a browser or jsdom.
 */

const THAI_CHAR_PATTERN = /[฀-๿]/

/**
 * v2 cell shape (from content-diagnostic.js's collectAllTableRowFacts):
 * `{ hasInput, hasLink, text, inputMeta }`, where `inputMeta` is null
 * for a non-input cell and `{ count, type, disabled, readonly }` for
 * one that has an input. Every function below that only needs
 * `hasInput`/`text` (row-shape fingerprinting, identifier
 * classification) still works unchanged against this shape — the extra
 * fields are simply ignored there. `inputMeta` only matters to
 * analyzeColumnEditability, and `hasLink` only to detectPagination.
 */

// ==================================================
// Row fingerprinting — "does this row have the same SHAPE as that one,"
// never "does it contain the same values."
// ==================================================

/** @param {{hasInput: boolean, text: string}[]} cells */
export function buildRowFingerprint(cells) {
  return {
    cellCount: cells.length,
    inputCellIndexes: cells.map((c, i) => (c.hasInput ? i : -1)).filter((i) => i !== -1),
  }
}

export function fingerprintsEqual(a, b) {
  return (
    a.cellCount === b.cellCount &&
    a.inputCellIndexes.length === b.inputCellIndexes.length &&
    a.inputCellIndexes.every((v, i) => v === b.inputCellIndexes[i])
  )
}

/**
 * A fingerprint shape that could plausibly be a student score row — at
 * least one input (a row of pure labels/spacers never qualifies) and
 * enough cells for เลขที่/รหัส/ชื่อ plus at least one score column. This
 * is what stops a long run of identical EMPTY spacer rows (common in
 * ASP.NET layout tables) from being mistaken for the grid.
 */
export function looksLikeStudentRowFingerprint(fingerprint) {
  return fingerprint.inputCellIndexes.length >= 1 && fingerprint.cellCount >= 4
}

/**
 * Finds the longest run of CONSECUTIVE rows sharing an identical
 * fingerprint, among only the runs whose shared fingerprint passes
 * `isQualifying` — so a long run of matching but non-qualifying rows
 * (e.g. blank spacer rows) never wins over a shorter run of real
 * student rows. Returns null if no qualifying run reaches
 * `minRunLength` — "multiple consecutive rows with the SAME structure,"
 * never a single row taken on faith.
 */
export function findRepeatingRowRun(fingerprints, options = {}) {
  const minRunLength = options.minRunLength ?? 3
  const isQualifying = options.isQualifying ?? looksLikeStudentRowFingerprint

  let bestStart = null
  let bestLength = 0
  let i = 0
  while (i < fingerprints.length) {
    let j = i + 1
    while (j < fingerprints.length && fingerprintsEqual(fingerprints[j], fingerprints[i])) j++
    const length = j - i
    if (length > bestLength && isQualifying(fingerprints[i])) {
      bestLength = length
      bestStart = i
    }
    i = j
  }

  if (bestStart === null || bestLength < minRunLength) return null
  return { startIndex: bestStart, length: bestLength }
}

// ==================================================
// Identifier-column classification — by CONTENT, not header text.
// ==================================================

/**
 * @param {{hasInput: boolean, text: string}[][]} rowsInRun - only the
 *   rows belonging to the accepted repeating run, each the same shape.
 */
export function classifyIdentifierColumns(rowsInRun) {
  const firstInputIndexes = rowsInRun
    .map((cells) => cells.findIndex((c) => c.hasInput))
    .filter((i) => i !== -1)
  const firstInputIndex = firstInputIndexes.length > 0 ? Math.min(...firstInputIndexes) : Infinity

  const textColumnIndexes = new Set()
  for (const cells of rowsInRun) {
    cells.forEach((cell, index) => {
      if (!cell.hasInput && index < firstInputIndex) textColumnIndexes.add(index)
    })
  }

  function textsAt(index) {
    return rowsInRun.map((cells) => cells[index]?.text ?? '').filter((t) => t !== '')
  }

  const numericColumns = []
  let nameColumnIndex = null
  let bestNameAvgLength = -1

  for (const index of textColumnIndexes) {
    const texts = textsAt(index)
    if (texts.length === 0) continue

    if (texts.every((t) => /^\d+$/.test(t))) {
      const avgLength = texts.reduce((sum, t) => sum + t.length, 0) / texts.length
      const hasLeadingZero = texts.some((t) => t.length > 1 && t[0] === '0')
      numericColumns.push({ index, avgLength, hasLeadingZero })
    } else if (texts.some((t) => THAI_CHAR_PATTERN.test(t))) {
      const avgLength = texts.reduce((sum, t) => sum + t.length, 0) / texts.length
      if (avgLength > bestNameAvgLength) {
        bestNameAvgLength = avgLength
        nameColumnIndex = index
      }
    }
  }

  // เลขที่ (running number) is always the SHORTEST numeric column;
  // รหัสนักเรียน (student code) is longer and/or zero-padded — a
  // zero-padded numeric string is never a plain running number.
  numericColumns.sort((a, b) => a.avgLength - b.avgLength)
  const numberColumnIndex = numericColumns.length >= 1 ? numericColumns[0].index : null
  let codeColumnIndex = null
  if (numericColumns.length >= 2) {
    const rest = numericColumns.slice(1)
    const zeroPadded = rest.find((c) => c.hasLeadingZero)
    codeColumnIndex = (zeroPadded ?? rest[rest.length - 1]).index
  }

  return { numberColumnIndex, codeColumnIndex, nameColumnIndex }
}

// ==================================================
// Header interpretation — vertical trace from a score column to its
// header cell, with an explicit reject list so an unrelated page value
// (an academic year, a menu label, a login/logout control) is never
// mistaken for a max score.
// ==================================================

const REJECT_HEADER_KEYWORDS = /ปีการศึกษา|เมนู|ภาษา|logout|login|ออกจากระบบ|เข้าสู่ระบบ|^ปี\b|ปี\s*\d|ชั้น/i

export function isRejectedHeaderText(text) {
  return REJECT_HEADER_KEYWORDS.test(text)
}

/**
 * Pulls a plausible max score out of a column header like "ช่อง 1 (15)"
 * or "กลางภาค (10 คะแนน)" — the LAST number in the header, but ONLY if
 * it's in a realistic Thai school max-score range (1-100). A 4-digit
 * number (an academic year like 2568) or anything implausibly large is
 * rejected rather than trusted, and a header matching
 * REJECT_HEADER_KEYWORDS is rejected outright regardless of what
 * numbers it contains. Returns null rather than a guess either way.
 */
export function parseMaxScoreFromHeader(headerText) {
  if (isRejectedHeaderText(headerText)) return null
  const matches = headerText.match(/\d+(\.\d+)?/g)
  if (!matches || matches.length === 0) return null
  const last = Number(matches[matches.length - 1])
  return Number.isFinite(last) && last > 0 && last <= 100 ? last : null
}

export function slugifyHeaderText(headerText) {
  return headerText
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[()]/g, '')
    .toLowerCase()
}

export function buildColumnKey(headerText, columnIndex) {
  const slug = slugifyHeaderText(headerText) || 'column'
  return `real-${slug}-${columnIndex}`
}

/**
 * Real SGS pages spread a score column's header across MORE than one
 * row above the data (e.g. an assignment number "10" right above the
 * run, with its max score shown in a separate row further up) — see
 * deriveScoreColumnHeader below for how that's combined. Traces up to
 * `maxRowsUp` rows immediately above the run for ONE column, collecting
 * every non-empty header cell's text found, ordered furthest-from-data
 * first, closest-to-data last.
 *
 * LIVE DISCOVERY: a real SGS header cell can ALSO contain the column's
 * gating checkbox (see findHeaderCheckboxState) — content-diagnostic.js
 * now always captures a cell's text regardless of whether it also has
 * an input (see its own doc comment), so this no longer skips a header
 * cell just because `hasInput` is true; skipping it would silently
 * discard that checkbox cell's own visible label (e.g. "10" next to its
 * checkbox).
 */
export function traceColumnHeaderTexts(tableFacts, columnIndex, runStartIndex, maxRowsUp = 6) {
  const texts = []
  for (let distance = maxRowsUp; distance >= 1; distance--) {
    const rowIndex = runStartIndex - distance
    if (rowIndex < 0) continue
    const cell = tableFacts.rows[rowIndex]?.[columnIndex]
    const text = cell ? (cell.text ?? '').trim() : ''
    if (text) texts.push(text)
  }
  return texts
}

/**
 * `label` is the text CLOSEST to the data row (the last one traced) —
 * matching the visible SGS UI's own column headers ("10", "11", ...,
 * "กลางภาค"). `maxScore` is looked for among the OTHER traced texts
 * FIRST (a separate row/cell showing the max score, "shown under/near
 * the header" per the spec) so a bare numeric label like "10" is never
 * ALSO reported as that column's max score; only if no other traced
 * text yields a plausible number does it fall back to parsing the
 * label text itself (still supports an already-combined header like
 * "กลางภาค (10)").
 */
export function deriveScoreColumnHeader(headerTexts) {
  if (headerTexts.length === 0) return { label: null, maxScore: null }
  const label = headerTexts[headerTexts.length - 1]
  const otherTexts = headerTexts.slice(0, -1)
  for (const text of otherTexts) {
    const maxScore = parseMaxScoreFromHeader(text)
    if (maxScore !== null) return { label, maxScore }
  }
  // A bare numeric label ("10") is just an assignment identifier, never
  // also that column's max score — only fall back to parsing the label
  // text itself when it's a NAMED header that might already combine a
  // number, e.g. an already-combined "กลางภาค (10)".
  if (/^\d+$/.test(label.trim())) return { label, maxScore: null }
  return { label, maxScore: parseMaxScoreFromHeader(label) }
}

/**
 * Column headers/labels that mean "this is a calculated or status
 * column," never a place a teacher directly types a score into — a
 * running total, a percentage, an attendance/behavior status, a grade
 * letter, a GPA. Checked in ADDITION to actual input-editability
 * (analyzeColumnRowInputState below); a column is only ever offered as a
 * fill target when BOTH agree it's safe.
 *
 * LIVE DISCOVERY additions: แก้ตัว/เรียนซ้ำ ("retake"/"repeat") are
 * grading-status flags, not numeric score entry; Remark is a free-text
 * note column. (หลังกลางภาค — "after midterm" — is left OUT of this
 * list deliberately: on the real page it may be a genuine teacher-facing
 * running subtotal rather than a status flag, and nothing in the live
 * discovery confirmed it's calculated, so it's still classified the same
 * way as any other numbered/named score column.) None of these matched
 * labels are ever a real score-entry column, regardless of what their
 * inputs' current disabled/checkbox state looks like.
 */
const DERIVED_COLUMN_LABEL_KEYWORDS =
  /รวม|ตลอดภาค|เฉลี่ย|เกรด|ผลการเรียน|สถานะ|ปกติ|แก้ตัว|เรียนซ้ำ|remark|^%$|เปอร์เซ็นต์|ร้อยละ|GPA/i

export function isDerivedColumnLabel(label) {
  return typeof label === 'string' && DERIVED_COLUMN_LABEL_KEYWORDS.test(label)
}

/**
 * Determines whether EVERY row in the run has exactly one genuinely
 * editable input in this column — the ONLY thing that makes a column a
 * safe fill target (item 5 of the original spec: "each row has exactly
 * one writable input for that target column"). Kept for backward
 * compatibility with anything that only needs a single disabled/readonly
 * signal; classifyScoreColumns below now uses the richer
 * analyzeColumnRowInputState instead, which is aware of per-input
 * VISIBILITY (see the LIVE DISCOVERY note there) and never confuses a
 * hidden sibling control's state with the one the teacher can actually
 * see and type into.
 */
export function analyzeColumnEditability(columnIndex, rowsInRun) {
  const cells = rowsInRun.map((row) => row[columnIndex]).filter(Boolean)
  const inputCells = cells.filter((c) => c.hasInput)
  const allRowsHaveInput = cells.length > 0 && inputCells.length === cells.length
  const metas = inputCells.map((c) => c.inputMeta).filter(Boolean)

  const inputCount = metas.reduce((sum, m) => sum + m.count, 0)
  const inputType = metas.length > 0 ? metas[0].type : null
  const disabled = metas.some((m) => m.disabled)
  const readonly = metas.some((m) => m.readonly)
  const allSingleInput = metas.length > 0 && metas.every((m) => m.count === 1)
  const allEditableType = metas.length > 0 && metas.every((m) => m.type === 'text' || m.type === 'number')

  return {
    hasEditableInput: allRowsHaveInput && allSingleInput && allEditableType && !disabled && !readonly,
    inputCount,
    inputType,
    disabled,
    readonly,
  }
}

/**
 * LIVE DISCOVERY (item 6 of the follow-up spec): finds a checkbox in one
 * of the header rows traced above the student run, for ONE column —
 * a real SGS score column's header holds a checkbox that gates whether
 * that column's row inputs are editable at all. Scans from the row
 * closest to the data upward (a checkbox row is expected to sit
 * immediately above the student rows, not several group-header rows
 * further up), and reports `present: false` — never a guess — when no
 * such checkbox is found in any traced row.
 */
export function findHeaderCheckboxState(tableFacts, columnIndex, runStartIndex, maxRowsUp = 6) {
  for (let distance = 1; distance <= maxRowsUp; distance++) {
    const rowIndex = runStartIndex - distance
    if (rowIndex < 0) continue
    const cell = tableFacts.rows[rowIndex]?.[columnIndex]
    if (cell?.hasInput && cell.inputMeta?.type === 'checkbox') {
      return { present: true, checked: cell.inputMeta.checked === true }
    }
  }
  return { present: false, checked: false }
}

/**
 * LIVE DISCOVERY (item 6): per-row input state for ONE column, built
 * ONLY from the ACTUAL VISIBLE control content-diagnostic.js's
 * inspectCellFormControl already chose for each cell — never inferred
 * from the outer table, a cloned/hidden control, a header element, or an
 * unrelated input. `visibleCount`/`visible` come straight from that
 * choice, so a cell with a hidden helper input alongside the real,
 * visible, enabled one is correctly counted as "one visible input,
 * enabled" rather than "two inputs, ambiguous."
 *
 * Falls back to treating a cell's control as visible/enabled when an
 * older-shaped inputMeta (without `visible`/`visibleCount`, e.g. a test
 * fixture written before this fix) is passed in, preserving prior
 * behavior for callers that never had a visibility concept at all.
 */
export function analyzeColumnRowInputState(columnIndex, rowsInRun) {
  const cells = rowsInRun.map((row) => row[columnIndex]).filter(Boolean)
  const inputCells = cells.filter((c) => c.hasInput && c.inputMeta)

  let visibleInputCount = 0
  let enabledInputCount = 0
  let disabledInputCount = 0
  let readonlyInputCount = 0

  for (const cell of inputCells) {
    const meta = cell.inputMeta
    const isVisible = meta.visible !== undefined ? meta.visible : true
    if (isVisible) visibleInputCount += 1
    if (!isVisible || meta.disabled) disabledInputCount += 1
    else if (meta.readonly) readonlyInputCount += 1
    else enabledInputCount += 1
  }

  const allRowsHaveInput = cells.length > 0 && inputCells.length === cells.length
  const allSingleInput =
    inputCells.length > 0 &&
    inputCells.every((c) => {
      const visibleCount = c.inputMeta.visibleCount ?? c.inputMeta.count
      return visibleCount <= 1
    })
  const allEditableType =
    inputCells.length > 0 && inputCells.every((c) => c.inputMeta.type === 'text' || c.inputMeta.type === 'number')

  return {
    rowCount: cells.length,
    visibleInputCount,
    enabledInputCount,
    disabledInputCount,
    readonlyInputCount,
    allRowsHaveInput,
    allSingleInput,
    allEditableType,
    anyDisabled: disabledInputCount > 0,
    anyReadonly: readonlyInputCount > 0,
  }
}

/**
 * Section 1 of the live-discovery spec: the raw per-column CURRENT
 * state — header label/max score, header checkbox presence/checked
 * state, and the row-level visible/enabled/disabled/readonly counts —
 * with NO classification decision made yet (that's classifyScoreColumns
 * below). `writableNow` here means exactly what item 1's example shows:
 * a structurally sound column (one visible text/number input per row)
 * whose header checkbox (if it has one) is checked and whose inputs are
 * not currently disabled/readonly — never inferred from the header
 * label alone.
 */
export function scanScoreColumnState(tableFacts, columnIndex, run) {
  const rowsInRun = tableFacts.rows.slice(run.startIndex, run.startIndex + run.length)
  const headerTexts = traceColumnHeaderTexts(tableFacts, columnIndex, run.startIndex)
  const { label, maxScore } = deriveScoreColumnHeader(headerTexts)
  const checkboxState = findHeaderCheckboxState(tableFacts, columnIndex, run.startIndex)
  const rowState = analyzeColumnRowInputState(columnIndex, rowsInRun)

  const structurallySound =
    rowState.allRowsHaveInput && rowState.rowCount > 0 && rowState.allSingleInput && rowState.allEditableType
  const checkboxGatesOff = checkboxState.present && !checkboxState.checked

  return {
    columnIndex,
    label,
    maxScore,
    rowCount: rowState.rowCount,
    headerCheckboxPresent: checkboxState.present,
    headerCheckboxChecked: checkboxState.checked,
    visibleInputCount: rowState.visibleInputCount,
    enabledInputCount: rowState.enabledInputCount,
    disabledInputCount: rowState.disabledInputCount,
    readonlyInputCount: rowState.readonlyInputCount,
    allRowsHaveInput: rowState.allRowsHaveInput,
    allSingleInput: rowState.allSingleInput,
    allEditableType: rowState.allEditableType,
    anyReadonly: rowState.anyReadonly,
    anyDisabled: rowState.anyDisabled,
    writableNow: structurallySound && !rowState.anyReadonly && !rowState.anyDisabled && !checkboxGatesOff,
  }
}

/**
 * Splits every input column from the accepted run (excluding identifier
 * columns) into THREE buckets (LIVE DISCOVERY, item 2):
 *
 *  - `writableScoreColumns` ("writableNow"): a real, structurally sound
 *    score column whose header checkbox (if any) is checked and whose
 *    row inputs are actually enabled right now.
 *  - `activatableScoreColumns`: a real, structurally sound score column
 *    that is CURRENTLY disabled only because its header checkbox is
 *    unchecked (or its inputs are otherwise disabled) — NEVER classified
 *    as derived just because it's disabled right now (item 2's explicit
 *    requirement).
 *  - `derivedColumns`: genuinely calculated/status columns (by label —
 *    รวมตลอดภาค, %, ปกติ, ...), columns with no input at all, columns
 *    that aren't uniformly one-visible-input-per-row, or a column whose
 *    input is READONLY (a computed value rendered read-only is never
 *    "just needs its checkbox checked" — unchecking/checking a header
 *    checkbox toggles `disabled`, not `readonly`, on the live page).
 *
 * `derivedColumns`/`activatableScoreColumns` are reporting only — see
 * popup.js's gridMeetsFillRequirements for the actual write-time gate,
 * which only ever allows a `writableScoreColumns` entry.
 */
export function classifyScoreColumns(tableFacts, run, identifierColumns) {
  const rowsInRun = tableFacts.rows.slice(run.startIndex, run.startIndex + run.length)
  const fingerprint = buildRowFingerprint(rowsInRun[0] ?? [])
  const identifierSet = new Set(
    [identifierColumns.numberColumnIndex, identifierColumns.codeColumnIndex, identifierColumns.nameColumnIndex].filter(
      (i) => i !== null,
    ),
  )
  const candidateIndexes = fingerprint.inputCellIndexes.filter((index) => !identifierSet.has(index))

  const writableScoreColumns = []
  const activatableScoreColumns = []
  const derivedColumns = []

  for (const columnIndex of candidateIndexes) {
    const state = scanScoreColumnState(tableFacts, columnIndex, run)
    if (isRejectedHeaderText(state.label ?? '')) continue // an academic year/menu/login label — not a real column at all

    const resolvedLabel = state.label ?? `คอลัมน์ ${columnIndex + 1}`

    if (isDerivedColumnLabel(state.label)) {
      derivedColumns.push({ columnIndex, label: resolvedLabel, reason: 'label_indicates_calculated_or_status' })
      continue
    }
    if (!state.allRowsHaveInput) {
      derivedColumns.push({ columnIndex, label: resolvedLabel, reason: 'no_input' })
      continue
    }
    if (!state.allSingleInput || !state.allEditableType) {
      derivedColumns.push({ columnIndex, label: resolvedLabel, reason: 'not_uniformly_editable' })
      continue
    }
    if (state.anyReadonly) {
      derivedColumns.push({ columnIndex, label: resolvedLabel, reason: 'readonly_input' })
      continue
    }

    const shared = {
      columnIndex,
      key: buildColumnKey(resolvedLabel, columnIndex),
      label: resolvedLabel,
      maxScore: state.maxScore,
      headerCheckboxPresent: state.headerCheckboxPresent,
      headerCheckboxChecked: state.headerCheckboxChecked,
      visibleInputCount: state.visibleInputCount,
      enabledInputCount: state.enabledInputCount,
      disabledInputCount: state.disabledInputCount,
      readonlyInputCount: state.readonlyInputCount,
    }

    if (!state.writableNow) {
      // A real, structurally sound score column that is merely disabled
      // right now (header checkbox unchecked, or otherwise disabled) —
      // NEVER derived (item 2's explicit requirement).
      const checkboxGatesOff = state.headerCheckboxPresent && !state.headerCheckboxChecked
      activatableScoreColumns.push({
        ...shared,
        reason: checkboxGatesOff ? 'header_checkbox_unchecked' : 'disabled_input',
      })
      continue
    }

    writableScoreColumns.push({ ...shared, inputPattern: 'text', inputCount: state.rowCount })
  }

  return { writableScoreColumns, activatableScoreColumns, derivedColumns }
}

// ==================================================
// Pagination — best-effort, never blocking, never auto-navigating.
//
// LIVE DISCOVERY: the real SGS page's pagination is NOT a row of
// clickable page-number links (the ASP.NET GridView-style pager this
// module originally assumed, kept below as a fallback) — it's a small
// cluster of SEPARATE elements: an `<input>` holding the current page
// number, plain text "ของ 4" (Thai "of 4") for the total page count,
// plain text "32 รายการ" for the total record count, and another
// `<input>` holding the page size next to plain text "/หน้า". There is
// NO literal "1/4" or "page 1 of 4" string anywhere on the real page —
// an earlier version of this fix assumed one, which silently left
// currentPage/totalPages `null` forever on the live page (see
// parseRealPaginationFragments below for the actual fix). content-
// diagnostic.js's collectAllTableRowFacts extracts these via the SAME
// fragment-walk algorithm (never a guessed selector) and hands them here
// as `hints` — this module never reads the DOM itself. `detected: false`
// is an honest answer when NEITHER method finds anything, not a claim
// that the page never paginates.
// ==================================================

const PAGE_NUMBER_PATTERN = /^\d{1,3}$/

/**
 * BUG FIX — the real SGS pagination cluster's current-page and page-size
 * numbers each live in their OWN `<input>`, immediately followed by their
 * label as plain text ("ของ 4" for the total page count, "หน้า" for the
 * page-size label) — never concatenated into one string like "1/4" or
 * "page 1 of 4". This is the ONE place that exact, confirmed shape is
 * parsed, and it is fully DOM-free/pure so it can be unit-tested against
 * a fixture matching the real layout without a browser.
 *
 * `fragments` is a linear, DOCUMENT-ORDER list of every non-empty text
 * node and every `<input>` element on the page, collected by content-
 * diagnostic.js's own DOM walk (that file duplicates this exact algorithm
 * inline, since its functions must stay closure-free/self-contained — see
 * that file's own header comment on why) as
 * `{type: 'text', value: string} | {type: 'input', value: string}`.
 *
 * The rule: a number-bearing input is read ONLY when it is the fragment
 * immediately preceding its own label text — the real page's own
 * confirmed shape ("current page input: 1" / "text immediately beside
 * it: ของ 4", and "page size input/value: 10" / "text: /หน้า"). An input
 * anywhere else on the page (e.g. a student's score cell) is never
 * mistaken for either, since it is never immediately adjacent to either
 * label text.
 */
export function parseRealPaginationFragments(fragments) {
  let totalPages = null
  let currentPage = null
  let totalStudentRows = null
  let pageSize = null

  for (let i = 0; i < fragments.length; i++) {
    const fragment = fragments[i]
    if (fragment.type !== 'text') continue

    const ofMatch = totalPages === null ? /ของ\s*(\d+)/.exec(fragment.value) : null
    if (ofMatch) {
      totalPages = Number(ofMatch[1])
      const prev = fragments[i - 1]
      if (prev && prev.type === 'input') {
        const parsed = Number(prev.value)
        if (Number.isFinite(parsed)) currentPage = parsed
      }
      continue
    }

    const itemsMatch = totalStudentRows === null ? /(\d+)\s*รายการ/.exec(fragment.value) : null
    if (itemsMatch) {
      totalStudentRows = Number(itemsMatch[1])
      continue
    }

    const pageSizeLabelMatch = pageSize === null ? /หน้า/.exec(fragment.value) : null
    if (pageSizeLabelMatch) {
      const prev = fragments[i - 1]
      if (prev && prev.type === 'input') {
        const parsed = Number(prev.value)
        if (Number.isFinite(parsed)) pageSize = parsed
      }
    }
  }

  return { currentPage, totalPages, totalStudentRows, pageSize }
}

/**
 * The live-confirmed detection path: trusts collectAllTableRowFacts's own
 * fragment-walk extraction (`paginationHints`, built by
 * parseRealPaginationFragments above) whenever it found BOTH a current
 * and a total page number. `totalStudentRows`/`pageSize` are reported
 * when that text/input was found, `null` when it wasn't — never guessed
 * from `visibleStudentRows × totalPages`, since a partial last page would
 * make that arithmetic silently wrong.
 */
function detectPaginationFromHints(hints, studentRowCount) {
  if (!hints || hints.currentPage === null || hints.currentPage === undefined) return null
  if (hints.totalPages === null || hints.totalPages === undefined) return null
  return {
    detected: true,
    currentPage: hints.currentPage,
    totalPages: hints.totalPages,
    visibleStudentRows: studentRowCount,
    totalStudentRows: hints.totalStudentRows ?? null,
    pageSize: hints.pageSize ?? null,
  }
}

/**
 * `hints` is collectAllTableRowFacts's `paginationHints` (optional — a
 * caller passing raw facts captured before this field existed, or a test
 * fixture, simply falls through to the old row-of-links detection below,
 * unchanged).
 */
export function detectPagination(tablesFacts, candidate, hints) {
  if (!candidate) {
    return { detected: false, currentPage: null, totalPages: null, visibleStudentRows: 0, totalStudentRows: null, pageSize: null }
  }

  const fromHints = detectPaginationFromHints(hints, candidate.studentRowCount)
  if (fromHints) return fromHints

  let pagerCells = null
  for (const tableFacts of tablesFacts) {
    const isGridTable = tableFacts.tableIndex === candidate.tableIndex
    for (let rowIndex = 0; rowIndex < tableFacts.rows.length; rowIndex++) {
      if (isGridTable && rowIndex >= candidate.run.startIndex && rowIndex < candidate.run.startIndex + candidate.run.length) {
        continue // never mistake a student data row for a pager row
      }
      const cells = tableFacts.rows[rowIndex]
      if (cells.some((c) => c.hasInput)) continue
      const nonEmpty = cells.filter((c) => (c.text ?? '').trim() !== '')
      if (nonEmpty.length < 2) continue
      const numeric = nonEmpty.filter((c) => PAGE_NUMBER_PATTERN.test(c.text.trim()))
      // Every non-empty cell in the row must look like a page number —
      // a row mixing page numbers with unrelated labels isn't a pager.
      if (numeric.length !== nonEmpty.length) continue
      pagerCells = numeric
      break
    }
    if (pagerCells) break
  }

  if (!pagerCells) {
    return {
      detected: false,
      currentPage: null,
      totalPages: null,
      visibleStudentRows: candidate.studentRowCount,
      totalStudentRows: null,
      pageSize: null,
    }
  }

  const numbers = pagerCells.map((c) => Number(c.text.trim()))
  const totalPages = numbers.length > 0 ? Math.max(...numbers) : null
  // ASP.NET GridView pagers conventionally render every OTHER page as a
  // link and the current page as plain text — so exactly one non-link
  // numeric cell is a strong signal for which page is current; more or
  // fewer than one is ambiguous and never guessed.
  const nonLinkCells = pagerCells.filter((c) => !c.hasLink)
  const currentPage = nonLinkCells.length === 1 ? Number(nonLinkCells[0].text.trim()) : null

  return { detected: true, currentPage, totalPages, visibleStudentRows: candidate.studentRowCount, totalStudentRows: null, pageSize: null }
}

// ==================================================
// Whole-table candidate evaluation and ranking — the SGS page has ~200
// tables; this picks the one that actually looks like the grade grid,
// never assumes "the first/largest/only top-level table."
// ==================================================

/**
 * @param {{tableIndex: number, selectorFingerprint: string, rows: {hasInput:boolean,text:string}[][]}} tableFacts
 */
export function evaluateStudentGridCandidate(tableFacts, options = {}) {
  const fingerprints = tableFacts.rows.map((cells) => buildRowFingerprint(cells))
  const run = findRepeatingRowRun(fingerprints, options)
  if (!run) return null

  const rowsInRun = tableFacts.rows.slice(run.startIndex, run.startIndex + run.length)
  const identifierColumns = classifyIdentifierColumns(rowsInRun)
  const { writableScoreColumns, activatableScoreColumns, derivedColumns } = classifyScoreColumns(
    tableFacts,
    run,
    identifierColumns,
  )

  const score =
    run.length * 10 +
    (identifierColumns.nameColumnIndex !== null ? 20 : 0) +
    (identifierColumns.numberColumnIndex !== null ? 10 : 0) +
    (identifierColumns.codeColumnIndex !== null ? 5 : 0) +
    writableScoreColumns.length * 3 +
    activatableScoreColumns.length * 1

  return {
    tableIndex: tableFacts.tableIndex,
    selectorFingerprint: tableFacts.selectorFingerprint,
    run,
    identifierColumns,
    writableScoreColumns,
    activatableScoreColumns,
    derivedColumns,
    studentRowCount: run.length,
    score,
  }
}

/** Ranks every table's candidate and returns the single best one, or
 * null if not even one table has a qualifying repeating row run. */
export function pickBestStudentGridCandidate(tablesFacts, options = {}) {
  const candidates = tablesFacts
    .map((tableFacts) => evaluateStudentGridCandidate(tableFacts, options))
    .filter((c) => c !== null)
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0]
}

export function computeGridConfidence(candidate) {
  if (!candidate) return 'none'
  const { identifierColumns, writableScoreColumns, studentRowCount } = candidate
  const hasCoreIdentifiers = identifierColumns.numberColumnIndex !== null && identifierColumns.nameColumnIndex !== null
  if (hasCoreIdentifiers && writableScoreColumns.length > 0 && studentRowCount >= 5) return 'high'
  if (hasCoreIdentifiers && writableScoreColumns.length > 0) return 'medium'
  return 'low'
}

export function buildGridWarnings(candidate) {
  if (!candidate) return ['ไม่พบโครงสร้างแถวนักเรียนที่ซ้ำกันในหน้านี้']
  const warnings = []
  if (candidate.identifierColumns.numberColumnIndex === null) warnings.push('ไม่พบคอลัมน์เลขที่')
  if (candidate.identifierColumns.codeColumnIndex === null) warnings.push('ไม่พบคอลัมน์รหัสนักเรียน')
  if (candidate.identifierColumns.nameColumnIndex === null) warnings.push('ไม่พบคอลัมน์ชื่อ-นามสกุล')
  const activatableScoreColumns = candidate.activatableScoreColumns ?? []
  if (candidate.writableScoreColumns.length === 0) {
    warnings.push(
      activatableScoreColumns.length > 0
        ? // LIVE DISCOVERY: a real score column merely gated by an
          // unchecked SGS header checkbox — never reported the same way
          // as a genuinely calculated/read-only column (item 3).
          `พบคอลัมน์คะแนนที่ยังไม่เปิดใช้งานใน SGS กรุณาติ๊กเปิดช่องคะแนนใน SGS ก่อน: ${activatableScoreColumns.map((c) => c.label).join(', ')}`
        : candidate.derivedColumns.length > 0
          ? 'พบคอลัมน์คะแนนแต่ทั้งหมดเป็นคอลัมน์คำนวณ/อ่านอย่างเดียว (เช่น รวมตลอดภาค, %, ปกติ) ไม่มีช่องที่กรอกได้จริง'
          : 'ไม่พบคอลัมน์คะแนนที่กรอกได้จริง',
    )
  }
  const missingMax = candidate.writableScoreColumns.filter((c) => c.maxScore === null)
  if (missingMax.length > 0) {
    warnings.push(`ไม่พบคะแนนเต็มในหัวคอลัมน์: ${missingMax.map((c) => c.label).join(', ')}`)
  }
  return warnings
}

/**
 * Anonymized per-row structural metadata for the winning candidate's
 * rows ONLY — no student names/codes, exactly the shape the spec asks
 * for. Used by the verbose/debug diagnostic, never by the compact one.
 */
export function buildAnonymizedRowDiagnostics(tableFacts, candidate) {
  if (!candidate || tableFacts.tableIndex !== candidate.tableIndex) return []
  const { startIndex, length } = candidate.run
  return tableFacts.rows.slice(startIndex, startIndex + length).map((cells, offset) => {
    const textCellIndexes = cells.map((c, idx) => (c.hasInput ? -1 : idx)).filter((idx) => idx !== -1)
    const inputCellIndexes = cells.map((c, idx) => (c.hasInput ? idx : -1)).filter((idx) => idx !== -1)
    return {
      rowIndex: startIndex + offset,
      cellCount: cells.length,
      textCellIndexes,
      inputCellIndexes,
      inputCount: inputCellIndexes.length,
      probableNumberCell: candidate.identifierColumns.numberColumnIndex,
      probableStudentCodeCell: candidate.identifierColumns.codeColumnIndex,
      probableNameCell: candidate.identifierColumns.nameColumnIndex,
    }
  })
}

// ==================================================
// Resolving the teacher's KrunameClass column choice to a REAL column
// (unchanged from Phase 2 — still valid once real columns are found by
// the logic above instead of the old broken header-keyword search).
// ==================================================

export function matchTargetColumnToRealColumns(targetColumnLabel, realColumns) {
  const normalize = (s) => s.replace(/\s+/g, '').toLowerCase()
  const target = normalize(targetColumnLabel)
  const matches = realColumns.filter((c) => normalize(c.label) === target)
  if (matches.length === 1) return { status: 'MATCHED', column: matches[0] }
  if (matches.length === 0) return { status: 'NOT_FOUND', column: null }
  return { status: 'AMBIGUOUS', column: null }
}

/** `sgsRowKey`s are `row-<offset>`, where offset is the student's
 * position WITHIN the accepted run (0 = the run's first row) — never
 * an absolute table row index, so the key stays meaningful regardless
 * of how many header/layout rows precede the run. */
export function buildSgsRowKey(rowOffset) {
  return `row-${rowOffset}`
}

export function sgsRowIndexFromKey(sgsRowKey) {
  const match = /^row-(\d+)$/.exec(sgsRowKey)
  return match ? Number(match[1]) : null
}

/**
 * BUG FIX (live SGS student mapping was never wired to the detected
 * student rows): the ONE place that turns the accepted student run's raw
 * cells into the exact shape matchStudentsToSgs (mapping.js) expects.
 * Uses ONLY the CONFIRMED numberColumnIndex/codeColumnIndex/
 * nameColumnIndex from the already-accepted grid candidate — never a
 * fresh table-wide text heuristic, and never any column other than the
 * three already confirmed. Every visible student row on the CURRENT SGS
 * page becomes exactly one candidate, keyed by its offset within the run
 * (buildSgsRowKey) so it round-trips with sgsRowIndexFromKey exactly like
 * every other single-column/single-cell read in this codebase.
 *
 * Was previously duplicated ad hoc inline in popup.js's runColumnPreview
 * — extracted here so BOTH runColumnPreview (the real preview) and
 * renderMappingResult (the "ตรวจสอบการจับคู่นักเรียน" dry-run button,
 * which had been left calling matchStudentsToSgs with a hardcoded empty
 * array ever since before this real detection existed) build the exact
 * same candidate list from the exact same source of truth.
 */
export function extractSgsStudentCandidates(tableFacts, run, identifierColumns) {
  const rowsInRun = tableFacts.rows.slice(run.startIndex, run.startIndex + run.length)
  return rowsInRun.map((cells, offset) => {
    const numberText = cells[identifierColumns.numberColumnIndex]?.text ?? ''
    const parsedNumber = numberText === '' ? NaN : Number(numberText)
    return {
      sgsRowKey: buildSgsRowKey(offset),
      sgsStudentNumber: Number.isFinite(parsedNumber) ? parsedNumber : null,
      sgsStudentId: cells[identifierColumns.codeColumnIndex]?.text || null,
      sgsFullNameRaw: cells[identifierColumns.nameColumnIndex]?.text || '',
    }
  })
}
