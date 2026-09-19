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
 * Every input column from the accepted run that ISN'T an identifier
 * column is a score column. `headerRowCells` is the row immediately
 * above the run (or null if the run starts at row 0, i.e. no header
 * row exists above it) — its cell at the SAME column index is read as
 * that column's header text, "tracing vertically" as the spec puts it.
 */
export function deriveScoreColumns(inputColumnIndexes, headerRowCells, identifierColumns) {
  const identifierSet = new Set(
    [identifierColumns.numberColumnIndex, identifierColumns.codeColumnIndex, identifierColumns.nameColumnIndex].filter(
      (i) => i !== null,
    ),
  )
  return inputColumnIndexes
    .filter((index) => !identifierSet.has(index))
    .map((index) => {
      const headerText = headerRowCells?.[index]?.text ?? ''
      if (isRejectedHeaderText(headerText)) return null
      return {
        columnIndex: index,
        key: buildColumnKey(headerText || `col-${index}`, index),
        label: headerText.trim() || `คอลัมน์ ${index + 1}`,
        maxScore: parseMaxScoreFromHeader(headerText),
      }
    })
    .filter((c) => c !== null)
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
  const inputColumnIndexes = fingerprints[run.startIndex].inputCellIndexes
  const headerRowIndex = run.startIndex > 0 ? run.startIndex - 1 : null
  const headerRowCells = headerRowIndex !== null ? tableFacts.rows[headerRowIndex] : null
  const scoreColumns = deriveScoreColumns(inputColumnIndexes, headerRowCells, identifierColumns)

  const score =
    run.length * 10 +
    (identifierColumns.nameColumnIndex !== null ? 20 : 0) +
    (identifierColumns.numberColumnIndex !== null ? 10 : 0) +
    (identifierColumns.codeColumnIndex !== null ? 5 : 0) +
    scoreColumns.length * 3

  return {
    tableIndex: tableFacts.tableIndex,
    selectorFingerprint: tableFacts.selectorFingerprint,
    run,
    identifierColumns,
    scoreColumns,
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
  const { identifierColumns, scoreColumns, studentRowCount } = candidate
  const hasCoreIdentifiers = identifierColumns.numberColumnIndex !== null && identifierColumns.nameColumnIndex !== null
  if (hasCoreIdentifiers && scoreColumns.length > 0 && studentRowCount >= 5) return 'high'
  if (hasCoreIdentifiers && scoreColumns.length > 0) return 'medium'
  return 'low'
}

export function buildGridWarnings(candidate) {
  if (!candidate) return ['ไม่พบโครงสร้างแถวนักเรียนที่ซ้ำกันในหน้านี้']
  const warnings = []
  if (candidate.identifierColumns.numberColumnIndex === null) warnings.push('ไม่พบคอลัมน์เลขที่')
  if (candidate.identifierColumns.codeColumnIndex === null) warnings.push('ไม่พบคอลัมน์รหัสนักเรียน')
  if (candidate.identifierColumns.nameColumnIndex === null) warnings.push('ไม่พบคอลัมน์ชื่อ-นามสกุล')
  if (candidate.scoreColumns.length === 0) warnings.push('ไม่พบคอลัมน์คะแนน')
  const missingMax = candidate.scoreColumns.filter((c) => c.maxScore === null)
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
