/**
 * Environment-variable configuration for the bridge. Deliberately tiny
 * and dependency-free so it can be unit tested with a plain object
 * standing in for `process.env`.
 *
 * SECURITY: this file is the one place that decides which credential
 * the bridge will use, and it enforces — structurally, not just by
 * convention — that a service_role key can never be one of them: there
 * is no code path anywhere in this module (or the rest of the bridge)
 * that reads `SUPABASE_SERVICE_ROLE_KEY` into a variable used for
 * anything. If it happens to be set (e.g. copy-pasted from the Edge
 * Function's own `.env`), loadConfig() only checks for its presence to
 * warn about it — the value itself is never read.
 */

export class ConfigError extends Error {}

export type TeacherAuthConfig =
  | { mode: 'password'; email: string; password: string }
  | { mode: 'refresh_token'; refreshToken: string }

export interface BridgeConfig {
  /** The Supabase project URL, e.g. https://hmlcebcbfyhbmicdbnkr.supabase.co */
  supabaseUrl: string
  /** The project's PUBLIC anon/publishable key — the same one already
   * shipped in the web app's browser bundle (VITE_SUPABASE_PUBLISHABLE_KEY).
   * Never the service_role key. */
  supabaseAnonKey: string
  auth: TeacherAuthConfig
  /** True when a SUPABASE_SERVICE_ROLE_KEY env var is present — its
   * value is never read, only its presence is used to emit a startup
   * warning (see index.ts). */
  serviceRoleKeyPresentButIgnored: boolean
}

function requireNonEmpty(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function loadConfig(env: NodeJS.ProcessEnv): BridgeConfig {
  const supabaseUrl = requireNonEmpty(env, 'SUPABASE_URL')
  if (!supabaseUrl) {
    throw new ConfigError('Missing required environment variable SUPABASE_URL.')
  }

  const supabaseAnonKey = requireNonEmpty(env, 'SUPABASE_ANON_KEY')
  if (!supabaseAnonKey) {
    throw new ConfigError(
      "Missing required environment variable SUPABASE_ANON_KEY (the project's public anon/publishable key — never the service_role key).",
    )
  }

  const email = requireNonEmpty(env, 'SUPABASE_TEACHER_EMAIL')
  const password = env.SUPABASE_TEACHER_PASSWORD // not trimmed — a password may legitimately start/end with whitespace
  const refreshToken = requireNonEmpty(env, 'SUPABASE_TEACHER_REFRESH_TOKEN')

  let auth: TeacherAuthConfig
  if (email && password) {
    auth = { mode: 'password', email, password }
  } else if (refreshToken) {
    auth = { mode: 'refresh_token', refreshToken }
  } else {
    throw new ConfigError(
      'Missing teacher credentials. Set either (SUPABASE_TEACHER_EMAIL and SUPABASE_TEACHER_PASSWORD) ' +
        'or SUPABASE_TEACHER_REFRESH_TOKEN. This bridge authenticates as a real teacher account through ' +
        'Supabase Auth — the same way the web app does — and must never be given a service_role key.',
    )
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
    auth,
    serviceRoleKeyPresentButIgnored: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
  }
}
