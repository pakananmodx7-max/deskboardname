// Document Center (Phase 2) — KrunameClass document storage on the
// teacher's own Google Drive. One endpoint, action-based:
//   overview | create_folder | upload (multipart) | rename | trash | download
//
// Every request: CORS preflight → Supabase Auth session verified
// (requireTeacherId — never a client-supplied id) → caller must be a
// teacher/admin profile → Drive access token minted/refreshed
// server-side (never returned) → the action runs through
// _shared/drive-storage.ts, which only ever touches items tagged as this
// teacher's KrunameClass items. Errors return a stable `code` and a Thai
// message; Google's raw errors and tokens are never forwarded or logged.
import { handleCorsPreflight, corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { createDriveClient, DriveStorageError, handleDriveAction, MAX_UPLOAD_BYTES, type UploadedFile } from '../_shared/drive-storage.ts'
import { getDriveAccessToken } from '../_shared/google-token.ts'
import { createAdminClient, requireTeacherId, UnauthorizedError } from '../_shared/supabase-admin.ts'

// Multipart overhead allowance on top of the file cap.
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 256 * 1024

function errorResponse(err: DriveStorageError): Response {
  return jsonResponse({ error: err.message, code: err.code }, err.status)
}

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req)
  if (preflight) return preflight
  if (req.method !== 'POST') return errorResponse(new DriveStorageError('invalid_request'))

  try {
    const admin = createAdminClient()
    const teacherId = await requireTeacherId(req, admin)

    const { data: profile, error: profileError } = await admin.from('profiles').select('role').eq('id', teacherId).maybeSingle()
    if (profileError) throw profileError
    if (!profile || !['teacher', 'admin'].includes(profile.role)) return errorResponse(new DriveStorageError('forbidden'))

    let action: unknown
    let params: Record<string, unknown> = {}
    let file: UploadedFile | null = null
    const contentType = req.headers.get('content-type') ?? ''
    if (contentType.startsWith('multipart/form-data')) {
      const declared = Number(req.headers.get('content-length') ?? '0')
      if (declared > MAX_REQUEST_BYTES) return errorResponse(new DriveStorageError('too_large'))
      const form = await req.formData()
      action = form.get('action')
      params = { parentId: form.get('parentId') || undefined, name: form.get('name') || undefined }
      const upload = form.get('file')
      if (upload instanceof File) file = { name: upload.name, size: upload.size, bytes: () => upload.arrayBuffer() }
    } else {
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
      if (!body || typeof body !== 'object') return errorResponse(new DriveStorageError('invalid_request'))
      action = body.action
      params = body
    }

    const drive = createDriveClient({ fetch: (input, init) => fetch(input, init), getAccessToken: (force) => getDriveAccessToken(admin, teacherId, force) })
    const result = await handleDriveAction({ action, teacherId, params, file }, drive)

    if (result.kind === 'binary') {
      return new Response(result.body, {
        status: 200,
        headers: { ...corsHeaders(), 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' },
      })
    }
    return jsonResponse(result.body, result.status)
  } catch (err) {
    if (err instanceof UnauthorizedError) return errorResponse(new DriveStorageError('unauthorized'))
    if (err instanceof DriveStorageError) return errorResponse(err)
    console.error('[google-drive-files] unexpected error', err instanceof Error ? err.name : 'unknown')
    return errorResponse(new DriveStorageError('drive_unavailable'))
  }
})
