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

describe('google-picker.ts — setAppId() requirement (403 fix — Google Picker requires the Cloud project number for drive.file scope)', () => {
  const source = readSource()

  it('openGoogleDrivePicker accepts an appId parameter and calls setAppId on the builder', () => {
    expect(source).toContain('export function openGoogleDrivePicker(accessToken: string, apiKey: string, appId: string)')
    expect(source).toContain('.setAppId(appId)')
  })

  it('setAppId is called on the SAME builder chain as setOAuthToken/setDeveloperKey, before the callback is registered', () => {
    const fn = source.slice(source.indexOf('export function openGoogleDrivePicker'), source.indexOf('picker.setVisible(true)'))
    expect(fn).toMatch(/setOAuthToken\(accessToken\)[\s\S]*?setDeveloperKey\(apiKey\)[\s\S]*?setAppId\(appId\)[\s\S]*?setCallback\(/)
  })

  it('the PickerBuilder ambient type declares setAppId so this compiles under strict TypeScript', () => {
    expect(source).toContain('setAppId: (appId: string) => PickerBuilder')
  })
})

describe('google-picker.ts — setOrigin() (production 403 investigation)', () => {
  const source = readSource()

  it('calls setOrigin with the page\'s own origin, after setAppId and before the callback is registered', () => {
    const fn = source.slice(source.indexOf('export function openGoogleDrivePicker'), source.indexOf('picker.setVisible(true)'))
    expect(fn).toMatch(/setAppId\(appId\)[\s\S]*?setOrigin\(origin\)[\s\S]*?setCallback\(/)
    expect(fn).toContain('const origin = window.location.origin')
  })

  it('the PickerBuilder ambient type declares setOrigin so this compiles under strict TypeScript', () => {
    expect(source).toContain('setOrigin: (origin: string) => PickerBuilder')
  })
})

describe('google-picker.ts — temporary SAFE diagnostics (production 403 investigation)', () => {
  const source = readSource()

  it('logs presence/length/masked-prefix/appId/origin, and which setters ran — never the full API key or access token', () => {
    expect(source).toContain('function logPickerDiagnostics(')
    expect(source).toContain('apiKeyPresent: Boolean(info.apiKey)')
    expect(source).toContain('apiKeyLength: info.apiKey.length')
    expect(source).toContain('apiKeyPrefix: info.apiKey.slice(0, 6)')
    expect(source).toContain('accessTokenPresent: Boolean(info.accessToken)')
    expect(source).toContain('accessTokenLength: info.accessToken.length')
    // the full apiKey/accessToken values must never appear as a bare logged field
    expect(source).not.toMatch(/apiKey:\s*info\.apiKey[,}]/)
    expect(source).not.toMatch(/accessToken:\s*info\.accessToken[,}]/)
  })

  it('is called before build() with the executed flags for all four setters', () => {
    const fn = source.slice(source.indexOf('export function openGoogleDrivePicker'), source.indexOf('picker.setVisible(true)'))
    expect(fn).toMatch(/logPickerDiagnostics\(\{[\s\S]*?\}\)[\s\S]*?\.build\(\)/)
    expect(fn).toContain('executed.setOAuthToken = true')
    expect(fn).toContain('executed.setDeveloperKey = true')
    expect(fn).toContain('executed.setAppId = true')
    expect(fn).toContain('executed.setOrigin = true')
  })
})
