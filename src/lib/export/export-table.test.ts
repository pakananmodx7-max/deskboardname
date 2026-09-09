import { describe, expect, it } from 'vitest'

import { buildCsvContent, type ExportTable } from '@/lib/export/export-table'

function table(overrides: Partial<ExportTable> = {}): ExportTable {
  return {
    title: 'ทดสอบ',
    subtitle: 'ห้องเรียน: ม.5/1',
    headers: ['ชื่อ', 'คะแนน'],
    rows: [['สมชาย', 80]],
    ...overrides,
  }
}

describe('buildCsvContent — export data correctness', () => {
  it('starts with a UTF-8 BOM so Excel renders Thai text correctly', () => {
    const csv = buildCsvContent(table())
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })

  it('joins headers and rows with commas and CRLF line breaks', () => {
    const csv = buildCsvContent(table())
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe('ชื่อ,คะแนน')
    expect(lines[1]).toBe('สมชาย,80')
  })

  it('quotes a cell containing a comma', () => {
    const csv = buildCsvContent(table({ rows: [['สมชาย, ใจดี', 80]] }))
    expect(csv).toContain('"สมชาย, ใจดี"')
  })

  it('quotes and escapes a cell containing a double quote', () => {
    const csv = buildCsvContent(table({ rows: [['บอกว่า "เยี่ยม"', 80]] }))
    expect(csv).toContain('"บอกว่า ""เยี่ยม"""')
  })

  it('quotes a cell containing a newline', () => {
    const csv = buildCsvContent(table({ rows: [['บรรทัดที่ 1\nบรรทัดที่ 2', 80]] }))
    expect(csv).toContain('"บรรทัดที่ 1\nบรรทัดที่ 2"')
  })

  it('neutralizes a cell starting with = (CSV/formula injection guard)', () => {
    const csv = buildCsvContent(table({ rows: [['=SUM(A1:A9)', 80]] }))
    expect(csv).toContain("'=SUM(A1:A9)")
  })

  it('neutralizes cells starting with +, -, @, tab, or carriage return', () => {
    for (const trigger of ['+1', '-1', '@cmd', '\tx', '\rx']) {
      const csv = buildCsvContent(table({ rows: [[trigger, 1]] }))
      expect(csv).toContain(`'${trigger}`)
    }
  })

  it('does not alter a normal cell that merely contains (not starts with) those characters', () => {
    const csv = buildCsvContent(table({ rows: [['คะแนน = 80', 1]] }))
    expect(csv).toContain('คะแนน = 80')
    expect(csv).not.toContain("'คะแนน")
  })

  it('produces exactly one line per row plus the header line', () => {
    const csv = buildCsvContent(table({ rows: [['a', 1], ['b', 2], ['c', 3]] }))
    const lines = csv.slice(1).split('\r\n')
    expect(lines).toHaveLength(4)
  })
})
