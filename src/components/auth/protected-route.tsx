import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'

import { useAuth } from '@/lib/auth-context'
import { dataMode } from '@/lib/data-mode'

interface ProtectedRouteProps {
  children: ReactNode
}

/**
 * Gate for every /teacher/* route.
 *
 * - Demo mode (Supabase not configured): always renders children. The
 *   interactive demo must stay reachable without signing in at all.
 * - Supabase mode: renders children only once a signed-in session is
 *   confirmed AND that session's profile has actually loaded and is
 *   confirmed NOT role='student'. No session -> redirect to /login.
 *   Still resolving the initial session check, OR signed in but the
 *   profile row hasn't loaded yet -> a lightweight loading state — this
 *   is deliberately stricter than the pre-Student-Portal version (which
 *   rendered as soon as `user` was set, before `profile` arrived): a
 *   student account must never even briefly see the /teacher/* shell,
 *   so this route waits for role to be known one way or the other before
 *   rendering anything. A role='student' session is redirected to
 *   /student/pending rather than being shown any /teacher/* content —
 *   RLS would already block all the actual data (every teacher-scoped
 *   policy in this schema requires classroom ownership a student profile
 *   can never have), but this closes it at the UI layer too, per the
 *   Student Portal's "students must never access /teacher/*" requirement.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { status, user, profile } = useAuth()

  if (dataMode === 'demo') {
    return <>{children}</>
  }

  if (status === 'loading' || (user && !profile)) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        กำลังโหลด...
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (profile?.role === 'student') {
    return <Navigate to="/student/pending" replace />
  }

  return <>{children}</>
}
