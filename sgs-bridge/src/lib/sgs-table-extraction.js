/**
 * Phase 2 — pure logic for interpreting an SGS score table's structure,
 * once content-diagnostic.js's inspectSgsScoreTable() has already
 * walked the live DOM and returned plain, already-extracted facts
 * (header text, which columns contain inputs, and each row's เลขที่/
 * รหัสนักเรียน/ชื่อ-นามสกุล text). Nothing in this file ever touches
 * `document` — that split (DOM-walking kept separate from the
 * interpretation logic) is the same one Phase 5's
 * content-diagnostic.js/diagnostic-report.js already established.
 *
 * `chrome.scripting.executeScript({ func })` serializes the function it
 * is given and re-runs it standalone in the page, with no access to
 * this module or anything else in its enclosing scope — so
 * content-diagnostic.js's injected functions necessarily duplicate a
 * MINIMAL version of identifyIdentifierColumns just to know which
 * columns to read text from while walking the DOM. That inline copy is
 * intentionally tiny (three keyword checks); everything else — parsing
 * a max score out of a header, building a stable columnKey, deciding
 * which columns are score columns, and matching the teacher's chosen
 * KrunameClass column to a REAL column on the page — lives here once,
 * imported normally by popup.js (an extension page, which unlike an
 * injected content script fully supports ES modules).
 */

const IDENTIFIER_PATTERNS = {
  number: /เลขที่|ลำดับ/,
  code: /รหัสนักเรียน|รหัสประจำตัว|เลขประจำตัว/,
  name: /ชื่อ.?สกุล|ชื่อ-นามสกุล|ชื่อนักเรียน|^ชื่อ$/,
}

/**
 * Given a table's header cell texts, guesses which column holds each
 * identifier field — never both a number AND fallback pattern for the
 * same header text; the FIRST header matching a pattern wins for that
 * field. A field that matches nothing is null, never guessed.
 */
export function identifyIdentifierColumns(headerTexts) {
  const find = (pattern) => {
    const index = headerTexts.findIndex((text) => pattern.test(text))
    return index === -1 ? null : index
  }
  return {
    numberColumnIndex: find(IDENTIFIER_PATTERNS.number),
    codeColumnIndex: find(IDENTIFIER_PATTERNS.code),
    nameColumnIndex: find(IDENTIFIER_PATTERNS.name),
  }
}

/**
 * Pulls a plausible max score out of a column header like "ช่อง 1 (15)",
 * "กลางภาค (10 คะแนน)", or "ปลายภาค เต็ม 30" — the LAST number found in
 * the header, since a leading number is more often a column index
 * ("ช่อง 1") than a max score. Returns null rather than a guess when no
 * number is present; nothing here ever invents a max score.
 */
export function parseMaxScoreFromHeader(headerText) {
  const matches = headerText.match(/\d+(\.\d+)?/g)
  if (!matches || matches.length === 0) return null
  const last = Number(matches[matches.length - 1])
  return Number.isFinite(last) && last > 0 ? last : null
}

/**
 * A stable, derived (never invented) identifier for a real SGS column —
 * built from its own header text plus its position, so re-scanning the
 * SAME page structure always yields the SAME key. Two columns that
 * happen to share header text (e.g. two blank-looking columns) still
 * get distinct keys because the column INDEX is always part of it.
 */
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
 * Every column that ISN'T one of the identifier columns and that
 * actually contains an input/select in its body cells (per
 * `columnsHaveInput`, gathered from the live DOM) is a score-column
 * CANDIDATE — never a column without a real input, since a column with
 * no input can't be filled at all. `maxScore` is whatever
 * parseMaxScoreFromHeader could derive, or null if it couldn't (the
 * caller decides whether to require it before allowing a fill).
 */
export function identifyScoreColumnCandidates(headerTexts, columnsHaveInput, identifierColumns) {
  const identifierIndexes = new Set(
    [identifierColumns.numberColumnIndex, identifierColumns.codeColumnIndex, identifierColumns.nameColumnIndex].filter(
      (i) => i !== null,
    ),
  )
  return headerTexts
    .map((headerText, columnIndex) => ({ headerText, columnIndex }))
    .filter(({ columnIndex }) => !identifierIndexes.has(columnIndex) && columnsHaveInput[columnIndex])
    .map(({ headerText, columnIndex }) => ({
      columnIndex,
      key: buildColumnKey(headerText, columnIndex),
      label: headerText.trim() || `คอลัมน์ ${columnIndex + 1}`,
      maxScore: parseMaxScoreFromHeader(headerText),
    }))
}

/**
 * Resolves the teacher's KrunameClass column choice (a LABEL, since the
 * bridge payload's own `targetColumn.key` is a placeholder from a
 * hardcoded example list — see sgs-export-service.ts's SGS_COLUMNS —
 * and was never guaranteed to match this specific page's real, derived
 * key) against the REAL columns just detected on the page. Exactly one
 * label match is MATCHED; zero or more than one is NOT_FOUND/AMBIGUOUS
 * and must never be silently guessed — the teacher picks manually
 * instead, the same "never silently map ambiguous students" rule this
 * whole bridge already applies to student matching.
 */
export function matchTargetColumnToRealColumns(targetColumnLabel, realColumns) {
  const normalize = (s) => s.replace(/\s+/g, '').toLowerCase()
  const target = normalize(targetColumnLabel)
  const matches = realColumns.filter((c) => normalize(c.label) === target)
  if (matches.length === 1) return { status: 'MATCHED', column: matches[0] }
  if (matches.length === 0) return { status: 'NOT_FOUND', column: null }
  return { status: 'AMBIGUOUS', column: null }
}

/** `sgsRowKey`s are always `row-<index>` — trivial, but centralized here
 * so nothing else in this codebase re-derives the format by hand. */
export function buildSgsRowKey(rowIndex) {
  return `row-${rowIndex}`
}

export function sgsRowIndexFromKey(sgsRowKey) {
  const match = /^row-(\d+)$/.exec(sgsRowKey)
  return match ? Number(match[1]) : null
}
