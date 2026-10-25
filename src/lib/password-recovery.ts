/**
 * Password-recovery link state, read from the URL at startup.
 *
 * Supabase's recovery email links to /auth/v1/verify, which redirects to
 * our redirect_to URL with either
 *   - a session in the hash: #access_token=…&refresh_token=…&type=recovery
 *     (the default template, implicit flow — supabase-js signs in with it
 *     and clears the hash), or
 *   - an error in the hash/query: #error=access_denied&error_code=otp_expired
 *     (expired, already used or invalid link — supabase-js leaves it there).
 * A template that links straight to the app may instead send
 *   ?token_hash=…&type=recovery, verified by the reset page itself.
 *
 * supabase-js reads and clears the hash asynchronously, so this module is
 * imported by lib/supabase.ts *before* the client is created and records
 * only what kind of link it was — never the tokens. The "recovery in
 * progress" mark lives in sessionStorage (this tab only) so a reload of the
 * reset page keeps working, and is cleared once the password is changed.
 */

const RECOVERY_KEY = 'kc-password-recovery'

export interface RecoveryLinkError {
  code: string
  description: string
}

interface CapturedLink {
  /** The URL carried a recovery session (or a token_hash to verify). */
  recovery: boolean
  tokenHash: string | null
  error: RecoveryLinkError | null
}

function readParams(href: string): URLSearchParams {
  const url = new URL(href)
  const params = new URLSearchParams(url.search)
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
  for (const [key, value] of new URLSearchParams(hash)) params.set(key, value)
  return params
}

/** Pure: what kind of auth link is this URL? (exported for tests) */
export function parseRecoveryLink(href: string): CapturedLink {
  let params: URLSearchParams
  try {
    params = readParams(href)
  } catch {
    return { recovery: false, tokenHash: null, error: null }
  }
  const type = params.get('type')
  const errorCode = params.get('error_code') ?? params.get('error')
  const error = errorCode ? { code: errorCode, description: params.get('error_description') ?? '' } : null
  const tokenHash = type === 'recovery' ? params.get('token_hash') : null
  const recovery = type === 'recovery' && (params.has('access_token') || Boolean(tokenHash))
  return { recovery, tokenHash, error }
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

let captured: CapturedLink = { recovery: false, tokenHash: null, error: null }

/** Runs once, before the Supabase client is created (see lib/supabase.ts). */
export function captureRecoveryLink(href: string = typeof window === 'undefined' ? '' : window.location.href) {
  if (!href) return
  captured = parseRecoveryLink(href)
  if (captured.recovery) markRecoveryInProgress()
}

/** The recovery email's link (or a reload of the reset page) brought us here. */
export function isRecoveryInProgress(): boolean {
  return captured.recovery || storage()?.getItem(RECOVERY_KEY) === '1'
}

export function markRecoveryInProgress() {
  storage()?.setItem(RECOVERY_KEY, '1')
}

export function clearRecoveryState() {
  storage()?.removeItem(RECOVERY_KEY)
  captured = { recovery: false, tokenHash: null, error: null }
}

/** An error the auth server put in the link (expired / used / invalid). */
export function recoveryLinkError(): RecoveryLinkError | null {
  return captured.error
}

/** token_hash from a template that links straight to the app. */
export function recoveryTokenHash(): string | null {
  return captured.tokenHash
}

/** Drop any token, token_hash or error from the address bar (history too). */
export function scrubAuthParamsFromUrl() {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  const sensitive = ['access_token', 'refresh_token', 'token_hash', 'token', 'type', 'code', 'error', 'error_code', 'error_description', 'expires_at', 'expires_in', 'token_type', 'provider_token']
  // supabase-js empties the hash but leaves a bare '#' behind.
  let changed = window.location.href.includes('#')
  for (const key of sensitive) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key)
      changed = true
    }
  }
  if (!changed) return
  url.hash = ''
  window.history.replaceState(window.history.state, '', url.pathname + url.search)
}

/** Thai text for an error the auth server put in the link. */
export function recoveryLinkErrorMessage(error: RecoveryLinkError | null): string {
  if (error && /otp_expired|expired/i.test(`${error.code} ${error.description}`)) {
    return 'ลิงก์ตั้งรหัสผ่านใหม่หมดอายุหรือถูกใช้ไปแล้ว'
  }
  return 'ลิงก์ตั้งรหัสผ่านใหม่ไม่ถูกต้องหรือหมดอายุ'
}
