/**
 * Shared CORS headers for every Google Drive Integration Edge Function.
 * `ALLOWED_ORIGIN` should be set to this app's exact deployed origin
 * (e.g. "https://your-app.vercel.app") — falls back to "*" only when
 * unset, which is fine for local `supabase functions serve` testing but
 * should always be configured in production (see
 * docs/GOOGLE_DRIVE_SETUP.md). These functions never rely on cookies —
 * every call is authenticated via a Bearer token the caller sets itself
 * — so a permissive fallback here is a CORS-only relaxation, never a
 * credential leak.
 */
export function corsHeaders(): HeadersInit {
  const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN') || '*'
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  })
}

export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() })
  }
  return null
}
