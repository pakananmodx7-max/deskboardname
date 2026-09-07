import { describe, expect, it } from 'vitest'

import {
  detectHeaderRow,
  HEADER_DETECTION_CONFIDENCE_THRESHOLD,
} from '@/features/student-import/detect-header-row'

describe('detectHeaderRow', () => {
  it('finds the header row past a school name / class / academic year title block', () => {
    const rows = [
      ['โรงเรียนทดสอบวิทยา'],
      ['ชั้น ม.5/1 ปีการศึกษา 2569'],
      ['เลขที่', 'รหัสนักเรียน', 'ชื่อ', 'นามสกุล', 'ชื่อเล่น'],
      ['1', '67001', 'สมชาย', 'ใจดี', 'ชาย'],
      ['2', '67002', 'กิตติ', 'พรชัย', 'ตี๋'],
    ]

    const result = detectHeaderRow(rows)
    expect(result.headerRowIndex).toBe(2)
    expect(result.confidence).toBeGreaterThanOrEqual(HEADER_DETECTION_CONFIDENCE_THRESHOLD)
  })

  it('skips entirely blank rows before the header', () => {
    const rows = [
      ['', '', ''],
      [],
      ['', ''],
      ['เลขที่', 'ชื่อ', 'นามสกุล'],
      ['1', 'สมชาย', 'ใจดี'],
    ]

    const result = detectHeaderRow(rows)
    expect(result.headerRowIndex).toBe(3)
    expect(result.confidence).toBeGreaterThanOrEqual(HEADER_DETECTION_CONFIDENCE_THRESHOLD)
  })

  it('handles sparse rows from merged cells without crashing or false-matching', () => {
    // A merged "รายชื่อนักเรียนชั้น ม.5/1" title cell typically comes back
    // from sheet_to_json as a single populated cell with the rest of the
    // row empty (''), not literally repeated across columns.
    const rows = [
      ['รายชื่อนักเรียนชั้น ม.5/1', '', '', ''],
      ['', '', '', ''],
      ['เลขที่', 'รหัสนักเรียน', 'ชื่อ', 'นามสกุล'],
      ['1', '67001', 'สมชาย', 'ใจดี'],
    ]

    const result = detectHeaderRow(rows)
    expect(result.headerRowIndex).toBe(2)
    expect(result.confidence).toBeGreaterThanOrEqual(HEADER_DETECTION_CONFIDENCE_THRESHOLD)
  })

  it('recognizes common Thai school header terms including ห้อง and คำนำหน้า', () => {
    const rows = [
      ['เลขที่', 'คำนำหน้า', 'ชื่อ', 'นามสกุล', 'ห้อง', 'เบอร์โทร'],
      ['1', 'เด็กชาย', 'สมชาย', 'ใจดี', 'ม.5/1', '0812345678'],
    ]

    const result = detectHeaderRow(rows)
    expect(result.headerRowIndex).toBe(0)
    expect(result.confidence).toBeGreaterThanOrEqual(HEADER_DETECTION_CONFIDENCE_THRESHOLD)
  })

  it('detects a header row for a fullName-only spreadsheet (ชื่อ-นามสกุล single column)', () => {
    const rows = [
      ['โรงเรียนทดสอบวิทยา ปีการศึกษา 2569'],
      ['เลขที่', 'ชื่อ-นามสกุล', 'ชื่อเล่น'],
      ['1', 'กิตติ พรชัย', 'ตี๋'],
    ]

    const result = detectHeaderRow(rows)
    expect(result.headerRowIndex).toBe(1)
    expect(result.confidence).toBeGreaterThanOrEqual(HEADER_DETECTION_CONFIDENCE_THRESHOLD)
  })

  it('reports low confidence when no row looks like a header at all', () => {
    const rows = [
      ['โรงเรียนทดสอบวิทยา'],
      ['เอกสารแนบท้าย'],
      ['หน้า 1'],
    ]

    const result = detectHeaderRow(rows)
    expect(result.confidence).toBeLessThan(HEADER_DETECTION_CONFIDENCE_THRESHOLD)
  })

  it('reports low confidence when two rows tie as equally plausible headers (ambiguous file)', () => {
    // Two fully-populated, all-header-vocabulary rows with the same score
    // — e.g. a header row directly followed by a near-duplicate secondary
    // header. Neither should be silently auto-picked; a tied runner-up
    // must pull confidence below the threshold so the dialog asks a human.
    const rows = [
      ['เลขที่', 'รหัสนักเรียน', 'ชื่อ', 'นามสกุล'],
      ['ลำดับ', 'รหัส', 'ชื่อเล่น', 'เบอร์โทร'],
      ['1', '67001', 'สมชาย', 'ใจดี'],
    ]

    const result = detectHeaderRow(rows)
    expect(result.confidence).toBeLessThan(HEADER_DETECTION_CONFIDENCE_THRESHOLD)
  })

  it('only scans the first HEADER_SCAN_LIMIT rows', () => {
    const padding = Array.from({ length: 25 }, () => [''])
    const rows = [...padding, ['เลขที่', 'ชื่อ', 'นามสกุล'], ['1', 'สมชาย', 'ใจดี']]

    const result = detectHeaderRow(rows)
    // The real header is past row 20, so detection can't see it and must
    // fall back to its best (low-confidence) guess among the scanned rows.
    expect(result.confidence).toBeLessThan(HEADER_DETECTION_CONFIDENCE_THRESHOLD)
  })

  it('returns a safe default for an empty input', () => {
    const result = detectHeaderRow([])
    expect(result).toEqual({ headerRowIndex: 0, confidence: 0, candidates: [] })
  })
})
