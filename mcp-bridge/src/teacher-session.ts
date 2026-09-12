import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'

import type { BridgeConfig } from './config.js'
import { scrub } from './logger.js'

/**
 * Thrown whenever the bridge cannot obtain or keep a valid teacher
 * session — bad credentials at startup, or a refresh token that has
 * since been revoked/expired mid-run. `.message` is always built by
 * THIS class from a fixed, safe string plus (optionally) the Supabase
 * Auth API's own error message run through `scrub()` — never the raw
 * credential, refresh token, or access token.
 */
export class TeacherAuthError extends Error {}

const EXPIRY_SAFETY_MARGIN_MS = 60_000

/**
 * Holds exactly one teacher's Supabase Auth session for the lifetime of
 * the bridge process. This is the ONLY place a bearer token exists in
 * memory; `ensureValidSession()` is the ONLY way any other module gets
 * one, and it always returns a fresh, non-expiring-soon token — callers
 * never need to think about expiry themselves.
 *
 * Deliberately uses `autoRefreshToken: false` on the underlying
 * supabase-js client: refresh timing is handled explicitly here
 * (checked before every Edge Function call) rather than via a
 * background timer, so behavior is the same whether this runs as a
 * long-lived process or is invoked once and exits, and so it can be
 * unit tested without relying on real timers.
 */
export class TeacherSession {
  private readonly client: SupabaseClient
  private readonly config: BridgeConfig
  private session: Session | null = null

  constructor(config: BridgeConfig, client?: SupabaseClient) {
    this.config = config
    this.client =
      client ??
      createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
  }

  /** Returns a valid, not-about-to-expire access token — signing in or
   * refreshing first if needed. Safe to call before every request. */
  async ensureValidSession(): Promise<string> {
    if (this.session && !this.isExpiringSoon(this.session)) {
      return this.session.access_token
    }
    return this.reauthenticate()
  }

  /** Forces a fresh session regardless of the cached one's expiry —
   * used by edge-function-client.ts's single retry-after-401 path,
   * since a token can be rejected server-side even when our own clock
   * still thinks it has time left. */
  async reauthenticate(): Promise<string> {
    if (this.session) {
      try {
        this.session = await this.refresh(this.session.refresh_token)
        return this.session.access_token
      } catch {
        // Falls through to a full re-authentication below — the cached
        // refresh token may itself be the thing that's now invalid.
      }
    }
    this.session = await this.authenticate()
    return this.session.access_token
  }

  private isExpiringSoon(session: Session): boolean {
    if (!session.expires_at) return true
    return session.expires_at * 1000 - Date.now() < EXPIRY_SAFETY_MARGIN_MS
  }

  private async authenticate(): Promise<Session> {
    if (this.config.auth.mode === 'password') {
      const { data, error } = await this.client.auth.signInWithPassword({
        email: this.config.auth.email,
        password: this.config.auth.password,
      })
      if (error || !data.session) {
        throw new TeacherAuthError(
          `Teacher sign-in failed (SUPABASE_TEACHER_EMAIL/SUPABASE_TEACHER_PASSWORD). ${
            error ? scrub(error.message) : 'No session was returned.'
          }`,
        )
      }
      return data.session
    }
    return this.refresh(this.config.auth.refreshToken)
  }

  private async refresh(refreshToken: string): Promise<Session> {
    const { data, error } = await this.client.auth.refreshSession({ refresh_token: refreshToken })
    if (error || !data.session) {
      throw new TeacherAuthError(
        'Teacher session expired or was revoked, and the refresh token no longer works. ' +
          'Restart the bridge with a fresh SUPABASE_TEACHER_REFRESH_TOKEN, or switch to ' +
          `SUPABASE_TEACHER_EMAIL/SUPABASE_TEACHER_PASSWORD. ${error ? scrub(error.message) : ''}`.trim(),
      )
    }
    return data.session
  }
}
