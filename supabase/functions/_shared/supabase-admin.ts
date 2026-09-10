// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2'

/**
 * `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected
 * automatically into every Supabase Edge Function's runtime — they are
 * NOT secrets a project owner needs to set manually (unlike the
 * GOOGLE_* secrets below). This client uses the service_role key, which
 * bypasses Row Level Security entirely (see
 * supabase/migrations/0018_google_drive_integration.sql's SECURITY
 * MODEL comment) — it is the ONLY thing in this codebase allowed to
 * read/write google_oauth_connections / google_oauth_states, and it
 * must never be created with any other key, nor ever sent to a client.
 */
export function createAdminClient(): any {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the function runtime')
  }
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } })
}

/**
 * Verifies the caller's own Supabase session JWT (sent as
 * `Authorization: Bearer <token>` — supabase-js's `functions.invoke`
 * attaches this automatically for a signed-in user) and returns their
 * user id. This is the ONLY trusted source of "which teacher is
 * calling" anywhere in this integration — never a client-supplied body
 * field, never a URL param. Uses the admin client's `auth.getUser(jwt)`,
 * which validates an arbitrary JWT against Supabase Auth regardless of
 * which key created the client (the service role is only being used
 * here to VERIFY the token, not to impersonate anyone).
 */
export async function requireTeacherId(req: Request, admin: any): Promise<string> {
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) throw new UnauthorizedError('Missing Authorization header')

  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) throw new UnauthorizedError('Invalid or expired session')
  return data.user.id as string
}

export class UnauthorizedError extends Error {}
