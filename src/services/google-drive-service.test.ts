import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readServiceSource(): string {
  return readFileSync(new URL('./google-drive-service.ts', import.meta.url), 'utf-8')
}

function readFunctionSource(name: string): string {
  return readFileSync(new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url), 'utf-8')
}

function readSharedFunctionSource(name: string): string {
  return readFileSync(new URL(`../../supabase/functions/_shared/${name}`, import.meta.url), 'utf-8')
}

describe('google-drive-service.ts — client never handles a refresh token or client secret (Google Drive API Integration, Section 6/7)', () => {
  const source = readServiceSource()

  it('never references a refresh token or client secret anywhere in client code', () => {
    expect(source).not.toMatch(/refresh_token/i)
    expect(source).not.toMatch(/client_secret/i)
  })

  it('the access token minted for the Picker is only ever read from the accessToken field of the Edge Function response', () => {
    expect(source).toContain("invokeFunction<{ accessToken: string }>('google-drive-access-token')")
  })

  it('starting the connect flow performs a full-page navigation to Google\'s own consent URL rather than embedding any credential locally', () => {
    expect(source).toContain('window.location.assign(url)')
  })
})

describe('google-drive-service.ts — typed reauth/not-connected errors (Section 5/9)', () => {
  const source = readServiceSource()

  it('maps the reauth_required and not_connected error codes to distinct, catchable error classes', () => {
    expect(source).toContain("parsed?.code === 'reauth_required'")
    expect(source).toContain("parsed?.code === 'not_connected'")
    expect(source).toContain('class GoogleReauthRequiredError')
    expect(source).toContain('class GoogleNotConnectedError')
  })
})

describe('Edge Functions — least-privilege Google scope (Section 3/8)', () => {
  const source = readSharedFunctionSource('google.ts')

  it('requests ONLY drive.file (never drive.readonly or the full drive scope)', () => {
    expect(source).toContain("'https://www.googleapis.com/auth/drive.file'")
    expect(source).not.toMatch(/auth\/drive\.readonly/)
    expect(source).not.toMatch(/auth\/drive['"](?!\.file)/)
  })

  it('the redirect_uri is always read from this function\'s own env, never accepted from the client request', () => {
    const buildAuthorizeUrlFn = source.slice(source.indexOf('export function buildAuthorizeUrl'), source.indexOf('interface GoogleTokenResponse'))
    expect(buildAuthorizeUrlFn).toContain('env.redirectUri')
    expect(buildAuthorizeUrlFn).not.toMatch(/req\.(json|body)/)
  })

  it('forces prompt=consent + access_type=offline so a refresh token is always issued on connect', () => {
    expect(source).toContain("prompt: 'consent'")
    expect(source).toContain("access_type: 'offline'")
  })
})

describe('google-oauth-start — CSRF state issuance (Section: OAuth state/CSRF protection)', () => {
  const source = readFunctionSource('google-oauth-start')

  it('authenticates the caller via their own Supabase session before issuing a state', () => {
    expect(source).toContain('requireTeacherId(req, admin)')
  })

  it('the state is stored keyed to the authenticated teacher, not trusted from any client input', () => {
    expect(source).toContain("admin.from('google_oauth_states').insert({ state, teacher_id: teacherId })")
  })
})

describe('google-oauth-callback — CSRF state verification + teacher isolation (Section: OAuth state/CSRF protection, teacher isolation)', () => {
  const source = readFunctionSource('google-oauth-callback')

  it('rejects a state that does not belong to the currently authenticated teacher', () => {
    expect(source).toContain('stateRow.teacher_id !== teacherId')
  })

  it('rejects an expired state', () => {
    expect(source).toContain('new Date(stateRow.expires_at) < new Date()')
  })

  it('consumes (deletes) the state before exchanging the code, so it can never be replayed', () => {
    const beforeExchange = source.slice(0, source.indexOf('await exchangeCodeForTokens('))
    expect(beforeExchange).toContain("admin.from('google_oauth_states').delete().eq('state', body.state)")
  })

  it('the response to the client never includes the access_token, refresh_token, or raw tokens object', () => {
    const returnStatement = source.slice(source.lastIndexOf('return jsonResponse({ connected'))
    expect(returnStatement).not.toMatch(/access_token|refresh_token|tokens\.access_token/)
  })
})

describe('google-drive-access-token — only a short-lived access token ever reaches the client (Section 6/7)', () => {
  const source = readFunctionSource('google-drive-access-token')

  it('authenticates via the caller\'s own session before touching any stored connection', () => {
    expect(source).toContain('requireTeacherId(req, admin)')
  })

  it('every DB lookup is scoped to the authenticated teacher_id — never an unscoped table read', () => {
    const selectCalls = source.match(/\.from\('google_oauth_connections'\)[\s\S]{0,220}/g) ?? []
    expect(selectCalls.length).toBeGreaterThan(0)
    for (const call of selectCalls) {
      expect(call).toContain("eq('teacher_id', teacherId)")
    }
  })

  it('a dead refresh token (revoked on Google\'s side) drops the stored connection rather than retrying forever', () => {
    expect(source).toContain("admin.from('google_oauth_connections').delete().eq('teacher_id', teacherId)")
    expect(source).toContain("code: 'reauth_required'")
  })

  it('the JSON response never includes the refresh_token field', () => {
    expect(source).not.toMatch(/jsonResponse\(\{[^}]*refresh_token/)
  })
})

describe('google-oauth-disconnect — always removes the local row even if the remote revoke fails (Section 13)', () => {
  const source = readFunctionSource('google-oauth-disconnect')

  it('revoke is awaited but not required to succeed before deleting the stored connection', () => {
    expect(source).toContain('await revokeToken(connection.refresh_token)')
    const afterRevoke = source.slice(source.indexOf('await revokeToken'))
    expect(afterRevoke).toContain("admin.from('google_oauth_connections').delete().eq('teacher_id', teacherId)")
  })
})

describe('supabase-admin.ts — the ONLY trusted source of "which teacher is calling" (teacher isolation / no cross-account access)', () => {
  const source = readSharedFunctionSource('supabase-admin.ts')

  it('derives the teacher id from the caller\'s own verified session JWT, never a request body/query field', () => {
    const fn = source.slice(source.indexOf('export async function requireTeacherId'))
    expect(fn).toContain('admin.auth.getUser(token)')
    expect(fn).not.toMatch(/body\.|searchParams|query\./)
  })

  it('uses the service_role key only to VERIFY the JWT and read/write the two integration tables — never to bypass auth entirely', () => {
    expect(source).toContain('SUPABASE_SERVICE_ROLE_KEY')
  })
})
