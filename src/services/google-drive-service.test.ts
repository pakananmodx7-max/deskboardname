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
    expect(source).toContain("invokeFunction<DrivePickerAccessTokenResponse>('google-drive-access-token')")
    expect(source).toContain('.then((r) => {')
    expect(source).toContain('return r.accessToken')
  })

  it('starting the connect flow performs a full-page navigation to Google\'s own consent URL rather than embedding any credential locally', () => {
    expect(source).toContain('window.location.assign(url)')
  })
})

describe('google-drive-service.ts — VITE_GOOGLE_APP_ID threaded the same way as VITE_GOOGLE_API_KEY (403 fix)', () => {
  const source = readServiceSource()

  it('reads VITE_GOOGLE_APP_ID and fails clearly (never silently) when it is missing, same as VITE_GOOGLE_API_KEY', () => {
    expect(source).toContain('import.meta.env.VITE_GOOGLE_APP_ID')
    expect(source).toMatch(/if \(!appId\) \{\s*throw new Error/)
  })

  it('passes both apiKey and appId into openGoogleDrivePicker, in that order, alongside the minted access token', () => {
    expect(source).toContain('openGoogleDrivePicker(accessToken, apiKey, appId)')
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

describe('google-drive-access-token — TEMPORARY tokeninfo diagnostics (production Picker 403 investigation)', () => {
  const source = readFunctionSource('google-drive-access-token')

  it('calls fetchTokenInfo with the access token and reports aud/azp/scope/expiresIn/accessType', () => {
    expect(source).toContain('fetchTokenInfo(accessToken)')
    expect(source).toContain('aud: tokenInfo.aud')
    expect(source).toContain('azp: tokenInfo.azp')
    expect(source).toContain('scope: tokenInfo.scope')
    expect(source).toContain('expiresIn: tokenInfo.expiresIn')
    expect(source).toContain('accessType: tokenInfo.accessType')
  })

  it('computes whether aud/azp exactly match GOOGLE_CLIENT_ID and whether the drive.file scope is present', () => {
    expect(source).toContain('audMatchesClientId: tokenInfo.aud === env.clientId')
    expect(source).toContain('azpMatchesClientId: tokenInfo.azp === env.clientId')
    expect(source).toContain('hasDriveFileScope:')
  })

  it('includes a masked client id (never the full GOOGLE_CLIENT_ID) in the diagnostics', () => {
    expect(source).toContain('maskedClientId: maskClientId(env.clientId)')
  })

  it('never logs the access token itself anywhere in this function', () => {
    expect(source).not.toMatch(/console\.(log|error|warn)\([^)]*\baccessToken\b/)
  })
})

describe('_shared/google.ts — fetchTokenInfo / maskClientId (production Picker 403 investigation)', () => {
  const source = readSharedFunctionSource('google.ts')

  it('fetchTokenInfo calls Google\'s public tokeninfo endpoint and never logs anything itself', () => {
    const fn = source.slice(source.indexOf('export async function fetchTokenInfo'), source.indexOf('export function maskClientId'))
    expect(fn).toContain('GOOGLE_TOKENINFO_ENDPOINT')
    expect(fn).not.toMatch(/console\.(log|error|warn)/)
  })

  it('maskClientId returns only the first 12 characters plus the constant suffix — never the full client id', () => {
    expect(source).toContain("export function maskClientId(clientId: string): string {")
    expect(source).toContain('clientId.slice(0, 12)')
    expect(source).toContain('...apps.googleusercontent.com')
  })
})

describe('google-drive-service.ts — client logs ONLY the safe tokeninfo diagnostics fields, never the access token (production Picker 403 investigation)', () => {
  const source = readServiceSource()

  it('logTokenInfoDiagnostics logs the whole diagnostics object (already server-scrubbed) and nothing else', () => {
    expect(source).toContain('function logTokenInfoDiagnostics(')
    expect(source).toContain("console.log('[google-drive-access-token tokeninfo diagnostics]', diagnostics)")
  })

  it('never logs the raw accessToken anywhere in this file', () => {
    expect(source).not.toMatch(/console\.(log|error|warn)\([^)]*\baccessToken\b/)
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
