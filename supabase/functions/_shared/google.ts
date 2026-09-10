/**
 * Google OAuth 2.0 + Drive integration constants/helpers shared by every
 * google-oauth-* and google-drive-* Edge Function. Nothing here ever
 * runs in the browser — this file only exists inside the Edge Function
 * runtime.
 *
 * LEAST PRIVILEGE (Google Drive API Integration, Section 8): the ONLY
 * Drive scope requested is `drive.file` — this grants access solely to
 * files the teacher explicitly opens/creates through THIS app (Google's
 * own documented behavior for `drive.file` + the Picker: a file picked
 * via Picker while the app only holds `drive.file` scope is
 * automatically, individually authorized for that file — the app is
 * never granted blanket read access to the teacher's whole Drive). This
 * is deliberately NOT `drive.readonly` or `drive` (full access), which
 * would be far more than this feature needs. `openid`/`userinfo.email`
 * are included only so the Integrations page can show which Google
 * account is connected — no other profile data is requested.
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

export const GOOGLE_AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
export const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo'

export interface GoogleOAuthEnv {
  clientId: string
  clientSecret: string
  /** MUST exactly match the redirect URI registered for this OAuth
   * client in Google Cloud Console — Google's token endpoint rejects a
   * mismatch. Always read from this function's own env, NEVER accepted
   * as a value from the client request (see requireGoogleEnv's doc
   * comment for why: trusting a client-supplied redirect_uri would let
   * a caller redirect the authorization code to an origin of their
   * choosing). */
  redirectUri: string
}

/** Throws a clear error naming exactly which secret is missing, rather
 * than letting a later fetch() fail with an opaque Google error. */
export function requireGoogleEnv(): GoogleOAuthEnv {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
  const redirectUri = Deno.env.get('GOOGLE_OAUTH_REDIRECT_URI')
  const missing = [
    !clientId && 'GOOGLE_CLIENT_ID',
    !clientSecret && 'GOOGLE_CLIENT_SECRET',
    !redirectUri && 'GOOGLE_OAUTH_REDIRECT_URI',
  ].filter(Boolean)
  if (missing.length > 0) {
    throw new Error(`Missing required Edge Function secret(s): ${missing.join(', ')}. See docs/GOOGLE_DRIVE_SETUP.md.`)
  }
  return { clientId: clientId!, clientSecret: clientSecret!, redirectUri: redirectUri! }
}

/** Pure — builds the full Google consent-screen URL. `access_type=offline`
 * + `prompt=consent` together guarantee Google returns a refresh_token
 * on every connect (not just the very first time), so a teacher who
 * disconnects and reconnects always gets a fresh, valid one. */
export function buildAuthorizeUrl(env: GoogleOAuthEnv, state: string): string {
  const params = new URLSearchParams({
    client_id: env.clientId,
    redirect_uri: env.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `${GOOGLE_AUTHORIZE_ENDPOINT}?${params.toString()}`
}

interface GoogleTokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope: string
  token_type: string
}

async function postForm(url: string, body: Record<string, string>): Promise<GoogleTokenResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Google token endpoint returned ${response.status}: ${text}`)
  }
  return (await response.json()) as GoogleTokenResponse
}

/** Exchanges a one-time authorization code for tokens — the ONE place
 * GOOGLE_CLIENT_SECRET is ever used. `redirect_uri` here MUST be
 * byte-identical to the one used when building the authorize URL
 * (OAuth spec requirement, enforced by Google). */
export function exchangeCodeForTokens(env: GoogleOAuthEnv, code: string): Promise<GoogleTokenResponse> {
  return postForm(GOOGLE_TOKEN_ENDPOINT, {
    client_id: env.clientId,
    client_secret: env.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: env.redirectUri,
  })
}

/** Mints a fresh, short-lived access_token from a stored refresh_token.
 * Google does not return a new refresh_token here — the original stays
 * valid until revoked or a new one is issued via a fresh consent. */
export function refreshAccessToken(env: GoogleOAuthEnv, refreshToken: string): Promise<GoogleTokenResponse> {
  return postForm(GOOGLE_TOKEN_ENDPOINT, {
    client_id: env.clientId,
    client_secret: env.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
}

/** Best-effort revoke — the caller is expected to delete the local row
 * regardless of whether this succeeds (e.g. the token may already be
 * invalid on Google's side), so a disconnect never gets stuck. */
export async function revokeToken(token: string): Promise<void> {
  await fetch(`${GOOGLE_REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => undefined)
}

export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  const response = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) return null
  const data = (await response.json().catch(() => null)) as { email?: string } | null
  return data?.email ?? null
}
