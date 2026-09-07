import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

/**
 * True only when both env vars are present, so the rest of the app can
 * degrade gracefully (dev-config banners, disabled actions) instead of
 * throwing during module init when Supabase hasn't been set up yet.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey)
  : null

// Deliberately NOT gated behind import.meta.env.DEV: a deployed build
// (Vercel or otherwise) that silently falls back to demo mode because
// its env vars weren't present at BUILD time is exactly the case this
// needs to be visible for — that's a real support / debugging pain
// point, not a dev-only convenience.
//
// Safe to log unconditionally: this only ever reports WHICH of the two
// named vars is missing, never their values, so there is nothing here
// that leaks a key even partially. Every other place this app
// surfaces a Supabase configuration problem (SupabaseConfigNotice,
// SupabaseNotConfiguredError) follows the same never-print-the-value rule.
if (!isSupabaseConfigured) {
  const missing = [
    !supabaseUrl && 'VITE_SUPABASE_URL',
    !supabasePublishableKey && 'VITE_SUPABASE_PUBLISHABLE_KEY',
  ].filter(Boolean)
  console.warn(
    `[supabase] Missing env var(s): ${missing.join(', ')}. Falling back to demo mode. ` +
      'If you expected real mode here (e.g. this is a deployment with Supabase configured in ' +
      'your host\'s project settings), the most common cause is that the currently-live build ' +
      'predates those variables being added — most hosts (including Vercel) only inject env ' +
      'vars into NEW builds, not retroactively into an already-built deployment. Trigger a fresh ' +
      'deploy after confirming the variable names above match exactly (no typos, no trailing ' +
      'whitespace) and are enabled for the environment you are viewing. ' +
      'See docs/SUPABASE_SETUP.md for setup steps.',
  )
}

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super('Supabase ยังไม่ได้ตั้งค่า กรุณาตั้งค่าการเชื่อมต่อฐานข้อมูลก่อนใช้งาน')
    this.name = 'SupabaseNotConfiguredError'
  }
}

/** Throws a friendly error instead of letting callers hit a null client. */
export function getSupabaseClient(): SupabaseClient {
  if (!supabase) {
    throw new SupabaseNotConfiguredError()
  }
  return supabase
}
