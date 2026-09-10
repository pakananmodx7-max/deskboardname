import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { PICKER_ALLOWED_MIME_TYPES } from '@/lib/google-picker'

function readSource(): string {
  return readFileSync(new URL('./google-picker.ts', import.meta.url), 'utf-8')
}

describe('PICKER_ALLOWED_MIME_TYPES (Google Drive API Integration, Section 2/14)', () => {
  it('allows PDF, Google Docs, Google Slides, images, and common office documents', () => {
    expect(PICKER_ALLOWED_MIME_TYPES).toContain('application/pdf')
    expect(PICKER_ALLOWED_MIME_TYPES).toContain('application/vnd.google-apps.document')
    expect(PICKER_ALLOWED_MIME_TYPES).toContain('application/vnd.google-apps.presentation')
    expect(PICKER_ALLOWED_MIME_TYPES).toContain('image/jpeg')
    expect(PICKER_ALLOWED_MIME_TYPES).toContain('image/png')
  })

  it('never includes Google Sheets — "No Google Sheets API in this phase" (Section 14)', () => {
    expect(PICKER_ALLOWED_MIME_TYPES).not.toContain('spreadsheet')
  })
})

describe('google-picker.ts — Picker configuration (Google Drive API Integration, Section 9/11)', () => {
  const source = readSource()

  it('never lets the teacher pick or browse into a whole folder — individual files only', () => {
    expect(source).toContain('setIncludeFolders(false)')
    expect(source).toContain('setSelectFolderEnabled(false)')
  })

  it('never fetches or proxies the picked file\'s bytes through this app — only reads id/name/mimeType/url metadata from the Picker response', () => {
    expect(source).not.toMatch(/fetch\(.*doc\.url/)
    expect(source).not.toContain('.blob(')
  })

  it('resolves (never throws) when the teacher cancels the picker — a cancel is not an error', () => {
    expect(source).toContain('Action.CANCEL')
    expect(source).toMatch(/Action\.CANCEL[\s\S]*?resolve\(null\)/)
  })
})
