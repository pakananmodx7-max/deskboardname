import { useEffect, useState } from 'react'

import { isSupabaseConfigured, supabase } from '@/lib/supabase'

export type DataMode = 'demo' | 'supabase'

export interface DataModeState {
  /** 'resolving' only while checking for an existing Supabase session on
   * mount (local, no network round trip) — Subject pages should hold off
   * rendering demo OR real content until this settles, to avoid a flash
   * of demo data that then gets replaced by real data underneath the
   * user. Supabase-not-configured resolves to 'ready' synchronously. */
  status: 'resolving' | 'ready'
  mode: DataMode
  teacherId: string | null
}

const DEMO_READY: DataModeState = { status: 'ready', mode: 'demo', teacherId: null }

/**
 * Decides whether Subject/Classroom/Student UI should read from the demo
 * context (mock, in-memory) or the real Supabase-backed services.
 *
 * Deliberately conservative: 'supabase' mode is only ever returned when
 * BOTH Supabase is configured (env vars present) AND a signed-in session
 * actually exists. Configured-but-signed-out falls back to 'demo' rather
 * than showing a broken/empty real UI — there is no login page in this
 * app yet, so "configured but no session" is the expected default state
 * for the deployed demo even when someone points it at a real Supabase
 * project. This is what keeps demo and production data from ever mixing
 * (see docs/DATABASE.md "Demo vs Supabase data mode").
 */
export function useDataMode(): DataModeState {
  const [state, setState] = useState<DataModeState>(() =>
    isSupabaseConfigured ? { status: 'resolving', mode: 'demo', teacherId: null } : DEMO_READY,
  )

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return

    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      const userId = data.session?.user.id ?? null
      setState({ status: 'ready', mode: userId ? 'supabase' : 'demo', teacherId: userId })
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      const userId = session?.user.id ?? null
      setState({ status: 'ready', mode: userId ? 'supabase' : 'demo', teacherId: userId })
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  return state
}
