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
 *   confirmed. No session -> redirect to /login. Still resolving the
 *   initial session check -> a lightweight loading state, never a
 *   flash of teacher data before the auth check has actually finished.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { status, user } = useAuth()

  if (dataMode === 'demo') {
    return <>{children}</>
  }

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        กำลังโหลด...
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
