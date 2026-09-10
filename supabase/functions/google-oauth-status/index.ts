// Google Drive API Integration — lets the Integrations page show
// "connected as x@gmail.com" / "not connected" without minting a fresh
// access_token just to check (that only happens lazily, right before a
// Picker session, via google-drive-access-token).
import { handleCorsPreflight, jsonResponse } from '../_shared/cors.ts'
import { createAdminClient, requireTeacherId, UnauthorizedError } from '../_shared/supabase-admin.ts'

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req)
  if (preflight) return preflight

  try {
    const admin = createAdminClient()
    const teacherId = await requireTeacherId(req, admin)

    const { data: connection, error } = await admin
      .from('google_oauth_connections')
      .select('google_email, scope, created_at')
      .eq('teacher_id', teacherId)
      .maybeSingle()
    if (error) throw error

    if (!connection) return jsonResponse({ connected: false })
    return jsonResponse({
      connected: true,
      email: connection.google_email,
      scope: connection.scope,
      connectedAt: connection.created_at,
    })
  } catch (err) {
    if (err instanceof UnauthorizedError) return jsonResponse({ error: err.message }, 401)
    console.error('[google-oauth-status]', err)
    return jsonResponse({ error: 'ไม่สามารถตรวจสอบสถานะการเชื่อมต่อ Google ได้' }, 500)
  }
})
