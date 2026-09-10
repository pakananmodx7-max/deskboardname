// Google Drive API Integration — disconnects the calling teacher's
// Google account: best-effort revokes the refresh token with Google,
// then always deletes the local row regardless of whether the revoke
// call succeeded (a token that's already invalid on Google's side must
// still be forgotten locally).
import { handleCorsPreflight, jsonResponse } from '../_shared/cors.ts'
import { revokeToken } from '../_shared/google.ts'
import { createAdminClient, requireTeacherId, UnauthorizedError } from '../_shared/supabase-admin.ts'

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req)
  if (preflight) return preflight

  try {
    const admin = createAdminClient()
    const teacherId = await requireTeacherId(req, admin)

    const { data: connection } = await admin
      .from('google_oauth_connections')
      .select('refresh_token')
      .eq('teacher_id', teacherId)
      .maybeSingle()

    if (connection?.refresh_token) {
      await revokeToken(connection.refresh_token)
    }

    const { error: deleteError } = await admin.from('google_oauth_connections').delete().eq('teacher_id', teacherId)
    if (deleteError) throw deleteError

    return jsonResponse({ disconnected: true })
  } catch (err) {
    if (err instanceof UnauthorizedError) return jsonResponse({ error: err.message }, 401)
    console.error('[google-oauth-disconnect]', err)
    return jsonResponse({ error: 'ไม่สามารถตัดการเชื่อมต่อ Google ได้' }, 500)
  }
})
