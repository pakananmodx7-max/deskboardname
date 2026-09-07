import { describe, expect, it } from 'vitest'

import {
  flagInFileDuplicates,
  parseImportRows,
  summarizeImportRows,
} from '@/features/student-import/student-import-validator'
import type { ColumnMapping, ParsedSpreadsheet } from '@/features/student-import/types'

function makeSheet(headers: string[], rows: string[][]): ParsedSpreadsheet {
  return { fileName: 'test.xlsx', headers, rows }
}

describe('parseImportRows', () => {
  it('builds ready rows from separate first/last name columns', () => {
    const mapping: ColumnMapping = { number: 0, studentCode: 1, firstName: 2, lastName: 3 }
    const sheet = makeSheet(
      ['เลขที่', 'รหัสนักเรียน', 'ชื่อ', 'นามสกุล'],
      [['1', '67001', 'สมชาย', 'ใจดี']],
    )

    const [row] = parseImportRows(sheet, mapping)
    expect(row).toMatchObject({
      rowNumber: 1,
      number: 1,
      studentCode: '67001',
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      status: 'ready',
      reason: null,
    })
  })

  it('falls back to splitting a fullName column when first/last are not mapped', () => {
    const mapping: ColumnMapping = { fullName: 0 }
    const sheet = makeSheet(['ชื่อ-นามสกุล'], [['กิตติ พรชัย']])

    const [row] = parseImportRows(sheet, mapping)
    expect(row.firstName).toBe('กิตติ')
    expect(row.lastName).toBe('พรชัย')
    expect(row.status).toBe('ready')
    expect(row.fullNameAmbiguous).toBe(false)
  })

  it('marks a row invalid when the last name cannot be determined', () => {
    const mapping: ColumnMapping = { fullName: 0 }
    const sheet = makeSheet(['ชื่อ-นามสกุล'], [['สมชาย']])

    const [row] = parseImportRows(sheet, mapping)
    expect(row.status).toBe('invalid')
    expect(row.reason).toBe('ไม่พบชื่อหรือนามสกุล')
  })

  it('marks a row invalid when required columns are simply missing', () => {
    const mapping: ColumnMapping = { firstName: 0, lastName: 1 }
    const sheet = makeSheet(['ชื่อ', 'นามสกุล'], [['', '']])

    const [row] = parseImportRows(sheet, mapping)
    expect(row.status).toBe('invalid')
  })

  it('flags repeated student codes within the same file as duplicates', () => {
    const mapping: ColumnMapping = { studentCode: 0, firstName: 1, lastName: 2 }
    const sheet = makeSheet(
      ['รหัสนักเรียน', 'ชื่อ', 'นามสกุล'],
      [
        ['67001', 'สมชาย', 'ใจดี'],
        ['67001', 'สมชาย', 'ใจดี'],
      ],
    )

    const rows = parseImportRows(sheet, mapping)
    expect(rows[0].status).toBe('ready')
    expect(rows[1].status).toBe('duplicate')
    expect(rows[1].reason).toBe('รหัสนักเรียนซ้ำในไฟล์นี้')
  })
})

describe('flagInFileDuplicates', () => {
  it('leaves rows without a student code untouched', () => {
    const rows = flagInFileDuplicates([
      {
        rowNumber: 1,
        studentCode: null,
        number: null,
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        nickname: null,
        email: null,
        phone: null,
        status: 'ready',
        reason: null,
        fullNameAmbiguous: false,
      },
    ])
    expect(rows[0].status).toBe('ready')
  })
})

describe('summarizeImportRows', () => {
  it('counts rows by status', () => {
    const mapping: ColumnMapping = { studentCode: 0, firstName: 1, lastName: 2 }
    const sheet = makeSheet(
      ['รหัสนักเรียน', 'ชื่อ', 'นามสกุล'],
      [
        ['67001', 'สมชาย', 'ใจดี'],
        ['67001', 'สมชาย', 'ใจดี'],
        ['', '', 'ไม่มีชื่อ'],
      ],
    )

    const summary = summarizeImportRows(parseImportRows(sheet, mapping))
    expect(summary).toEqual({ total: 3, ready: 1, duplicate: 1, invalid: 1 })
  })
})
