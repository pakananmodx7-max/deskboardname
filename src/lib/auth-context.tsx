import type { Session, User } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { dataMode } from '@/lib/data-mode'
import { getSupabaseClient, supabase } from '@/lib/supabase'
import type { Profile } from '@/types/profile'

interface ProfileRow {
  id: string
  display_name: string | null
  email: string | null
  role: Profile['role']
  created_at: string
  updated_at: string
}

function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

interface AuthState {
  /** 'loading' only while checking for an existing session on mount
   * (local, no network round trip in the common case) — ProtectedRoute
   * holds off deciding "redirect to /login" vs "render" until this
   * settles, so a page reload on an authenticated session never flashes
   * a login redirect before the session is found. */
  status: 'loading' | 'ready'
  user: User | null
  profile: Profile | null
}

export interface SignUpInput {
  email: string
  password: string
  displayName: string
}

interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<void>
  /** Returns whether Supabase requires email confirmation before this
   * account can sign in (project-setting dependent) — the signup page
   * uses this to decide whether to redirect straight in or show a "check
   * your email" message. */
  signUp: (input: SignUpInput) => Promise<{ needsEmailConfirmation: boolean }>
  signOut: () => Promise<void>
  sendPasswordReset: (email: string) => Promise<void>
  updatePassword: (newPassword: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function fetchProfile(userId: string): Promise<Profile | null> {
  const client = getSupabaseClient()
  const { data, error } = await client.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) throw error
  return data ? mapProfile(data as ProfileRow) : null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() =>
    dataMode === 'supabase' ? { status: 'loading', user: null, profile: null } : { status: 'ready', user: null, profile: null },
  )

  const loadProfile = useCallback((userId: string) => {
    fetchProfile(userId)
      .then((profile) => setState((prev) => (prev.user?.id === userId ? { ...prev, profile } : prev)))
      .catch(() => {
        // A profile fetch failing shouldn't block the signed-in state —
        // the header just shows no display name until it can be loaded.
      })
  }, [])

  const applySession = useCallback(
    (session: Session | null) => {
      const user = session?.user ?? null
      setState((prev) => {
        // Same user as before (e.g. a token refresh firing this same
        // event) — keep the already-loaded profile instead of nulling it
        // out and re-fetching, so the header name doesn't flicker away.
        if (prev.user?.id === user?.id) {
          return { ...prev, status: 'ready', user }
        }
        return { status: 'ready', user, profile: null }
      })
      if (user) loadProfile(user.id)
    },
    [loadProfile],
  )

  useEffect(() => {
    if (dataMode !== 'supabase' || !supabase) return

    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (active) applySession(data.session)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) applySession(session)
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [applySession])

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,

      async signIn(email, password) {
        const client = getSupabaseClient()
        const { error } = await client.auth.signInWithPassword({ email, password })
        if (error) throw error
      },

      // `role` is never sent here — there is no role field in the signup
      // form at all, and the server-side trigger (handle_new_user in
      // 0003_auth_profile.sql) hardcodes every new account to 'teacher'
      // regardless of anything a client sends in options.data. This
      // function only ever passes displayName through as metadata.
      async signUp({ email, password, displayName }) {
        const client = getSupabaseClient()
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName } },
        })
        if (error) throw error
        return { needsEmailConfirmation: !data.session }
      },

      async signOut() {
        const client = getSupabaseClient()
        const { error } = await client.auth.signOut()
        if (error) throw error
      },

      async sendPasswordReset(email) {
        const client = getSupabaseClient()
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        })
        if (error) throw error
      },

      async updatePassword(newPassword) {
        const client = getSupabaseClient()
        const { error } = await client.auth.updateUser({ password: newPassword })
        if (error) throw error
      },
    }),
    [state],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
