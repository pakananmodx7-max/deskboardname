// deno-lint-ignore-file no-explicit-any
import { classifyRefreshFailure, DriveStorageError, hasDriveFileScope } from './drive-storage.ts'
import { refreshAccessToken, requireGoogleEnv } from './google.ts'

// Refresh slightly early so a request never starts with a token about to expire.
const EXPIRY_BUFFER_MS = 60_000

/**
 * Server-side Drive access token for ONE teacher, read from
 * google_oauth_connections with the service-role client (that table has
 * no client policies at all — 0018). Same refresh rules as the existing
 * google-drive-access-token function, but the token is only ever used
 * here, inside the Edge Function — it is never returned to the browser.
 *
 * Throws DriveStorageError: not_connected, scope_missing (the teacher
 * unticked Drive access on Google's consent screen), reauth_required
 * (refresh token revoked — only then is the stored connection removed),
 * not_configured (secrets missing / client rejected), drive_unavailable
 * (transient refresh failure — the connection is kept).
 */
export async function getDriveAccessToken(admin: any, teacherId: string, forceRefresh: boolean): Promise<string> {
  const { data: connection, error } = await admin
    .from('google_oauth_connections')
    .select('scope, refresh_token, access_token, access_token_expires_at')
    .eq('teacher_id', teacherId)
    .maybeSingle()
  if (error) throw error
  if (!connection) throw new DriveStorageError('not_connected')
  if (!hasDriveFileScope(connection.scope)) throw new DriveStorageError('scope_missing')

  const expiresAt = connection.access_token_expires_at ? new Date(connection.access_token_expires_at).getTime() : 0
  if (!forceRefresh && connection.access_token && expiresAt - Date.now() > EXPIRY_BUFFER_MS) return connection.access_token

  let env
  try {
    env = requireGoogleEnv()
  } catch {
    throw new DriveStorageError('not_configured')
  }

  let refreshed
  try {
    refreshed = await refreshAccessToken(env, connection.refresh_token)
  } catch (err) {
    const reason = classifyRefreshFailure(err)
    if (reason === 'revoked') {
      // The grant is dead for good — remove it so the page shows "reconnect".
      console.error('[google-drive-files] refresh token revoked; removing stale connection')
      await admin.from('google_oauth_connections').delete().eq('teacher_id', teacherId)
      throw new DriveStorageError('reauth_required')
    }
    // A network blip, a Google outage or a server misconfiguration must
    // never cost the teacher their connection.
    console.error(`[google-drive-files] token refresh failed (${reason}); connection kept`)
    throw new DriveStorageError(reason === 'misconfigured' ? 'not_configured' : 'drive_unavailable')
  }

  const accessTokenExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
  const { error: updateError } = await admin
    .from('google_oauth_connections')
    .update({ access_token: refreshed.access_token, access_token_expires_at: accessTokenExpiresAt })
    .eq('teacher_id', teacherId)
  if (updateError) throw updateError
  return refreshed.access_token
}
