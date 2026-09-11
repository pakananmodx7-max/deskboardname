import { loadGooglePickerApi, openGoogleDrivePicker, type PickedDriveFile } from '@/lib/google-picker'
import { getSupabaseClient } from '@/lib/supabase'

export interface GoogleConnectionStatus {
  connected: boolean
  email: string | null
  scope: string | null
  connectedAt: string | null
}

/** Thrown by getDrivePickerAccessToken when Google's own side has
 * invalidated the stored refresh token (the teacher revoked access
 * directly in their Google Account settings, e.g.) — callers should
 * prompt the teacher to reconnect rather than retry silently. */
export class GoogleReauthRequiredError extends Error {
  constructor() {
    super('การเชื่อมต่อ Google หมดอายุ กรุณาเชื่อมต่อใหม่อีกครั้งในหน้าการเชื่อมต่อระบบ')
    this.name = 'GoogleReauthRequiredError'
  }
}

export class GoogleNotConnectedError extends Error {
  constructor() {
    super('กรุณาเชื่อมต่อบัญชี Google ก่อนใช้งาน Google Drive')
    this.name = 'GoogleNotConnectedError'
  }
}

async function invokeFunction<T>(name: string, body?: Record<string, unknown>): Promise<T> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.functions.invoke(name, body ? { body } : undefined)
  if (error) {
    // FunctionsHttpError's `.context` is the raw Response our function
    // returned (see jsonResponse in supabase/functions/_shared/cors.ts)
    // — its body must be read as JSON, it is never pre-parsed for us.
    const context = (error as { context?: Response }).context
    const parsed: { error?: string; code?: string } | null = context ? await context.json().catch(() => null) : null
    if (parsed?.code === 'reauth_required') throw new GoogleReauthRequiredError()
    if (parsed?.code === 'not_connected') throw new GoogleNotConnectedError()
    throw new Error(parsed?.error || error.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อ Google')
  }
  return data as T
}

/** Fetches whether the current teacher has a Google account connected —
 * cheap (never mints a fresh access_token), used by the Integrations
 * page and to decide whether to show "เชื่อมต่อ" vs "ตัดการเชื่อมต่อ". */
export function getGoogleConnectionStatus(): Promise<GoogleConnectionStatus> {
  return invokeFunction<GoogleConnectionStatus>('google-oauth-status')
}

/**
 * Starts the connect flow: asks the Edge Function for Google's consent
 * URL (built server-side with the app's client_id/redirect_uri — never
 * constructed client-side) and navigates the whole page there. Google
 * will redirect back to this exact app's Integrations page with
 * ?code=...&state=... once the teacher approves.
 */
export async function startGoogleConnect(): Promise<void> {
  const { url } = await invokeFunction<{ url: string }>('google-oauth-start')
  window.location.assign(url)
}

/**
 * Call this once, from the Integrations page, when it notices
 * `?code=&state=` in its own URL (i.e. Google just redirected back).
 * The state round-trips through the SAME authenticated session that
 * started the flow — see google-oauth-callback's CSRF check.
 */
export function completeGoogleConnect(code: string, state: string): Promise<{ connected: boolean; email: string | null }> {
  return invokeFunction('google-oauth-callback', { code, state })
}

export async function disconnectGoogleAccount(): Promise<void> {
  await invokeFunction('google-oauth-disconnect')
}

/** Short-lived, drive.file-scoped access token for the Picker only —
 * never persisted client-side beyond the single Picker session it's
 * used for. */
export function getDrivePickerAccessToken(): Promise<string> {
  return invokeFunction<{ accessToken: string }>('google-drive-access-token').then((r) => r.accessToken)
}

/**
 * Opens the Google Drive Picker end to end: mints a fresh access token,
 * loads the Picker script (only actually fetches it once per page
 * load), and resolves with the chosen file or null if the teacher
 * canceled. `VITE_GOOGLE_API_KEY` is a public, HTTP-referrer-restricted
 * key and `VITE_GOOGLE_APP_ID` is the Google Cloud project's numeric
 * project number (both non-secret, see google-picker.ts's doc
 * comments) — missing either is a setup error, surfaced clearly rather
 * than a silent no-op or a confusing Google-side 403.
 */
export async function pickGoogleDriveFile(): Promise<PickedDriveFile | null> {
  const apiKey = import.meta.env.VITE_GOOGLE_API_KEY
  if (!apiKey) {
    throw new Error('ยังไม่ได้ตั้งค่า VITE_GOOGLE_API_KEY — โปรดตรวจสอบการตั้งค่าระบบกับผู้ดูแล')
  }
  const appId = import.meta.env.VITE_GOOGLE_APP_ID
  if (!appId) {
    throw new Error('ยังไม่ได้ตั้งค่า VITE_GOOGLE_APP_ID — โปรดตรวจสอบการตั้งค่าระบบกับผู้ดูแล')
  }
  const accessToken = await getDrivePickerAccessToken()
  await loadGooglePickerApi()
  return openGoogleDrivePicker(accessToken, apiKey, appId)
}
