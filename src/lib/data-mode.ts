import { isSupabaseConfigured } from '@/lib/supabase'

export type DataMode = 'demo' | 'supabase'

/**
 * Which system is active for the whole app — decided once, purely from
 * whether Supabase env vars are present. Unlike the Phase 3 version of
 * this constant, this does NOT depend on whether a session exists:
 * "supabase" mode means the real system is what's active (an
 * unauthenticated visitor gets sent to /login by ProtectedRoute, per the
 * auth requirements), and "demo" mode (Supabase not configured at all)
 * means the interactive demo is what's active and never requires login.
 * See src/lib/auth-context.tsx for session/user state within whichever
 * mode is active.
 */
export const dataMode: DataMode = isSupabaseConfigured ? 'supabase' : 'demo'
