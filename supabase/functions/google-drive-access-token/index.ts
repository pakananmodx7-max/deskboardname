// Google Drive API Integration — the ONLY function that ever returns a
// Google credential to the browser, and only ever a short-lived,
// drive.file-scoped access_token (never the refresh_token, never the
// client secret). The frontend feeds this directly into the Google
// Picker's setOAuthToken().
import { handleCorsPreflight, jsonResponse } from '../_shared/cors.ts'
import { fetchTokenInfo, GOOGLE_SCOPES, maskClientId, refreshAccessToken, requireGoogleEnv } from '../_shared/google.ts'
import { createAdminClient, requireTeacherId, UnauthorizedError } from '../_shared/supabase-admin.ts'

// Refresh proactively if the cached token expires within this window,
// so a Picker session that takes a minute to open never starts with an
// already-stale token.
const EXPIRY_BUFFER_MS = 60_000

const DRIVE_FILE_SCOPE = GOOGLE_SCOPES.split(' ')[0]

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req)
  if (preflight) return preflight

  try {
    const admin = createAdminClient()
    const teacherId = await requireTeacherId(req, admin)
    const env = requireGoogleEnv()

    const { data: connection, error: selectError } = await admin
      .from('google_oauth_connections')
      .select('refresh_token, access_token, access_token_expires_at')
      .eq('teacher_id', teacherId)
      .maybeSingle()
    if (selectError) throw selectError
    if (!connection) return jsonResponse({ error: 'ยังไม่ได้เชื่อมต่อ Google Drive', code: 'not_connected' }, 404)

    let accessToken: string
    let accessTokenExpiresAt: string

    const expiresAt = connection.access_token_expires_at ? new Date(connection.access_token_expires_at).getTime() : 0
    if (connection.access_token && expiresAt - Date.now() > EXPIRY_BUFFER_MS) {
      accessToken = connection.access_token
      accessTokenExpiresAt = connection.access_token_expires_at as string
    } else {
      let refreshed
      try {
        refreshed = await refreshAccessToken(env, connection.refresh_token)
      } catch (refreshErr) {
        // The teacher likely revoked access directly on Google's side —
        // the stored refresh_token is now permanently dead. Remove the
        // connection so the Integrations page correctly shows
        // "disconnected" instead of silently failing on every future
        // Picker attempt, and ask the teacher to reconnect.
        console.error('[google-drive-access-token] refresh failed, dropping stale connection', refreshErr)
        await admin.from('google_oauth_connections').delete().eq('teacher_id', teacherId)
        return jsonResponse({ error: 'การเชื่อมต่อ Google หมดอายุ กรุณาเชื่อมต่อใหม่อีกครั้ง', code: 'reauth_required' }, 401)
      }

      accessToken = refreshed.access_token
      accessTokenExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
      const { error: updateError } = await admin
        .from('google_oauth_connections')
        .update({ access_token: accessToken, access_token_expires_at: accessTokenExpiresAt })
        .eq('teacher_id', teacherId)
      if (updateError) throw updateError
    }

    // TEMPORARY diagnostics (production Picker 403 investigation): proves
    // whether the token Picker receives was actually minted for THIS
    // app's own OAuth client/project, using Google's own tokeninfo
    // endpoint. Reports only non-secret token metadata — the access
    // token itself is never included here and never logged by this
    // function. Remove once the 403 is resolved.
    const tokenInfo = await fetchTokenInfo(accessToken).catch(() => null)
    const diagnostics = tokenInfo && {
      aud: tokenInfo.aud,
      azp: tokenInfo.azp,
      scope: tokenInfo.scope,
      expiresIn: tokenInfo.expiresIn,
      accessType: tokenInfo.accessType,
      audMatchesClientId: tokenInfo.aud === env.clientId,
      azpMatchesClientId: tokenInfo.azp === env.clientId,
      hasDriveFileScope: Boolean(tokenInfo.scope?.split(' ').includes(DRIVE_FILE_SCOPE)),
      maskedClientId: maskClientId(env.clientId),
    }

    return jsonResponse({ accessToken, expiresAt: accessTokenExpiresAt, diagnostics })
  } catch (err) {
    if (err instanceof UnauthorizedError) return jsonResponse({ error: err.message }, 401)
    console.error('[google-drive-access-token]', err)
    return jsonResponse({ error: 'ไม่สามารถขอสิทธิ์เข้าถึง Google Drive ได้' }, 500)
  }
})
