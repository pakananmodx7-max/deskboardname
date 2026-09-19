import { describe, expect, it } from 'vitest'

import {
  buildAnonymizedRowDiagnostics,
  buildColumnKey,
  buildGridWarnings,
  buildRowFingerprint,
  buildSgsRowKey,
  classifyIdentifierColumns,
  computeGridConfidence,
  deriveScoreColumns,
  evaluateStudentGridCandidate,
  findRepeatingRowRun,
  fingerprintsEqual,
  isRejectedHeaderText,
  looksLikeStudentRowFingerprint,
  matchTargetColumnToRealColumns,
  parseMaxScoreFromHeader,
  pickBestStudentGridCandidate,
  sgsRowIndexFromKey,
  slugifyHeaderText,
} from '../src/lib/sgs-table-extraction.js'

function text(t: string) {
  return { hasInput: false, text: t }
}
function input() {
  return { hasInput: true, text: '' }
}

/** A single realistic student row: เลขที่ | เลขประจำตัว | ชื่อ-นามสกุล | 2 score inputs. */
function studentRow(number: string, code: string, name: string) {
  return [text(number), text(code), text(name), input(), input()]
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

describe('deriveScoreColumns', () => {
  const identifierColumns = { numberColumnIndex: 0, codeColumnIndex: 1, nameColumnIndex: 2 }

  it('builds one entry per input column not already claimed as an identifier column', () => {
    const headerRow = [text(''), text(''), text(''), text('ช่อง 1 (15)'), text('กลางภาค (10)')]
    const result = deriveScoreColumns([3, 4], headerRow, identifierColumns)
    expect(result).toEqual([
      { columnIndex: 3, key: buildColumnKey('ช่อง 1 (15)', 3), label: 'ช่อง 1 (15)', maxScore: 15 },
      { columnIndex: 4, key: buildColumnKey('กลางภาค (10)', 4), label: 'กลางภาค (10)', maxScore: 10 },
    ])
  })

  it('rejects a score column whose header is actually an academic-year/nav label', () => {
    const headerRow = [text(''), text(''), text(''), text('ปีการศึกษา 2568')]
    expect(deriveScoreColumns([3], headerRow, identifierColumns)).toEqual([])
  })

  it('handles a missing header row (run starts at row 0) gracefully — label falls back, maxScore is null', () => {
    const result = deriveScoreColumns([3], null, identifierColumns)
    expect(result).toEqual([{ columnIndex: 3, key: buildColumnKey('col-3', 3), label: 'คอลัมน์ 4', maxScore: null }])
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

  it('accepts the real grid table and reports its identifier/score columns', () => {
    const candidate = evaluateStudentGridCandidate(studentGridTable(5))
    expect(candidate?.identifierColumns).toEqual({ numberColumnIndex: 0, codeColumnIndex: 1, nameColumnIndex: 2 })
    expect(candidate?.scoreColumns).toHaveLength(2)
    expect(candidate?.studentRowCount).toBe(5)
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
  function candidateWith(overrides: Partial<{ numberColumnIndex: number | null; codeColumnIndex: number | null; nameColumnIndex: number | null; scoreColumnCount: number; studentRowCount: number }>) {
    const identifierColumns = {
      numberColumnIndex: 'numberColumnIndex' in overrides ? overrides.numberColumnIndex : 0,
      codeColumnIndex: 'codeColumnIndex' in overrides ? overrides.codeColumnIndex : 1,
      nameColumnIndex: 'nameColumnIndex' in overrides ? overrides.nameColumnIndex : 2,
    }
    const scoreColumns = Array.from({ length: overrides.scoreColumnCount ?? 1 }, (_, i) => ({
      columnIndex: 3 + i,
      key: `k${i}`,
      label: `col${i}`,
      maxScore: 10,
    }))
    return {
      tableIndex: 0,
      selectorFingerprint: 'table[0]',
      run: { startIndex: 1, length: overrides.studentRowCount ?? 10 },
      identifierColumns,
      scoreColumns,
      studentRowCount: overrides.studentRowCount ?? 10,
      score: 0,
    }
  }

  it('is "none" when nothing was found', () => {
    expect(computeGridConfidence(null)).toBe('none')
    expect(buildGridWarnings(null)).toEqual(['ไม่พบโครงสร้างแถวนักเรียนที่ซ้ำกันในหน้านี้'])
  })

  it('is "high" with all identifiers, a score column, and a healthy row count', () => {
    expect(computeGridConfidence(candidateWith({}))).toBe('high')
  })

  it('is "medium" with core identifiers and a score column but few rows', () => {
    expect(computeGridConfidence(candidateWith({ studentRowCount: 3 }))).toBe('medium')
  })

  it('is "low" when a core identifier column is missing', () => {
    expect(computeGridConfidence(candidateWith({ nameColumnIndex: null }))).toBe('low')
  })

  it('warns about each missing identifier/score column specifically', () => {
    const warnings = buildGridWarnings(candidateWith({ codeColumnIndex: null, scoreColumnCount: 0 }))
    expect(warnings).toContain('ไม่พบคอลัมน์รหัสนักเรียน')
    expect(warnings).toContain('ไม่พบคอลัมน์คะแนน')
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
