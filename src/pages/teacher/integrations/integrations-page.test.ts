import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./integrations-page.tsx', import.meta.url), 'utf-8')
}

describe('IntegrationsPage — Google OAuth redirect callback (Google Drive API Integration, Section 13)', () => {
  const source = readSource()

  it('reads code/state from its own URL (the OAuth redirect target) and strips them afterward so a page refresh can never resubmit the same one-time code', () => {
    expect(source).toContain("params.get('code')")
    expect(source).toContain("params.get('state')")
    expect(source).toContain("navigate('/teacher/integrations', { replace: true })")
  })

  it('completes the connect flow via completeGoogleConnect, never by reading tokens out of the URL itself', () => {
    expect(source).toContain('completeGoogleConnect(code, oauthState)')
    expect(source).not.toMatch(/access_token|refresh_token/)
  })

  it('renders the shared GoogleDriveConnectionCard rather than re-implementing status/connect/disconnect UI', () => {
    expect(source).toContain('<GoogleDriveConnectionCard')
    expect(source).toContain("from '@/features/google-drive/google-drive-connection-card'")
  })

  it('no longer advertises unbuilt integrations ("เร็ว ๆ นี้ ... Hermes Agent") — Hermes Agent is now real (see hermes-agent-page.tsx)', () => {
    expect(source).not.toContain('เร็ว ๆ นี้')
    expect(source).not.toContain('Google Sheets API, LINE')
  })
})
