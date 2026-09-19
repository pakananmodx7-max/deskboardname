import { describe, expect, it } from 'vitest'

import {
  buildColumnKey,
  buildSgsRowKey,
  identifyIdentifierColumns,
  identifyScoreColumnCandidates,
  matchTargetColumnToRealColumns,
  parseMaxScoreFromHeader,
  sgsRowIndexFromKey,
  slugifyHeaderText,
} from '../src/lib/sgs-table-extraction.js'

describe('identifyIdentifierColumns', () => {
  it('finds เลขที่/รหัสนักเรียน/ชื่อ-นามสกุล columns by header keyword', () => {
    const headers = ['เลขที่', 'รหัสนักเรียน', 'ชื่อ-นามสกุล', 'ช่อง 1', 'กลางภาค']
    expect(identifyIdentifierColumns(headers)).toEqual({
      numberColumnIndex: 0,
      codeColumnIndex: 1,
      nameColumnIndex: 2,
    })
  })

  it('returns null for a field with no matching header — never guesses', () => {
    const headers = ['ลำดับ', 'ชื่อ']
    const result = identifyIdentifierColumns(headers)
    expect(result.numberColumnIndex).toBe(0)
    expect(result.codeColumnIndex).toBeNull()
    expect(result.nameColumnIndex).toBe(1)
  })
})

describe('parseMaxScoreFromHeader', () => {
  it('extracts the trailing number as the max score', () => {
    expect(parseMaxScoreFromHeader('ช่อง 1 (15)')).toBe(15)
    expect(parseMaxScoreFromHeader('กลางภาค (10 คะแนน)')).toBe(10)
    expect(parseMaxScoreFromHeader('ปลายภาค เต็ม 30')).toBe(30)
  })

  it('returns null rather than guessing when no number is present', () => {
    expect(parseMaxScoreFromHeader('กลางภาค')).toBeNull()
  })

  it('prefers the LAST number over a leading column index', () => {
    expect(parseMaxScoreFromHeader('ช่อง 1 (15)')).toBe(15)
  })
})

describe('buildColumnKey / slugifyHeaderText — stable and derived, never invented', () => {
  it('slugifies header text into a lowercase, hyphenated, parenthesis-free form', () => {
    expect(slugifyHeaderText('กลางภาค (10)')).toBe('กลางภาค-10')
  })

  it('is deterministic for the same header text and index', () => {
    expect(buildColumnKey('กลางภาค (10)', 4)).toBe(buildColumnKey('กลางภาค (10)', 4))
  })

  it('differs when the column index differs, even with identical header text', () => {
    expect(buildColumnKey('ช่อง', 1)).not.toBe(buildColumnKey('ช่อง', 2))
  })

  it('never invents a selector-looking string — just a derived slug plus index', () => {
    expect(buildColumnKey('กลางภาค', 3)).toMatch(/^real-.*-3$/)
  })
})

describe('identifyScoreColumnCandidates', () => {
  it('only includes non-identifier columns that actually contain an input', () => {
    const headers = ['เลขที่', 'ชื่อ-นามสกุล', 'ช่อง 1 (15)', 'หมายเหตุ']
    const hasInput = [false, false, true, false]
    const identifierColumns = { numberColumnIndex: 0, codeColumnIndex: null, nameColumnIndex: 1 }
    const candidates = identifyScoreColumnCandidates(headers, hasInput, identifierColumns)
    expect(candidates).toEqual([{ columnIndex: 2, key: buildColumnKey('ช่อง 1 (15)', 2), label: 'ช่อง 1 (15)', maxScore: 15 }])
  })

  it('excludes an identifier column even if it happens to contain an input', () => {
    const headers = ['เลขที่', 'ชื่อ-นามสกุล']
    const hasInput = [true, false]
    const identifierColumns = { numberColumnIndex: 0, codeColumnIndex: null, nameColumnIndex: 1 }
    expect(identifyScoreColumnCandidates(headers, hasInput, identifierColumns)).toEqual([])
  })

  it('a score column with no derivable max score reports maxScore: null, never a guess', () => {
    const headers = ['เลขที่', 'กลางภาค']
    const hasInput = [false, true]
    const identifierColumns = { numberColumnIndex: 0, codeColumnIndex: null, nameColumnIndex: null }
    const candidates = identifyScoreColumnCandidates(headers, hasInput, identifierColumns)
    expect(candidates[0].maxScore).toBeNull()
  })
})

describe('matchTargetColumnToRealColumns — never silently guesses', () => {
  const realColumns = [
    { columnIndex: 2, key: 'real-col-1-2', label: 'ช่อง 1', maxScore: 15 },
    { columnIndex: 3, key: 'real-midterm-3', label: 'กลางภาค', maxScore: 10 },
  ]

  it('matches by exact normalized label', () => {
    const result = matchTargetColumnToRealColumns('กลางภาค', realColumns)
    expect(result.status).toBe('MATCHED')
    expect(result.column.key).toBe('real-midterm-3')
  })

  it('is NOT_FOUND when no real column has a matching label', () => {
    const result = matchTargetColumnToRealColumns('ปลายภาค', realColumns)
    expect(result.status).toBe('NOT_FOUND')
    expect(result.column).toBeNull()
  })

  it('is AMBIGUOUS when more than one real column shares the label — never guessed', () => {
    const duplicated = [...realColumns, { columnIndex: 5, key: 'real-midterm-5', label: 'กลางภาค', maxScore: 10 }]
    const result = matchTargetColumnToRealColumns('กลางภาค', duplicated)
    expect(result.status).toBe('AMBIGUOUS')
    expect(result.column).toBeNull()
  })

  it('ignores whitespace differences when normalizing', () => {
    const result = matchTargetColumnToRealColumns('กลาง ภาค', realColumns)
    expect(result.status).toBe('MATCHED')
  })
})

describe('sgsRowKey helpers', () => {
  it('round-trips row index through the key format', () => {
    expect(buildSgsRowKey(7)).toBe('row-7')
    expect(sgsRowIndexFromKey('row-7')).toBe(7)
  })

  it('returns null for a malformed key rather than guessing an index', () => {
    expect(sgsRowIndexFromKey('not-a-row-key')).toBeNull()
  })
})
