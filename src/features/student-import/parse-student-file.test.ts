import { describe, expect, it } from 'vitest'

import { detectHeaderRow, HEADER_DETECTION_CONFIDENCE_THRESHOLD } from '@/features/student-import/detect-header-row'
import { buildParsedSpreadsheet, type SpreadsheetGrid } from '@/features/student-import/parse-student-file'
import { ImportRowLimitExceededError } from '@/features/student-import/types'

function makeGrid(allRows: string[][]): SpreadsheetGrid {
  return { fileName: 'test.xlsx', allRows }
}

describe('buildParsedSpreadsheet', () => {
  it('slices headers and data rows at the given header row index, ignoring rows above it', () => {
    const grid = makeGrid([
      ['โรงเรียนทดสอบวิทยา'],
      ['ชั้น ม.5/1 ปีการศึกษา 2569'],
      ['เลขที่', 'รหัสนักเรียน', 'ชื่อ', 'นามสกุล'],
      ['1', '67001', 'สมชาย', 'ใจดี'],
      ['2', '67002', 'กิตติ', 'พรชัย'],
    ])

    const result = buildParsedSpreadsheet(grid, 2)
    expect(result.headers).toEqual(['เลขที่', 'รหัสนักเรียน', 'ชื่อ', 'นามสกุล'])
    expect(result.rows).toEqual([
      ['1', '67001', 'สมชาย', 'ใจดี'],
      ['2', '67002', 'กิตติ', 'พรชัย'],
    ])
  })

  it('skips blank rows interspersed among the data rows', () => {
    const grid = makeGrid([
      ['เลขที่', 'ชื่อ', 'นามสกุล'],
      ['1', 'สมชาย', 'ใจดี'],
      ['', '', ''],
      ['2', 'กิตติ', 'พรชัย'],
    ])

    const result = buildParsedSpreadsheet(grid, 0)
    expect(result.rows).toHaveLength(2)
    expect(result.rows[1]).toEqual(['2', 'กิตติ', 'พรชัย'])
  })

  it('pads short rows out to the header column count', () => {
    const grid = makeGrid([
      ['เลขที่', 'ชื่อ', 'นามสกุล', 'อีเมล'],
      ['1', 'สมชาย', 'ใจดี'],
    ])

    const result = buildParsedSpreadsheet(grid, 0)
    expect(result.rows[0]).toEqual(['1', 'สมชาย', 'ใจดี', ''])
  })

  it('throws when there are no data rows after the header', () => {
    const grid = makeGrid([['เลขที่', 'ชื่อ', 'นามสกุล']])
    expect(() => buildParsedSpreadsheet(grid, 0)).toThrow('ไม่พบข้อมูลในไฟล์ที่เลือก')
  })

  it('throws ImportRowLimitExceededError when data rows exceed the 500-row limit', () => {
    const dataRows = Array.from({ length: 501 }, (_, i) => [String(i + 1), 'สมชาย', 'ใจดี'])
    const grid = makeGrid([['เลขที่', 'ชื่อ', 'นามสกุล'], ...dataRows])

    expect(() => buildParsedSpreadsheet(grid, 0)).toThrow(ImportRowLimitExceededError)
  })

  it('accepts exactly the 500-row limit', () => {
    const dataRows = Array.from({ length: 500 }, (_, i) => [String(i + 1), 'สมชาย', 'ใจดี'])
    const grid = makeGrid([['เลขที่', 'ชื่อ', 'นามสกุล'], ...dataRows])

    const result = buildParsedSpreadsheet(grid, 0)
    expect(result.rows).toHaveLength(500)
  })

  it('title/header rows above the chosen index never count against the 500-row limit', () => {
    const titleRows = Array.from({ length: 5 }, () => ['ข้อมูลไม่เกี่ยวข้อง'])
    const dataRows = Array.from({ length: 500 }, (_, i) => [String(i + 1), 'สมชาย', 'ใจดี'])
    const grid = makeGrid([...titleRows, ['เลขที่', 'ชื่อ', 'นามสกุล'], ...dataRows])

    const result = buildParsedSpreadsheet(grid, 5)
    expect(result.rows).toHaveLength(500)
  })

  it('manual header-row selection fallback: a tied, low-confidence file lets the teacher override to the correct row', () => {
    // Two rows both look like plausible headers (a leftover "ตัวอย่าง"
    // sample header, then the real one) — detectHeaderRow can't commit
    // confidently to either, which is exactly when the dialog shows the
    // "เลือกแถวหัวตาราง" step and lets the teacher point at the right one
    // instead of trusting the (here, wrong) first-seen guess.
    const grid = makeGrid([
      ['เลขที่', 'รหัสนักเรียน', 'ชื่อ', 'นามสกุล'], // sample/template header — not the real one
      ['ตัวอย่าง'],
      ['ลำดับ', 'รหัส', 'ชื่อเล่น', 'เบอร์โทร'], // the real header for this file
      ['1', '67001', 'สมชาย', '0812345678'],
    ])

    const detection = detectHeaderRow(grid.allRows)
    expect(detection.confidence).toBeLessThan(HEADER_DETECTION_CONFIDENCE_THRESHOLD)

    // Teacher overrides to row index 2 (the real header), not whatever
    // detectHeaderRow's tie-break happened to land on.
    const result = buildParsedSpreadsheet(grid, 2)
    expect(result.headers).toEqual(['ลำดับ', 'รหัส', 'ชื่อเล่น', 'เบอร์โทร'])
    expect(result.rows).toEqual([['1', '67001', 'สมชาย', '0812345678']])
  })
})
