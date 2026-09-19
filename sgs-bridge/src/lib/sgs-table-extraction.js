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
 * every non-empty (non-input) cell's text found, ordered
 * furthest-from-data first, closest-to-data last.
 */
export function traceColumnHeaderTexts(tableFacts, columnIndex, runStartIndex, maxRowsUp = 6) {
  const texts = []
  for (let distance = maxRowsUp; distance >= 1; distance--) {
    const rowIndex = runStartIndex - distance
    if (rowIndex < 0) continue
    const cell = tableFacts.rows[rowIndex]?.[columnIndex]
    const text = cell && !cell.hasInput ? (cell.text ?? '').trim() : ''
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
 * (analyzeColumnEditability below); a column is only ever offered as a
 * fill target when BOTH agree it's safe.
 */
const DERIVED_COLUMN_LABEL_KEYWORDS = /รวม|ตลอดภาค|เฉลี่ย|เกรด|ผลการเรียน|สถานะ|ปกติ|^%$|เปอร์เซ็นต์|ร้อยละ|GPA/i

export function isDerivedColumnLabel(label) {
  return typeof label === 'string' && DERIVED_COLUMN_LABEL_KEYWORDS.test(label)
}

/**
 * Determines whether EVERY row in the run has exactly one genuinely
 * editable input in this column — the ONLY thing that makes a column a
 * safe fill target (item 5 of the spec: "each row has exactly one
 * writable input for that target column"). A column where some rows
 * have no input at all, or more than one, or the input is
 * disabled/readonly, or isn't a text/number field (e.g. a hidden field,
 * a checkbox, a calculated field rendered as a locked control), is
 * never writable — whatever its header says.
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
 * Splits every input column from the accepted run (excluding identifier
 * columns) into `writableScoreColumns` (a real, editable, per-row-
 * unique text/number input, with a header that doesn't look like a
 * calculated/status field) and `derivedColumns` (everything else —
 * รวมตลอดภาค, %, ปกติ, a disabled/readonly box, or any column this
 * can't confidently call safe), each tagged with WHY it was excluded.
 * `derivedColumns` is reporting only — see popup.js's
 * gridMeetsFillRequirements for the actual write-time gate.
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
  const derivedColumns = []

  for (const columnIndex of candidateIndexes) {
    const headerTexts = traceColumnHeaderTexts(tableFacts, columnIndex, run.startIndex)
    const { label, maxScore } = deriveScoreColumnHeader(headerTexts)
    if (isRejectedHeaderText(label ?? '')) continue // an academic year/menu/login label — not a real column at all

    const resolvedLabel = label ?? `คอลัมน์ ${columnIndex + 1}`
    const editability = analyzeColumnEditability(columnIndex, rowsInRun)
    const derivedByLabel = isDerivedColumnLabel(label)

    if (editability.hasEditableInput && !derivedByLabel) {
      writableScoreColumns.push({
        columnIndex,
        key: buildColumnKey(resolvedLabel, columnIndex),
        label: resolvedLabel,
        maxScore,
        inputPattern: editability.inputType ?? 'text',
        inputCount: editability.inputCount,
      })
    } else {
      const reason = derivedByLabel
        ? 'label_indicates_calculated_or_status'
        : editability.disabled
          ? 'disabled_input'
          : editability.readonly
            ? 'readonly_input'
            : editability.inputCount === 0
              ? 'no_input'
              : 'not_uniformly_editable'
      derivedColumns.push({ columnIndex, label: resolvedLabel, reason })
    }
  }

  return { writableScoreColumns, derivedColumns }
}

// ==================================================
// Pagination — best-effort, never blocking. Looks for a "pager row"
// elsewhere on the page (never inside the accepted student run itself):
// a row with no inputs where every non-empty cell is a short page-
// number-looking string. Reports what it found rather than guessing —
// `detected: false` is an honest answer when no such row exists, not a
// claim that the page never paginates.
// ==================================================

const PAGE_NUMBER_PATTERN = /^\d{1,3}$/

export function detectPagination(tablesFacts, candidate) {
  if (!candidate) {
    return { detected: false, currentPage: null, totalPages: null, visibleStudentRows: 0 }
  }

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
    return { detected: false, currentPage: null, totalPages: null, visibleStudentRows: candidate.studentRowCount }
  }

  const numbers = pagerCells.map((c) => Number(c.text.trim()))
  const totalPages = numbers.length > 0 ? Math.max(...numbers) : null
  // ASP.NET GridView pagers conventionally render every OTHER page as a
  // link and the current page as plain text — so exactly one non-link
  // numeric cell is a strong signal for which page is current; more or
  // fewer than one is ambiguous and never guessed.
  const nonLinkCells = pagerCells.filter((c) => !c.hasLink)
  const currentPage = nonLinkCells.length === 1 ? Number(nonLinkCells[0].text.trim()) : null

  return { detected: true, currentPage, totalPages, visibleStudentRows: candidate.studentRowCount }
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
  const { writableScoreColumns, derivedColumns } = classifyScoreColumns(tableFacts, run, identifierColumns)

  const score =
    run.length * 10 +
    (identifierColumns.nameColumnIndex !== null ? 20 : 0) +
    (identifierColumns.numberColumnIndex !== null ? 10 : 0) +
    (identifierColumns.codeColumnIndex !== null ? 5 : 0) +
    writableScoreColumns.length * 3

  return {
    tableIndex: tableFacts.tableIndex,
    selectorFingerprint: tableFacts.selectorFingerprint,
    run,
    identifierColumns,
    writableScoreColumns,
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
  if (candidate.writableScoreColumns.length === 0) {
    warnings.push(
      candidate.derivedColumns.length > 0
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
