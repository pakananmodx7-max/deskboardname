// Google Drive API Integration — starts the OAuth connect flow for the
// calling teacher. Returns the Google consent-screen URL the SPA should
// navigate to; never redirects itself (this is invoked via fetch, not a
// browser navigation).
import { handleCorsPreflight, jsonResponse } from '../_shared/cors.ts'
import { buildAuthorizeUrl, requireGoogleEnv } from '../_shared/google.ts'
import { createAdminClient, requireTeacherId, UnauthorizedError } from '../_shared/supabase-admin.ts'

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req)
  if (preflight) return preflight

  try {
    const admin = createAdminClient()
    const teacherId = await requireTeacherId(req, admin)
    const env = requireGoogleEnv()

    // Cryptographically random, single-use CSRF token — verified by
    // google-oauth-callback before any code exchange happens.
    const state = crypto.randomUUID() + crypto.randomUUID()

    // Opportunistic cleanup of abandoned states (a teacher who started
    // but never finished connecting) — cheap, and keeps this table from
    // growing unbounded without needing a separate scheduled job.
    await admin.from('google_oauth_states').delete().lt('expires_at', new Date().toISOString())

    const { error: insertError } = await admin.from('google_oauth_states').insert({ state, teacher_id: teacherId })
    if (insertError) throw insertError

    return jsonResponse({ url: buildAuthorizeUrl(env, state) })
  } catch (err) {
    if (err instanceof UnauthorizedError) return jsonResponse({ error: err.message }, 401)
    console.error('[google-oauth-start]', err)
    return jsonResponse({ error: 'ไม่สามารถเริ่มเชื่อมต่อ Google ได้' }, 500)
  }
})
