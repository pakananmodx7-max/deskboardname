// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2'

import { createAdminClient, requireTeacherId, UnauthorizedError } from './supabase-admin.ts'

export { UnauthorizedError }

/** The caller is a real, authenticated Supabase user, but not a teacher
 * (or has no profile at all) — distinct from UnauthorizedError (no/invalid
 * session). Maps to HTTP 403. */
export class ForbiddenError extends Error {}

/** The requested row does not exist OR (indistinguishable by design,
 * exactly like every other ownership-scoped lookup in this codebase —
 * see subject-service.ts/lesson-service.ts's own "ไม่พบ... หรือคุณไม่มีสิทธิ์"
 * messages) the caller does not own it. Maps to HTTP 404. Never reveals
 * which case it is — that would itself leak "this id exists but isn't
 * yours". */
export class NotFoundError extends Error {}

/** Caller-supplied input failed validation. Maps to HTTP 400. */
export class ValidationError extends Error {}

export interface AgentContext {
  /** The calling teacher's profile id — derived ONLY from their verified
   * Supabase session JWT (see requireTeacherId), never from anything the
   * caller sent in the request body. */
  teacherId: string
  /**
   * A Supabase client scoped to the CALLER'S OWN session (anon key +
   * their bearer token forwarded as-is) — every query made with this
   * client runs through Postgres RLS exactly as if the teacher had made
   * it themselves from the browser app. This is deliberately NOT the
   * service-role/admin client: every read/write tool in the Teacher
   * Agent Tool Layer reuses the SAME ownership boundary already proven
   * out by the whole app (classrooms_select_own, assignments_insert_own,
   * subject_classrooms_select_own, etc.) instead of re-implementing
   * "does this teacher own that row" per tool. A tool can still add its
   * own NotFoundError/ValidationError checks for a clearer error message,
   * but the actual authorization is enforced by the database, not by
   * this function's code.
   */
  client: any
}

/**
 * Builds the per-request context every Teacher Agent Tool handler
 * receives. Two different Supabase clients are used for two different,
 * deliberately separate jobs:
 *
 *   1. `createAdminClient()` (service-role key) is used ONLY to verify
 *      the caller's JWT via `requireTeacherId` (identical helper already
 *      used by every Google Drive Integration function) — this is a
 *      stateless "is this token valid, and whose is it" check against
 *      Supabase Auth, not a database read, and never touches a table.
 *      The service-role key never leaves this function and is never
 *      used again after this step.
 *   2. The user-scoped client (anon key + the caller's own Authorization
 *      header) is what every tool actually queries with — so RLS, not
 *      this function, is the authorization boundary for all classroom/
 *      subject/assignment/attendance data.
 *
 * After identity is established, this also enforces the one rule RLS
 * alone does not: only a `role = 'teacher'` profile may call ANY agent
 * tool (a signed-in student's own profile row is readable via
 * profiles_select_own regardless of role, so this check must happen
 * here, explicitly, rather than being left to table-level RLS).
 */
export async function requireTeacherContext(req: Request): Promise<AgentContext> {
  const authHeader = req.headers.get('Authorization') ?? ''

  const admin = createAdminClient()
  const teacherId = await requireTeacherId(req, admin)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anonKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in the function runtime')
  }

  const client = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  })

  const { data: profile, error } = await client.from('profiles').select('role').eq('id', teacherId).maybeSingle()
  if (error) throw error
  if (!profile || profile.role !== 'teacher') {
    throw new ForbiddenError('บัญชีนี้ไม่ใช่บัญชีครู ไม่สามารถใช้งาน Teacher Agent Tool ได้')
  }

  return { teacherId, client }
}
