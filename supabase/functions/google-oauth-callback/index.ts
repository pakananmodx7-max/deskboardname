// Google Drive API Integration — completes the OAuth connect flow.
// Called by the SPA (authenticated) after Google redirects the browser
// back with ?code=...&state=... in the URL; the SPA reads those out of
// location.search and POSTs them here as JSON — this function never
// receives a raw, unauthenticated redirect from Google directly.
import { handleCorsPreflight, jsonResponse } from '../_shared/cors.ts'
import { exchangeCodeForTokens, fetchGoogleEmail, requireGoogleEnv } from '../_shared/google.ts'
import { createAdminClient, requireTeacherId, UnauthorizedError } from '../_shared/supabase-admin.ts'

interface CallbackBody {
  code?: string
  state?: string
}

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req)
  if (preflight) return preflight

  try {
    const admin = createAdminClient()
    const teacherId = await requireTeacherId(req, admin)
    const env = requireGoogleEnv()

    const body = (await req.json().catch(() => ({}))) as CallbackBody
    if (!body.code || !body.state) return jsonResponse({ error: 'ขาด code หรือ state' }, 400)

    // CSRF check: the state must exist, not be expired, AND belong to
    // the SAME teacher who is completing the callback — a state minted
    // for one teacher can never be redeemed by another session, even if
    // somehow guessed or leaked. Consumed (deleted) immediately once
    // validated, before the token exchange, so it can never be replayed
    // — a failed exchange after this point just means the teacher
    // restarts the connect flow from google-oauth-start.
    const { data: stateRow, error: stateError } = await admin
      .from('google_oauth_states')
      .select('teacher_id, expires_at')
      .eq('state', body.state)
      .maybeSingle()

    if (stateError) throw stateError
    if (!stateRow || stateRow.teacher_id !== teacherId || new Date(stateRow.expires_at) < new Date()) {
      await admin.from('google_oauth_states').delete().eq('state', body.state)
      return jsonResponse({ error: 'ลิงก์เชื่อมต่อหมดอายุหรือไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง' }, 400)
    }
    await admin.from('google_oauth_states').delete().eq('state', body.state)

    const tokens = await exchangeCodeForTokens(env, body.code)
    const email = await fetchGoogleEmail(tokens.access_token)

    // Google only returns a refresh_token when consent is freshly
    // granted — google-oauth-start always forces prompt=consent, so this
    // should be present on every successful callback; the fallback to
    // the previously stored one only guards against an unexpected
    // Google response shape, it is never relied upon as the normal path.
    const { data: existing } = await admin
      .from('google_oauth_connections')
      .select('refresh_token')
      .eq('teacher_id', teacherId)
      .maybeSingle()

    const refreshToken = tokens.refresh_token ?? existing?.refresh_token
    if (!refreshToken) {
      return jsonResponse({ error: 'Google ไม่ได้ส่ง refresh token กลับมา กรุณาลองเชื่อมต่อใหม่อีกครั้ง' }, 502)
    }

    const accessTokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    const { error: upsertError } = await admin.from('google_oauth_connections').upsert(
      {
        teacher_id: teacherId,
        google_email: email,
        scope: tokens.scope,
        refresh_token: refreshToken,
        access_token: tokens.access_token,
        access_token_expires_at: accessTokenExpiresAt,
      },
      { onConflict: 'teacher_id' },
    )
    if (upsertError) throw upsertError

    return jsonResponse({ connected: true, email })
  } catch (err) {
    if (err instanceof UnauthorizedError) return jsonResponse({ error: err.message }, 401)
    console.error('[google-oauth-callback]', err)
    return jsonResponse({ error: 'ไม่สามารถเชื่อมต่อบัญชี Google ได้' }, 500)
  }
})
