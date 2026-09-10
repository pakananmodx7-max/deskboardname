import JSZip from 'jszip'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { buildZip } from '@/lib/export/zip-export'

describe('buildZip — teacher backup export bundling', () => {
  it('bundles every given file at the ZIP root, byte-for-byte, with no folders', async () => {
    const blob = await buildZip([
      { filename: 'classrooms.csv', content: 'a,b\r\n1,2' },
      { filename: 'students.csv', content: 'x,y\r\n3,4' },
    ])
    expect(blob).toBeInstanceOf(Blob)

    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(Object.keys(zip.files).sort()).toEqual(['classrooms.csv', 'students.csv'])
    expect(await zip.file('classrooms.csv')?.async('string')).toBe('a,b\r\n1,2')
    expect(await zip.file('students.csv')?.async('string')).toBe('x,y\r\n3,4')
  })

  it('produces an empty (but valid) archive for an empty file list', async () => {
    const blob = await buildZip([])
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(Object.keys(zip.files)).toEqual([])
  })

  it('preserves a UTF-8 BOM + Thai content exactly (the CSVs it bundles already carry both)', async () => {
    const csvWithBom = '﻿ชื่อ,คะแนน\r\nสมชาย,80'
    const blob = await buildZip([{ filename: 'students.csv', content: csvWithBom }])
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(await zip.file('students.csv')?.async('string')).toBe(csvWithBom)
  })
})

describe('downloadBlob — mirrors downloadCsv()\'s Blob/URL.createObjectURL pattern', () => {
  it('uses the exact same download-trigger shape as the already-shipped CSV download helper', () => {
    const zipSource = readFileSync(new URL('./zip-export.ts', import.meta.url), 'utf-8')
    const csvSource = readFileSync(new URL('./csv-export.ts', import.meta.url), 'utf-8')
    for (const line of ['URL.createObjectURL', 'document.createElement', 'a.click()', 'URL.revokeObjectURL']) {
      expect(zipSource).toContain(line)
      expect(csvSource).toContain(line)
    }
  })
})
