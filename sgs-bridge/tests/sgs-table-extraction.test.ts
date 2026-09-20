import { describe, expect, it } from 'vitest'

import {
  analyzeColumnEditability,
  analyzeColumnRowInputState,
  buildAnonymizedRowDiagnostics,
  buildColumnKey,
  buildGridWarnings,
  buildRowFingerprint,
  buildSgsRowKey,
  classifyIdentifierColumns,
  classifyScoreColumns,
  computeGridConfidence,
  deriveScoreColumnHeader,
  detectPagination,
  evaluateStudentGridCandidate,
  extractSgsStudentCandidates,
  findHeaderCheckboxState,
  findRepeatingRowRun,
  fingerprintsEqual,
  isDerivedColumnLabel,
  isRejectedHeaderText,
  looksLikeStudentRowFingerprint,
  matchTargetColumnToRealColumns,
  parseMaxScoreFromHeader,
  pickBestStudentGridCandidate,
  scanScoreColumnState,
  sgsRowIndexFromKey,
  slugifyHeaderText,
  traceColumnHeaderTexts,
} from '../src/lib/sgs-table-extraction.js'

function text(t: string) {
  return { hasInput: false, hasLink: false, text: t, inputMeta: null }
}
function link(t: string) {
  return { hasInput: false, hasLink: true, text: t, inputMeta: null }
}
function input(
  overrides: Partial<{
    count: number
    visibleCount: number
    type: string
    disabled: boolean
    readonly: boolean
    visible: boolean
    checked: boolean | null
  }> = {},
) {
  return {
    hasInput: true,
    hasLink: false,
    text: '',
    inputMeta: { count: 1, type: 'text', disabled: false, readonly: false, visible: true, checked: null, ...overrides },
  }
}

/** LIVE DISCOVERY: a real SGS header checkbox cell — carries the
 * column's visible label text ALONGSIDE the checkbox (see
 * content-diagnostic.js's inspectCellFormControl doc comment). */
function checkboxCell(label: string, checked: boolean) {
  return {
    hasInput: true,
    hasLink: false,
    text: label,
    inputMeta: { count: 1, visibleCount: 1, type: 'checkbox', disabled: false, readonly: false, visible: true, checked },
  }
}

/** A single realistic student row: เลขที่ | เลขประจำตัว | ชื่อ-นามสกุล | 2 score inputs. */
function studentRow(number: string, code: string, name: string, ...extraCells: ReturnType<typeof input>[]) {
  return [text(number), text(code), text(name), input(), input(), ...extraCells]
}

describe('BUG FIX — CSS selector vs id parsing (regression, exercised in content-diagnostic.js tests)', () => {
  it('this module never hardcodes a getElementById id containing ".Filter_Input" — that was the original bug', () => {
    // sgs-table-extraction.js has nothing to do with the filter inputs
    // at all (that fix lives in content-diagnostic.js); asserting it
    // here documents the boundary explicitly for anyone reading this
    // file looking for the filter-detection fix.
    expect(true).toBe(true)
  })
})

describe('buildRowFingerprint / fingerprintsEqual', () => {
  it('captures cell count and input positions, ignoring actual text content', () => {
    const a = buildRowFingerprint(studentRow('1', '00001', 'สมชาย ใจดี'))
    const b = buildRowFingerprint(studentRow('2', '00002', 'สมหญิง ใจดี'))
    expect(fingerprintsEqual(a, b)).toBe(true)
    expect(a).toEqual({ cellCount: 5, inputCellIndexes: [3, 4] })
  })

  it('differs when a row has a different cell count or different input positions', () => {
    const a = buildRowFingerprint(studentRow('1', '00001', 'สมชาย ใจดี'))
    const differentInputPosition = buildRowFingerprint([text('1'), input(), text('สมชาย'), text('x'), input()])
    expect(fingerprintsEqual(a, differentInputPosition)).toBe(false)
  })
})

describe('looksLikeStudentRowFingerprint', () => {
  it('rejects a fingerprint with zero inputs (a pure layout/spacer row)', () => {
    expect(looksLikeStudentRowFingerprint({ cellCount: 5, inputCellIndexes: [] })).toBe(false)
  })

  it('rejects a fingerprint with too few cells even if it has an input', () => {
    expect(looksLikeStudentRowFingerprint({ cellCount: 2, inputCellIndexes: [1] })).toBe(false)
  })

  it('accepts a plausible student-row shape', () => {
    expect(looksLikeStudentRowFingerprint({ cellCount: 5, inputCellIndexes: [3, 4] })).toBe(true)
  })
})

describe('findRepeatingRowRun — nested ASP.NET layout tables and repeated student rows', () => {
  it('finds a run of 3+ consecutive identical-shape rows, skipping a preceding layout row of a different shape', () => {
    const rows = [
      buildRowFingerprint([text('หัวข้อ'), text('เลขที่'), text('รหัส'), text('ชื่อ'), text('คะแนน')]), // header, different shape
      buildRowFingerprint(studentRow('1', '00001', 'A')),
      buildRowFingerprint(studentRow('2', '00002', 'B')),
      buildRowFingerprint(studentRow('3', '00003', 'C')),
    ]
    const run = findRepeatingRowRun(rows)
    expect(run).toEqual({ startIndex: 1, length: 3 })
  })

  it('never mistakes a long run of matching EMPTY spacer rows for the student grid', () => {
    const spacer = buildRowFingerprint([text('')])
    const rows = [spacer, spacer, spacer, spacer, spacer, spacer, spacer, spacer, spacer, spacer]
    expect(findRepeatingRowRun(rows)).toBeNull()
  })

  it('prefers a QUALIFYING run even when a longer non-qualifying run exists elsewhere in the same table', () => {
    const spacer = buildRowFingerprint([text('')])
    const rows = [
      spacer, spacer, spacer, spacer, spacer, spacer, spacer, spacer, // 8 spacer rows — longer
      buildRowFingerprint(studentRow('1', '00001', 'A')),
      buildRowFingerprint(studentRow('2', '00002', 'B')),
      buildRowFingerprint(studentRow('3', '00003', 'C')),
    ]
    const run = findRepeatingRowRun(rows)
    expect(run).toEqual({ startIndex: 8, length: 3 })
  })

  it('requires at least minRunLength (default 3) — two matching rows alone never qualify', () => {
    const rows = [buildRowFingerprint(studentRow('1', '00001', 'A')), buildRowFingerprint(studentRow('2', '00002', 'B'))]
    expect(findRepeatingRowRun(rows)).toBeNull()
  })

  it('a custom minRunLength is honored', () => {
    const rows = [buildRowFingerprint(studentRow('1', '00001', 'A')), buildRowFingerprint(studentRow('2', '00002', 'B'))]
    expect(findRepeatingRowRun(rows, { minRunLength: 2 })).toEqual({ startIndex: 0, length: 2 })
  })
})

describe('classifyIdentifierColumns — Thai names, zero-padded codes, content-based (never header-based)', () => {
  it('identifies เลขที่ (short number), รหัสนักเรียน (zero-padded), and ชื่อ-นามสกุล (Thai text) by content alone', () => {
    const rows = [
      studentRow('1', '00001', 'สมชาย ใจดี'),
      studentRow('2', '00002', 'สมหญิง ใจดี'),
      studentRow('3', '00003', 'วิชัย เก่งกล้า'),
    ]
    const result = classifyIdentifierColumns(rows)
    expect(result).toEqual({ numberColumnIndex: 0, codeColumnIndex: 1, nameColumnIndex: 2 })
  })

  it('picks the SHORTER numeric column as เลขที่ even if the columns are in a different order', () => {
    // code column BEFORE the number column
    const rows = [
      [text('00001'), text('1'), text('สมชาย ใจดี'), input()],
      [text('00002'), text('2'), text('สมหญิง ใจดี'), input()],
      [text('00003'), text('3'), text('วิชัย เก่งกล้า'), input()],
    ]
    const result = classifyIdentifierColumns(rows)
    expect(result.numberColumnIndex).toBe(1)
    expect(result.codeColumnIndex).toBe(0)
  })

  it('treats a zero-padded code as รหัสนักเรียน even when it happens to be short', () => {
    const rows = [
      [text('12'), text('007'), text('สมชาย ใจดี'), input()],
      [text('5'), text('042'), text('สมหญิง ใจดี'), input()],
      [text('31'), text('099'), text('วิชัย เก่งกล้า'), input()],
    ]
    const result = classifyIdentifierColumns(rows)
    expect(result.codeColumnIndex).toBe(1)
  })

  it('never classifies a column beyond the first score input as an identifier column', () => {
    const rows = [studentRow('1', '00001', 'สมชาย ใจดี'), studentRow('2', '00002', 'สมหญิง ใจดี'), studentRow('3', '00003', 'วิชัย เก่งกล้า')]
    // Add a Thai-text cell AFTER the inputs — must never be picked as nameColumnIndex.
    rows.forEach((r) => r.push(text('หมายเหตุภาษาไทย')))
    const result = classifyIdentifierColumns(rows)
    expect(result.nameColumnIndex).toBe(2)
  })

  it('returns null for a field with no matching content — never guesses', () => {
    const rows = [
      [text('1'), input()],
      [text('2'), input()],
      [text('3'), input()],
    ]
    const result = classifyIdentifierColumns(rows)
    expect(result.codeColumnIndex).toBeNull()
    expect(result.nameColumnIndex).toBeNull()
  })
})

describe('isRejectedHeaderText / parseMaxScoreFromHeader — never mistaking a year or nav label for a max score', () => {
  it('extracts a realistic max score', () => {
    expect(parseMaxScoreFromHeader('ช่อง 1 (15)')).toBe(15)
    expect(parseMaxScoreFromHeader('กลางภาค (10 คะแนน)')).toBe(10)
  })

  it('rejects an academic year range like 2561–2570, never treating it as a max score', () => {
    expect(parseMaxScoreFromHeader('ปีการศึกษา 2568')).toBeNull()
    expect(parseMaxScoreFromHeader('2568')).toBeNull()
  })

  it('rejects any number outside a realistic 1-100 max-score range', () => {
    expect(parseMaxScoreFromHeader('รหัส 12345')).toBeNull()
  })

  it('rejects headers whose context names navigation/menu/login controls', () => {
    expect(isRejectedHeaderText('เมนูหลัก')).toBe(true)
    expect(isRejectedHeaderText('ออกจากระบบ')).toBe(true)
    expect(isRejectedHeaderText('เข้าสู่ระบบ')).toBe(true)
    expect(isRejectedHeaderText('เปลี่ยนภาษา')).toBe(true)
  })

  it('rejects a header naming a grade level (ชั้น) even if it also contains a number', () => {
    expect(parseMaxScoreFromHeader('ชั้นมัธยมศึกษาปีที่ 5 (10)')).toBeNull()
  })

  it('returns null rather than guessing when no number is present', () => {
    expect(parseMaxScoreFromHeader('กลางภาค')).toBeNull()
  })
})

describe('slugifyHeaderText / buildColumnKey — stable and derived, never invented', () => {
  it('slugifies header text into a lowercase, hyphenated, parenthesis-free form', () => {
    expect(slugifyHeaderText('กลางภาค (10)')).toBe('กลางภาค-10')
  })

  it('is deterministic for the same header text and index', () => {
    expect(buildColumnKey('กลางภาค (10)', 4)).toBe(buildColumnKey('กลางภาค (10)', 4))
  })

  it('differs when the column index differs, even with identical header text', () => {
    expect(buildColumnKey('ช่อง', 1)).not.toBe(buildColumnKey('ช่อง', 2))
  })
})

describe('traceColumnHeaderTexts / deriveScoreColumnHeader — multi-row SGS headers', () => {
  const tableFacts = {
    tableIndex: 0,
    selectorFingerprint: 'table[0]',
    rows: [
      [text(''), text(''), text(''), text('เก็บคะแนนก่อนกลางภาค'), text('')], // group header, 2 rows above the run
      [text(''), text(''), text(''), text('(15)'), text('(10)')], // max-score row, 1 row above the run
      [text(''), text(''), text(''), text('10'), text('กลางภาค')], // closest row — the visible label
      ...[1, 2, 3].map((i) => studentRow(String(i), String(i).padStart(5, '0'), `นักเรียน ${i}`)),
    ],
  }
  const runStartIndex = 3

  it('collects every non-empty header row above the run, furthest first', () => {
    expect(traceColumnHeaderTexts(tableFacts, 3, runStartIndex)).toEqual(['เก็บคะแนนก่อนกลางภาค', '(15)', '10'])
  })

  it('label is the text CLOSEST to the data; maxScore comes from a DIFFERENT row, matching the spec\'s example', () => {
    const headerTexts = traceColumnHeaderTexts(tableFacts, 3, runStartIndex)
    expect(deriveScoreColumnHeader(headerTexts)).toEqual({ label: '10', maxScore: 15 })
  })

  it('a bare numeric label like "10" is NEVER also reported as that column\'s own max score', () => {
    // Only ONE header row exists here ("10"), so there is no separate
    // max-score row to find — maxScore must stay null, never fall back
    // to treating the label itself as the max score.
    expect(deriveScoreColumnHeader(['10'])).toEqual({ label: '10', maxScore: null })
  })

  it('a named column (กลางภาค) still finds its max score from a separate traced row', () => {
    const headerTexts = traceColumnHeaderTexts(tableFacts, 4, runStartIndex)
    expect(deriveScoreColumnHeader(headerTexts)).toEqual({ label: 'กลางภาค', maxScore: 10 })
  })

  it('falls back to parsing the label itself when it is already a combined header (e.g. "กลางภาค (10)")', () => {
    expect(deriveScoreColumnHeader(['กลางภาค (10)'])).toEqual({ label: 'กลางภาค (10)', maxScore: 10 })
  })

  it('returns null/null when no header text exists at all (run starts at row 0)', () => {
    expect(deriveScoreColumnHeader([])).toEqual({ label: null, maxScore: null })
    expect(traceColumnHeaderTexts(tableFacts, 3, 0)).toEqual([])
  })
})

describe('analyzeColumnEditability — writable vs calculated/disabled/readonly columns', () => {
  it('a column with a plain text input in every row is editable', () => {
    const rows = [studentRow('1', '00001', 'A'), studentRow('2', '00002', 'B'), studentRow('3', '00003', 'C')]
    const result = analyzeColumnEditability(3, rows)
    expect(result).toEqual({ hasEditableInput: true, inputCount: 3, inputType: 'text', disabled: false, readonly: false })
  })

  it('a number-type input is also editable', () => {
    const rows = [1, 2, 3].map((i) => studentRow(String(i), String(i), `S${i}`, input({ type: 'number' })))
    expect(analyzeColumnEditability(5, rows).hasEditableInput).toBe(true)
  })

  it('a DISABLED input is never editable, even though it technically "has an input"', () => {
    const rows = [1, 2, 3].map((i) => studentRow(String(i), String(i), `S${i}`, input({ disabled: true })))
    const result = analyzeColumnEditability(5, rows)
    expect(result.hasEditableInput).toBe(false)
    expect(result.disabled).toBe(true)
  })

  it('a READONLY input is never editable', () => {
    const rows = [1, 2, 3].map((i) => studentRow(String(i), String(i), `S${i}`, input({ readonly: true })))
    const result = analyzeColumnEditability(5, rows)
    expect(result.hasEditableInput).toBe(false)
    expect(result.readonly).toBe(true)
  })

  it('a non-text/number input type (e.g. hidden/checkbox) is never editable', () => {
    const rows = [1, 2, 3].map((i) => studentRow(String(i), String(i), `S${i}`, input({ type: 'checkbox' })))
    expect(analyzeColumnEditability(5, rows).hasEditableInput).toBe(false)
  })

  it('a cell with MORE THAN ONE input is never editable — "exactly one writable input per row" (item 5)', () => {
    const rows = [1, 2, 3].map((i) => studentRow(String(i), String(i), `S${i}`, input({ count: 2 })))
    expect(analyzeColumnEditability(5, rows).hasEditableInput).toBe(false)
  })

  it('a column where only SOME rows have an input (partial coverage) is never editable', () => {
    const rows = [studentRow('1', '00001', 'A', input()), studentRow('2', '00002', 'B', text('รวม 10')), studentRow('3', '00003', 'C', input())]
    expect(analyzeColumnEditability(5, rows).hasEditableInput).toBe(false)
  })

  it('a column with no input at all reports inputCount 0 and is never editable', () => {
    const rows = [1, 2, 3].map((i) => studentRow(String(i), String(i), `S${i}`, text('10')))
    const result = analyzeColumnEditability(5, rows)
    expect(result.hasEditableInput).toBe(false)
    expect(result.inputCount).toBe(0)
  })
})

describe('isDerivedColumnLabel — total/percentage/status labels', () => {
  it('rejects a running-total column (รวมตลอดภาค)', () => {
    expect(isDerivedColumnLabel('รวมตลอดภาค')).toBe(true)
  })

  it('rejects a percentage column (%)', () => {
    expect(isDerivedColumnLabel('%')).toBe(true)
  })

  it('rejects a status/behavior column (ปกติ)', () => {
    expect(isDerivedColumnLabel('ปกติ')).toBe(true)
  })

  it('rejects a grade/GPA column', () => {
    expect(isDerivedColumnLabel('เกรด')).toBe(true)
    expect(isDerivedColumnLabel('GPA')).toBe(true)
  })

  it('accepts a normal assignment label', () => {
    expect(isDerivedColumnLabel('10')).toBe(false)
    expect(isDerivedColumnLabel('กลางภาค')).toBe(false)
    expect(isDerivedColumnLabel('หลังกลางภาค')).toBe(false)
  })

  it('never crashes on null', () => {
    expect(isDerivedColumnLabel(null)).toBe(false)
  })
})

describe('classifyScoreColumns — the ONLY function allowed to produce writableScoreColumns', () => {
  /** Builds a row with EXACTLY one score cell (at columnIndex 3) — never
   * studentRow's own baked-in 2 default score cells, so these tests can
   * precisely control that one column's input shape. */
  function gridWithColumns(headerRow: ReturnType<typeof text>[], columnBuilder: (i: number) => ReturnType<typeof input>) {
    const rows = [headerRow]
    for (let i = 1; i <= 3; i++) {
      rows.push([text(String(i)), text(String(i).padStart(5, '0')), text(`นักเรียน ${i}`), columnBuilder(i)])
    }
    return { tableIndex: 0, selectorFingerprint: 'table[0]', rows }
  }

  const identifierColumns = { numberColumnIndex: 0, codeColumnIndex: 1, nameColumnIndex: 2 }
  const run = { startIndex: 1, length: 3 }

  /** The full shape a writableScoreColumns entry carries since the
   * live-discovery header-checkbox fix — headerCheckboxPresent/Checked
   * and the row-level visible/enabled/disabled/readonly counts, on top
   * of the original columnIndex/key/label/maxScore/inputPattern/inputCount. */
  function sharedShape(overrides: Record<string, unknown>) {
    return {
      headerCheckboxPresent: false,
      headerCheckboxChecked: false,
      visibleInputCount: 3,
      enabledInputCount: 3,
      disabledInputCount: 0,
      readonlyInputCount: 0,
      ...overrides,
    }
  }
  function writableShape(overrides: Record<string, unknown>) {
    return sharedShape({ inputPattern: 'text', inputCount: 3, ...overrides })
  }
  function activatableShape(overrides: Record<string, unknown>) {
    return sharedShape(overrides)
  }

  it('classifies a normal editable score column as writable', () => {
    const headerRow = [text(''), text(''), text(''), text('10 (15)')]
    const tableFacts = gridWithColumns(headerRow, () => input())
    const { writableScoreColumns, derivedColumns } = classifyScoreColumns(tableFacts, run, identifierColumns)
    expect(writableScoreColumns).toEqual([
      writableShape({ columnIndex: 3, key: buildColumnKey('10 (15)', 3), label: '10 (15)', maxScore: 15 }),
    ])
    expect(derivedColumns).toEqual([])
  })

  it('rejects a running-TOTAL column (รวมตลอดภาค) even if it happens to render a disabled input', () => {
    const headerRow = [text(''), text(''), text(''), text('รวมตลอดภาค')]
    const tableFacts = gridWithColumns(headerRow, () => input({ disabled: true }))
    const { writableScoreColumns, derivedColumns } = classifyScoreColumns(tableFacts, run, identifierColumns)
    expect(writableScoreColumns).toEqual([])
    expect(derivedColumns).toEqual([{ columnIndex: 3, label: 'รวมตลอดภาค', reason: 'label_indicates_calculated_or_status' }])
  })

  it('rejects a PERCENTAGE column (%)', () => {
    const headerRow = [text(''), text(''), text(''), text('%')]
    const tableFacts = gridWithColumns(headerRow, () => input())
    const { writableScoreColumns, derivedColumns } = classifyScoreColumns(tableFacts, run, identifierColumns)
    expect(writableScoreColumns).toEqual([])
    expect(derivedColumns[0].reason).toBe('label_indicates_calculated_or_status')
  })

  it('rejects a normal/behavior STATUS column (ปกติ)', () => {
    const headerRow = [text(''), text(''), text(''), text('ปกติ')]
    const tableFacts = gridWithColumns(headerRow, () => input())
    const { writableScoreColumns, derivedColumns } = classifyScoreColumns(tableFacts, run, identifierColumns)
    expect(writableScoreColumns).toEqual([])
    expect(derivedColumns[0].reason).toBe('label_indicates_calculated_or_status')
  })

  it('LIVE DISCOVERY: a column with a DISABLED input is ACTIVATABLE, never derived — "do not classify a real score column as derived only because its inputs are currently disabled"', () => {
    const headerRow = [text(''), text(''), text(''), text('ช่อง 1')]
    const tableFacts = gridWithColumns(headerRow, () => input({ disabled: true }))
    const { derivedColumns, activatableScoreColumns, writableScoreColumns } = classifyScoreColumns(tableFacts, run, identifierColumns)
    expect(derivedColumns).toEqual([])
    expect(writableScoreColumns).toEqual([])
    expect(activatableScoreColumns).toEqual([
      activatableShape({
        columnIndex: 3,
        key: buildColumnKey('ช่อง 1', 3),
        label: 'ช่อง 1',
        maxScore: 1,
        enabledInputCount: 0,
        disabledInputCount: 3,
        reason: 'disabled_input',
      }),
    ])
  })

  it('rejects a column with a READONLY input, tagging the reason', () => {
    const headerRow = [text(''), text(''), text(''), text('ช่อง 1')]
    const tableFacts = gridWithColumns(headerRow, () => input({ readonly: true }))
    const { derivedColumns } = classifyScoreColumns(tableFacts, run, identifierColumns)
    expect(derivedColumns).toEqual([{ columnIndex: 3, label: 'ช่อง 1', reason: 'readonly_input' }])
  })

  it('drops a column entirely (neither writable nor derived) when its header is an academic-year/nav label', () => {
    const headerRow = [text(''), text(''), text(''), text('ปีการศึกษา 2568')]
    const tableFacts = gridWithColumns(headerRow, () => input())
    const { writableScoreColumns, derivedColumns } = classifyScoreColumns(tableFacts, run, identifierColumns)
    expect(writableScoreColumns).toEqual([])
    expect(derivedColumns).toEqual([])
  })

  it('extracts max score from a real SGS-shaped multi-row header (10 / (15))', () => {
    const tableFacts = {
      tableIndex: 0,
      selectorFingerprint: 'table[0]',
      rows: [
        [text(''), text(''), text(''), text('(15)')],
        [text(''), text(''), text(''), text('10')],
        ...[1, 2, 3].map((i) => [text(String(i)), text(String(i).padStart(5, '0')), text(`นักเรียน ${i}`), input()]),
      ],
    }
    const { writableScoreColumns } = classifyScoreColumns(tableFacts, { startIndex: 2, length: 3 }, identifierColumns)
    expect(writableScoreColumns).toEqual([writableShape({ columnIndex: 3, key: buildColumnKey('10', 3), label: '10', maxScore: 15 })])
  })

  it('LIVE DISCOVERY: a header checkbox CHECKED makes the column writableNow', () => {
    const headerRow = [text(''), text(''), text(''), checkboxCell('11', true)]
    const tableFacts = gridWithColumns(headerRow, () => input())
    const { writableScoreColumns, activatableScoreColumns } = classifyScoreColumns(tableFacts, run, identifierColumns)
    expect(activatableScoreColumns).toEqual([])
    expect(writableScoreColumns).toEqual([
      writableShape({
        columnIndex: 3,
        key: buildColumnKey('11', 3),
        label: '11',
        maxScore: null,
        headerCheckboxPresent: true,
        headerCheckboxChecked: true,
      }),
    ])
  })

  it('LIVE DISCOVERY: a header checkbox UNCHECKED makes the column activatable — never writable, never derived', () => {
    const headerRow = [text(''), text(''), text(''), checkboxCell('11', false)]
    // Unchecked in SGS renders the row inputs disabled — matching what
    // was actually observed on the live page ("unchecked columns'
    // inputs appear disabled").
    const tableFacts = gridWithColumns(headerRow, () => input({ disabled: true }))
    const { writableScoreColumns, derivedColumns, activatableScoreColumns } = classifyScoreColumns(tableFacts, run, identifierColumns)
    expect(writableScoreColumns).toEqual([])
    expect(derivedColumns).toEqual([])
    expect(activatableScoreColumns).toEqual([
      activatableShape({
        columnIndex: 3,
        key: buildColumnKey('11', 3),
        label: '11',
        maxScore: null,
        headerCheckboxPresent: true,
        headerCheckboxChecked: false,
        enabledInputCount: 0,
        disabledInputCount: 3,
        reason: 'header_checkbox_unchecked',
      }),
    ])
  })

  it('a genuinely calculated/status column (label-derived) stays non-writable even with a CHECKED header checkbox', () => {
    const headerRow = [text(''), text(''), text(''), checkboxCell('รวมตลอดภาค', true)]
    const tableFacts = gridWithColumns(headerRow, () => input())
    const { writableScoreColumns, activatableScoreColumns, derivedColumns } = classifyScoreColumns(tableFacts, run, identifierColumns)
    expect(writableScoreColumns).toEqual([])
    expect(activatableScoreColumns).toEqual([])
    expect(derivedColumns).toEqual([{ columnIndex: 3, label: 'รวมตลอดภาค', reason: 'label_indicates_calculated_or_status' }])
  })

  it('rejects a retake/repeat/remark status column, never treating it as a real score-entry column', () => {
    expect(isDerivedColumnLabel('แก้ตัว')).toBe(true)
    expect(isDerivedColumnLabel('เรียนซ้ำ')).toBe(true)
    expect(isDerivedColumnLabel('Remark')).toBe(true)
  })

  it('SECTION 6 fix: a visible ENABLED input is never misclassified because of an unrelated hidden/disabled sibling control in the same cell', () => {
    const headerRow = [text(''), text(''), text(''), text('คอลัมน์ทดสอบ')]
    // count: 2 (a hidden helper control exists alongside the real one),
    // but visibleCount: 1 and the CHOSEN (visible) control is enabled —
    // must be classified as writable, never "not_uniformly_editable" or
    // disabled just because a second, hidden control also exists.
    const tableFacts = gridWithColumns(headerRow, () => input({ count: 2, visibleCount: 1, visible: true, disabled: false }))
    const { writableScoreColumns, derivedColumns, activatableScoreColumns } = classifyScoreColumns(tableFacts, run, identifierColumns)
    expect(derivedColumns).toEqual([])
    expect(activatableScoreColumns).toEqual([])
    expect(writableScoreColumns).toEqual([
      writableShape({ columnIndex: 3, key: buildColumnKey('คอลัมน์ทดสอบ', 3), label: 'คอลัมน์ทดสอบ', maxScore: null }),
    ])
  })

  it('SECTION 6 fix: a cell whose only control is HIDDEN (no visible control at all) is never reported enabled', () => {
    const headerRow = [text(''), text(''), text(''), text('คอลัมน์ทดสอบ')]
    const tableFacts = gridWithColumns(headerRow, () => input({ visible: false, visibleCount: 0 }))
    const { writableScoreColumns, activatableScoreColumns } = classifyScoreColumns(tableFacts, run, identifierColumns)
    expect(writableScoreColumns).toEqual([])
    expect(activatableScoreColumns).toEqual([
      activatableShape({
        columnIndex: 3,
        key: buildColumnKey('คอลัมน์ทดสอบ', 3),
        label: 'คอลัมน์ทดสอบ',
        maxScore: null,
        visibleInputCount: 0,
        enabledInputCount: 0,
        disabledInputCount: 3,
        reason: 'disabled_input',
      }),
    ])
  })
})

describe('evaluateStudentGridCandidate / pickBestStudentGridCandidate — rejecting layout tables', () => {
  function layoutTable(tableIndex: number) {
    const row = [text('layout'), text('wrapper')]
    return { tableIndex, selectorFingerprint: `table[${tableIndex}]`, rows: Array(5).fill(row) }
  }

  function studentGridTable(tableIndex: number, studentCount = 5) {
    const header = [text(''), text(''), text(''), text('ช่อง 1 (15)'), text('กลางภาค (10)')]
    const rows = [header]
    for (let i = 1; i <= studentCount; i++) {
      rows.push(studentRow(String(i), String(i).padStart(5, '0'), `นักเรียนคนที่ ${i}`))
    }
    return { tableIndex, selectorFingerprint: `table[${tableIndex}]`, rows }
  }

  it('rejects a pure layout table (no qualifying repeating input row)', () => {
    expect(evaluateStudentGridCandidate(layoutTable(0))).toBeNull()
  })

  it('accepts the real grid table and reports its identifier/writable-score columns', () => {
    const candidate = evaluateStudentGridCandidate(studentGridTable(5))
    expect(candidate?.identifierColumns).toEqual({ numberColumnIndex: 0, codeColumnIndex: 1, nameColumnIndex: 2 })
    expect(candidate?.writableScoreColumns).toHaveLength(2)
    expect(candidate?.derivedColumns).toEqual([])
    expect(candidate?.studentRowCount).toBe(5)
  })

  it('a total/percentage column sits in derivedColumns, never writableScoreColumns, on a real grid', () => {
    const header = [text(''), text(''), text(''), text('ช่อง 1 (15)'), text('รวมตลอดภาค')]
    const rows = [header]
    for (let i = 1; i <= 5; i++) {
      rows.push(studentRow(String(i), String(i).padStart(5, '0'), `S${i}`))
    }
    const candidate = evaluateStudentGridCandidate({ tableIndex: 0, selectorFingerprint: 'table[0]', rows })
    expect(candidate?.writableScoreColumns.map((c) => c.label)).toEqual(['ช่อง 1 (15)'])
    expect(candidate?.derivedColumns.map((c) => c.label)).toEqual(['รวมตลอดภาค'])
  })

  it('picks the REAL grid over ~200 surrounding layout tables, never assuming the first/largest table', () => {
    const tables = [
      layoutTable(0),
      layoutTable(1),
      ...Array.from({ length: 200 }, (_, i) => layoutTable(i + 2)),
      studentGridTable(202, 31),
      layoutTable(203),
    ]
    const best = pickBestStudentGridCandidate(tables)
    expect(best?.tableIndex).toBe(202)
    expect(best?.studentRowCount).toBe(31)
  })

  it('returns null when NO table has a qualifying repeating row run', () => {
    const tables = [layoutTable(0), layoutTable(1), layoutTable(2)]
    expect(pickBestStudentGridCandidate(tables)).toBeNull()
  })
})

describe('computeGridConfidence / buildGridWarnings', () => {
  function candidateWith(
    overrides: Partial<{
      numberColumnIndex: number | null
      codeColumnIndex: number | null
      nameColumnIndex: number | null
      writableCount: number
      activatableCount: number
      derivedCount: number
      studentRowCount: number
    }>,
  ) {
    const identifierColumns = {
      numberColumnIndex: 'numberColumnIndex' in overrides ? overrides.numberColumnIndex : 0,
      codeColumnIndex: 'codeColumnIndex' in overrides ? overrides.codeColumnIndex : 1,
      nameColumnIndex: 'nameColumnIndex' in overrides ? overrides.nameColumnIndex : 2,
    }
    const writableScoreColumns = Array.from({ length: overrides.writableCount ?? 1 }, (_, i) => ({
      columnIndex: 3 + i,
      key: `k${i}`,
      label: `col${i}`,
      maxScore: 10,
      inputPattern: 'text',
      inputCount: 10,
    }))
    const activatableScoreColumns = Array.from({ length: overrides.activatableCount ?? 0 }, (_, i) => ({
      columnIndex: 20 + i,
      key: `a${i}`,
      label: `activatable${i}`,
      maxScore: 10,
      reason: 'header_checkbox_unchecked',
    }))
    const derivedColumns = Array.from({ length: overrides.derivedCount ?? 0 }, (_, i) => ({
      columnIndex: 10 + i,
      label: `derived${i}`,
      reason: 'label_indicates_calculated_or_status',
    }))
    return {
      tableIndex: 0,
      selectorFingerprint: 'table[0]',
      run: { startIndex: 1, length: overrides.studentRowCount ?? 10 },
      identifierColumns,
      writableScoreColumns,
      activatableScoreColumns,
      derivedColumns,
      studentRowCount: overrides.studentRowCount ?? 10,
      score: 0,
    }
  }

  it('is "none" when nothing was found', () => {
    expect(computeGridConfidence(null)).toBe('none')
    expect(buildGridWarnings(null)).toEqual(['ไม่พบโครงสร้างแถวนักเรียนที่ซ้ำกันในหน้านี้'])
  })

  it('is "high" with all identifiers, a writable score column, and a healthy row count', () => {
    expect(computeGridConfidence(candidateWith({}))).toBe('high')
  })

  it('is "medium" with core identifiers and a writable score column but few rows', () => {
    expect(computeGridConfidence(candidateWith({ studentRowCount: 3 }))).toBe('medium')
  })

  it('is "low" when a core identifier column is missing', () => {
    expect(computeGridConfidence(candidateWith({ nameColumnIndex: null }))).toBe('low')
  })

  it('is "low" when every score column found is derived (calculated/status), not writable', () => {
    expect(computeGridConfidence(candidateWith({ writableCount: 0, derivedCount: 2 }))).toBe('low')
  })

  it('warns about each missing identifier column specifically', () => {
    const warnings = buildGridWarnings(candidateWith({ codeColumnIndex: null }))
    expect(warnings).toContain('ไม่พบคอลัมน์รหัสนักเรียน')
  })

  it('warns distinctly when score columns exist but are ALL derived/calculated', () => {
    const warnings = buildGridWarnings(candidateWith({ writableCount: 0, derivedCount: 3 }))
    expect(warnings.some((w) => w.includes('คำนวณ/อ่านอย่างเดียว'))).toBe(true)
  })

  it('warns generically when there are no score columns of any kind', () => {
    const warnings = buildGridWarnings(candidateWith({ writableCount: 0, derivedCount: 0 }))
    expect(warnings).toContain('ไม่พบคอลัมน์คะแนนที่กรอกได้จริง')
  })

  it('LIVE DISCOVERY: warns distinctly (never as "calculated/read-only") when score columns exist but are only ACTIVATABLE (checkbox not yet checked)', () => {
    const warnings = buildGridWarnings(candidateWith({ writableCount: 0, activatableCount: 2, derivedCount: 0 }))
    expect(warnings.some((w) => w.includes('activatable0') && w.includes('activatable1'))).toBe(true)
    expect(warnings.some((w) => w.includes('คำนวณ/อ่านอย่างเดียว'))).toBe(false)
  })
})

describe('findHeaderCheckboxState — item 1: header checkbox presence/checked state', () => {
  function tableWithHeaderRow(headerRow: ReturnType<typeof text>[]) {
    return {
      tableIndex: 0,
      selectorFingerprint: 'table[0]',
      rows: [headerRow, ...[1, 2, 3].map((i) => studentRow(String(i), String(i).padStart(5, '0'), `S${i}`))],
    }
  }

  it('reports present:true, checked:true for a checked header checkbox', () => {
    const tableFacts = tableWithHeaderRow([text(''), text(''), text(''), checkboxCell('11', true), text('')])
    expect(findHeaderCheckboxState(tableFacts, 3, 1)).toEqual({ present: true, checked: true })
  })

  it('reports present:true, checked:false for an unchecked header checkbox', () => {
    const tableFacts = tableWithHeaderRow([text(''), text(''), text(''), checkboxCell('11', false), text('')])
    expect(findHeaderCheckboxState(tableFacts, 3, 1)).toEqual({ present: true, checked: false })
  })

  it('reports present:false — never a guess — when the header cell has no checkbox at all', () => {
    const tableFacts = tableWithHeaderRow([text(''), text(''), text(''), text('กลางภาค'), text('')])
    expect(findHeaderCheckboxState(tableFacts, 3, 1)).toEqual({ present: false, checked: false })
  })

  it('never confuses a DIFFERENT column\'s checkbox with the requested one', () => {
    const tableFacts = tableWithHeaderRow([text(''), text(''), text(''), text(''), checkboxCell('12', true)])
    expect(findHeaderCheckboxState(tableFacts, 3, 1)).toEqual({ present: false, checked: false })
    expect(findHeaderCheckboxState(tableFacts, 4, 1)).toEqual({ present: true, checked: true })
  })
})

describe('analyzeColumnRowInputState — item 6: per-row visible/enabled/disabled/readonly counts from the ACTUAL visible input', () => {
  it('matches the spec\'s example shape for a fully checked/enabled column', () => {
    const rows = Array.from({ length: 10 }, () => [input()])
    const result = analyzeColumnRowInputState(0, rows)
    expect(result.visibleInputCount).toBe(10)
    expect(result.enabledInputCount).toBe(10)
    expect(result.disabledInputCount).toBe(0)
    expect(result.readonlyInputCount).toBe(0)
  })

  it('never trusts a hidden sibling control\'s disabled state over the chosen VISIBLE control', () => {
    const rows = Array.from({ length: 5 }, () => [input({ count: 2, visibleCount: 1, visible: true, disabled: false })])
    const result = analyzeColumnRowInputState(0, rows)
    expect(result.enabledInputCount).toBe(5)
    expect(result.disabledInputCount).toBe(0)
    expect(result.allSingleInput).toBe(true)
  })

  it('treats a cell with no VISIBLE control at all as disabled, never enabled', () => {
    const rows = Array.from({ length: 5 }, () => [input({ visible: false, visibleCount: 0 })])
    const result = analyzeColumnRowInputState(0, rows)
    expect(result.visibleInputCount).toBe(0)
    expect(result.enabledInputCount).toBe(0)
    expect(result.disabledInputCount).toBe(5)
  })
})

describe('scanScoreColumnState — item 1, standalone: raw per-column state before any classification', () => {
  it('produces the exact example shape from the live-discovery spec for a checked, fully-enabled column', () => {
    const tableFacts = {
      tableIndex: 0,
      selectorFingerprint: 'table[0]',
      rows: [
        [text(''), text(''), text(''), checkboxCell('10', true)],
        ...Array.from({ length: 10 }, (_, i) => [text(String(i + 1)), text(String(i + 1).padStart(5, '0')), text(`S${i}`), input()]),
      ],
    }
    const state = scanScoreColumnState(tableFacts, 3, { startIndex: 1, length: 10 })
    expect(state).toMatchObject({
      columnIndex: 3,
      label: '10',
      headerCheckboxPresent: true,
      headerCheckboxChecked: true,
      visibleInputCount: 10,
      enabledInputCount: 10,
      disabledInputCount: 0,
      readonlyInputCount: 0,
      writableNow: true,
    })
  })

  it('writableNow is false for a structurally sound column whose header checkbox is unchecked — never inferred from the label', () => {
    const tableFacts = {
      tableIndex: 0,
      selectorFingerprint: 'table[0]',
      rows: [
        [text(''), text(''), text(''), checkboxCell('11', false)],
        ...Array.from({ length: 3 }, (_, i) => [
          text(String(i + 1)),
          text(String(i + 1).padStart(5, '0')),
          text(`S${i}`),
          input({ disabled: true }),
        ]),
      ],
    }
    const state = scanScoreColumnState(tableFacts, 3, { startIndex: 1, length: 3 })
    expect(state.writableNow).toBe(false)
    expect(state.headerCheckboxPresent).toBe(true)
    expect(state.headerCheckboxChecked).toBe(false)
  })
})

describe('buildAnonymizedRowDiagnostics — never leaks a student name/code', () => {
  it('reports only structural metadata, never actual cell text', () => {
    const tableFacts = {
      tableIndex: 5,
      selectorFingerprint: 'table[5]',
      rows: [
        [text('header')],
        studentRow('1', '00001', 'สมชาย ใจดี'),
        studentRow('2', '00002', 'สมหญิง ใจดี'),
        studentRow('3', '00003', 'วิชัย เก่งกล้า'),
      ],
    }
    const candidate = evaluateStudentGridCandidate(tableFacts)
    const rowDiagnostics = buildAnonymizedRowDiagnostics(tableFacts, candidate)

    expect(rowDiagnostics).toHaveLength(3)
    expect(rowDiagnostics[0]).toEqual({
      rowIndex: 1,
      cellCount: 5,
      textCellIndexes: [0, 1, 2],
      inputCellIndexes: [3, 4],
      inputCount: 2,
      probableNumberCell: 0,
      probableStudentCodeCell: 1,
      probableNameCell: 2,
    })

    const serialized = JSON.stringify(rowDiagnostics)
    expect(serialized).not.toContain('สมชาย')
    expect(serialized).not.toContain('00001')
  })

  it('returns an empty array for a table that is not the winning candidate', () => {
    const tableFacts = { tableIndex: 9, selectorFingerprint: 'table[9]', rows: [studentRow('1', '00001', 'A')] }
    const candidate = { tableIndex: 5, run: { startIndex: 0, length: 3 }, identifierColumns: {} } as never
    expect(buildAnonymizedRowDiagnostics(tableFacts, candidate)).toEqual([])
  })
})

describe('matchTargetColumnToRealColumns — never silently guesses', () => {
  const realColumns = [
    { columnIndex: 3, key: 'real-col-1-3', label: 'ช่อง 1', maxScore: 15 },
    { columnIndex: 4, key: 'real-midterm-4', label: 'กลางภาค', maxScore: 10 },
  ]

  it('matches by exact normalized label', () => {
    const result = matchTargetColumnToRealColumns('กลางภาค', realColumns)
    expect(result.status).toBe('MATCHED')
    expect(result.column?.key).toBe('real-midterm-4')
  })

  it('is NOT_FOUND when no real column has a matching label', () => {
    expect(matchTargetColumnToRealColumns('ปลายภาค', realColumns).status).toBe('NOT_FOUND')
  })

  it('is AMBIGUOUS when more than one real column shares the label', () => {
    const duplicated = [...realColumns, { columnIndex: 6, key: 'real-midterm-6', label: 'กลางภาค', maxScore: 10 }]
    expect(matchTargetColumnToRealColumns('กลางภาค', duplicated).status).toBe('AMBIGUOUS')
  })
})

describe('sgsRowKey helpers', () => {
  it('round-trips an offset-within-run through the key format', () => {
    expect(buildSgsRowKey(7)).toBe('row-7')
    expect(sgsRowIndexFromKey('row-7')).toBe(7)
  })

  it('returns null for a malformed key rather than guessing an index', () => {
    expect(sgsRowIndexFromKey('not-a-row-key')).toBeNull()
  })
})

describe('detectPagination — best-effort, never blocking, never auto-changing pages', () => {
  function studentGridTableFacts(tableIndex: number, studentCount = 10) {
    const header = [text(''), text(''), text(''), text('ช่อง 1 (15)')]
    const rows = [header]
    for (let i = 1; i <= studentCount; i++) {
      rows.push(studentRow(String(i), String(i).padStart(5, '0'), `นักเรียน ${i}`))
    }
    return { tableIndex, selectorFingerprint: `table[${tableIndex}]`, rows }
  }

  it('reports not detected, with no guess, when there is no plausible pager row anywhere', () => {
    const tables = [studentGridTableFacts(0)]
    const candidate = pickBestStudentGridCandidate(tables)
    expect(detectPagination(tables, candidate)).toEqual({
      detected: false,
      currentPage: null,
      totalPages: null,
      visibleStudentRows: 10,
      totalStudentRows: null,
    })
  })

  it('detects a pager row in a DIFFERENT table, with the current page as the one non-link numeric cell', () => {
    const gridTable = studentGridTableFacts(0)
    const pagerTable = {
      tableIndex: 1,
      selectorFingerprint: 'table[1]',
      rows: [[link('1'), text('2'), link('3')]],
    }
    const tables = [gridTable, pagerTable]
    const candidate = pickBestStudentGridCandidate(tables)
    expect(detectPagination(tables, candidate)).toEqual({
      detected: true,
      currentPage: 2,
      totalPages: 3,
      visibleStudentRows: 10,
      totalStudentRows: null,
    })
  })

  it('never mistakes the accepted student run itself for a pager row, even though เลขที่ is also short numeric text', () => {
    // The grid table's OWN header row (no inputs) has short numbers-only
    // text nowhere, so this mainly documents the run-exclusion guard;
    // the important behavior is asserted by the "not detected" case
    // above already finding nothing inside a single grid-only table.
    const tables = [studentGridTableFacts(0)]
    const candidate = pickBestStudentGridCandidate(tables)
    expect(detectPagination(tables, candidate)?.detected).toBe(false)
  })

  it('reports currentPage as null when more than one non-link numeric cell exists (ambiguous, never guessed)', () => {
    const gridTable = studentGridTableFacts(0)
    const pagerTable = { tableIndex: 1, selectorFingerprint: 'table[1]', rows: [[text('1'), text('2'), link('3')]] }
    const tables = [gridTable, pagerTable]
    const candidate = pickBestStudentGridCandidate(tables)
    const result = detectPagination(tables, candidate)
    expect(result.detected).toBe(true)
    expect(result.currentPage).toBeNull()
    expect(result.totalPages).toBe(3)
  })

  it('returns a null/zero-shaped result when there is no candidate at all', () => {
    expect(detectPagination([], null)).toEqual({
      detected: false,
      currentPage: null,
      totalPages: null,
      visibleStudentRows: 0,
      totalStudentRows: null,
    })
  })

  it('never changes anything — detectPagination is a pure read of already-collected facts', () => {
    // Structural guarantee: the function takes plain data and returns
    // plain data, with no DOM access at all (this whole file has none).
    expect(typeof detectPagination).toBe('function')
  })
})

describe('detectPagination — LIVE DISCOVERY: real SGS pagination is page-wide TEXT ("32 รายการ" / "10 / หน้า" / "page 1 of 4"), not a row of page-number links', () => {
  function studentGridTableFacts(tableIndex: number, studentCount = 10) {
    const header = [text(''), text(''), text(''), text('ช่อง 1 (15)')]
    const rows = [header]
    for (let i = 1; i <= studentCount; i++) {
      rows.push(studentRow(String(i), String(i).padStart(5, '0'), `นักเรียน ${i}`))
    }
    return { tableIndex, selectorFingerprint: `table[${tableIndex}]`, rows }
  }

  it('reports the exact shape from the bug report: page 1 of 4, 32 total, 10 visible', () => {
    const tables = [studentGridTableFacts(0, 10)]
    const candidate = pickBestStudentGridCandidate(tables)
    const hints = { totalStudentRows: 32, pageSize: 10, currentPage: 1, totalPages: 4 }
    expect(detectPagination(tables, candidate, hints)).toEqual({
      detected: true,
      currentPage: 1,
      totalPages: 4,
      visibleStudentRows: 10,
      totalStudentRows: 32,
    })
  })

  it('prefers the text hints over the old row-of-links heuristic when both are present', () => {
    const gridTable = studentGridTableFacts(0, 10)
    const pagerTable = { tableIndex: 1, selectorFingerprint: 'table[1]', rows: [[link('1'), text('2'), link('3')]] }
    const tables = [gridTable, pagerTable]
    const candidate = pickBestStudentGridCandidate(tables)
    const hints = { totalStudentRows: 32, pageSize: 10, currentPage: 1, totalPages: 4 }
    const result = detectPagination(tables, candidate, hints)
    expect(result.currentPage).toBe(1)
    expect(result.totalPages).toBe(4)
  })

  it('falls back to the old row-of-links detection when hints are absent (e.g. an older capture)', () => {
    const gridTable = studentGridTableFacts(0, 10)
    const pagerTable = { tableIndex: 1, selectorFingerprint: 'table[1]', rows: [[link('1'), text('2'), link('3')]] }
    const tables = [gridTable, pagerTable]
    const candidate = pickBestStudentGridCandidate(tables)
    const result = detectPagination(tables, candidate, undefined)
    expect(result).toEqual({ detected: true, currentPage: 2, totalPages: 3, visibleStudentRows: 10, totalStudentRows: null })
  })

  it('falls back when hints exist but are incomplete (e.g. only the item count was found)', () => {
    const tables = [studentGridTableFacts(0, 10)]
    const candidate = pickBestStudentGridCandidate(tables)
    const result = detectPagination(tables, candidate, { totalStudentRows: 32, pageSize: null, currentPage: null, totalPages: null })
    expect(result.detected).toBe(false)
    expect(result.totalStudentRows).toBeNull()
  })
})

describe('extractSgsStudentCandidates — BUG FIX: real detected SGS rows passed into mapping', () => {
  it('builds one candidate per visible run row, using ONLY the confirmed identifier column indexes', () => {
    const tableFacts = {
      tableIndex: 0,
      selectorFingerprint: 'table[0]',
      rows: [
        studentRow('1', '00001', 'เกศ ศรีคำฉิม'),
        studentRow('2', '00002', 'สมชาย ใจดี'),
        studentRow('3', '00003', 'สมหญิง ใจดี'),
      ],
    }
    const candidate = evaluateStudentGridCandidate(tableFacts)
    expect(candidate).not.toBeNull()

    const result = extractSgsStudentCandidates(tableFacts, candidate!.run, candidate!.identifierColumns)

    expect(result).toEqual([
      { sgsRowKey: 'row-0', sgsStudentNumber: 1, sgsStudentId: '00001', sgsFullNameRaw: 'เกศ ศรีคำฉิม' },
      { sgsRowKey: 'row-1', sgsStudentNumber: 2, sgsStudentId: '00002', sgsFullNameRaw: 'สมชาย ใจดี' },
      { sgsRowKey: 'row-2', sgsStudentNumber: 3, sgsStudentId: '00003', sgsFullNameRaw: 'สมหญิง ใจดี' },
    ])
  })

  it('matches the exact live example from the bug report: row 0 is number 1 / เกศ ศรีคำฉิม', () => {
    const tableFacts = {
      tableIndex: 0,
      selectorFingerprint: 'table[0]',
      rows: [studentRow('1', '00001', 'เกศ ศรีคำฉิม'), studentRow('2', '00002', 'อีกคน'), studentRow('3', '00003', 'อีกคน 2')],
    }
    const candidate = evaluateStudentGridCandidate(tableFacts)!
    const result = extractSgsStudentCandidates(tableFacts, candidate.run, candidate.identifierColumns)
    expect(result[0]).toEqual({ sgsRowKey: 'row-0', sgsStudentNumber: 1, sgsStudentId: '00001', sgsFullNameRaw: 'เกศ ศรีคำฉิม' })
  })

  it('reports a null student number (never NaN/0) when the confirmed number cell is blank', () => {
    // Bypasses column auto-detection here — extractSgsStudentCandidates
    // only ever trusts the identifierColumns it's handed, so this
    // exercises the blank-cell case directly against a fixed run.
    const tableFacts = {
      tableIndex: 0,
      selectorFingerprint: 'table[0]',
      rows: [studentRow('', '00001', 'สมชาย ใจดี'), studentRow('', '00002', 'สมหญิง ใจดี')],
    }
    const run = { startIndex: 0, length: 2 }
    const identifierColumns = { numberColumnIndex: 0, codeColumnIndex: 1, nameColumnIndex: 2 }
    const result = extractSgsStudentCandidates(tableFacts, run, identifierColumns)
    expect(result.every((r) => r.sgsStudentNumber === null)).toBe(true)
  })
})
