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
  /**
   * Omit for the normal teacher signup form (the server-side default —
   * see handle_new_user in 0008_student_account_links.sql). Pass
   * 'student' ONLY from the dedicated /student/signup form. This is
   * safe to trust client-side specifically because 'student' is a
   * strictly LOWER-privileged role than the 'teacher' default in every
   * RLS policy in this schema — see 0008's threat-model comment on
   * handle_new_user for the full reasoning. There is no way to request
   * any OTHER role through this field; the type only allows 'student'.
   */
  intendedRole?: 'student'
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

      // `role` itself is never sent here — the server-side trigger
      // (handle_new_user, 0003 + 0008) is what actually decides the
      // profile's role, and it only ever honors the literal string
      // 'student' from intended_role (anything else, including no
      // signup form ever exists to send anything else in the first
      // place). See SignUpInput's doc comment for why trusting this one
      // narrow, lower-privilege-only signal is safe.
      async signUp({ email, password, displayName, intendedRole }) {
        const client = getSupabaseClient()
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: displayName,
              ...(intendedRole ? { intended_role: intendedRole } : {}),
            },
          },
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
