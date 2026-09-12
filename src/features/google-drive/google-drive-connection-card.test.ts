import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./google-drive-connection-card.tsx', import.meta.url), 'utf-8')
}

describe('GoogleDriveConnectionCard — shared connect/disconnect UI (Google Drive API Integration, Section 13)', () => {
  const source = readSource()

  it('offers both connect and disconnect controls', () => {
    expect(source).toContain('เชื่อมต่อ Google Drive')
    expect(source).toContain('ตัดการเชื่อมต่อ')
  })

  it('disconnect requires an explicit confirm dialog — never a single-click destructive action', () => {
    expect(source).toContain('<ConfirmDialog')
    expect(source).toContain('onConfirm={handleDisconnect}')
  })

  it('reuses the existing google-drive-service functions rather than re-implementing status/connect/disconnect', () => {
    expect(source).toContain('getGoogleConnectionStatus')
    expect(source).toContain('startGoogleConnect')
    expect(source).toContain('disconnectGoogleAccount')
    expect(source).not.toMatch(/access_token|refresh_token/)
  })

  it('never reads the OAuth redirect callback params itself — that stays only in integrations-page.tsx', () => {
    expect(source).not.toContain("params.get('code')")
    expect(source).not.toMatch(/completeGoogleConnect\(/)
  })
})
