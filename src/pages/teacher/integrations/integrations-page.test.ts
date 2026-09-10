import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./integrations-page.tsx', import.meta.url), 'utf-8')
}

describe('IntegrationsPage — Google account connect/disconnect (Google Drive API Integration, Section 13)', () => {
  const source = readSource()

  it('offers both connect and disconnect controls', () => {
    expect(source).toContain('เชื่อมต่อ Google Drive')
    expect(source).toContain('ตัดการเชื่อมต่อ')
  })

  it('disconnect requires an explicit confirm dialog — never a single-click destructive action', () => {
    expect(source).toContain('<ConfirmDialog')
    expect(source).toContain('onConfirm={handleDisconnect}')
  })

  it('reads code/state from its own URL (the OAuth redirect target) and strips them afterward so a page refresh can never resubmit the same one-time code', () => {
    expect(source).toContain("params.get('code')")
    expect(source).toContain("params.get('state')")
    expect(source).toContain("navigate('/teacher/integrations', { replace: true })")
  })

  it('completes the connect flow via completeGoogleConnect, never by reading tokens out of the URL itself', () => {
    expect(source).toContain('completeGoogleConnect(code, oauthState)')
    expect(source).not.toMatch(/access_token|refresh_token/)
  })
})
