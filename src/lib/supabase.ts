import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * True only when both env vars are present, so the rest of the app can
 * degrade gracefully (dev-config banners, disabled actions) instead of
 * throwing during module init when Supabase hasn't been set up yet.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

if (!isSupabaseConfigured && import.meta.env.DEV) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. ' +
      'Copy .env.example to .env.local and fill in your project credentials. ' +
      'See docs/SUPABASE_SETUP.md for step-by-step instructions.',
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
