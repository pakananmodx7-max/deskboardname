import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'

import { useAuth } from '@/lib/auth-context'
import { dataMode } from '@/lib/data-mode'

interface StudentProtectedRouteProps {
  children: ReactNode
}

/**
 * Gate for /student/link-account and /student/pending — requires a
 * signed-in session, same "wait for profile before rendering" caution as
 * ProtectedRoute (/teacher/*), but does not redirect a teacher account
 * away: reaching these pages as a teacher is meaningless (every write
 * here is RLS-gated to role='student' regardless — see
 * student_account_link_requests_insert_own in
 * 0008_student_account_links.sql) but not a security concern, so it's
 * simply left as an inert page rather than an extra redirect branch to
 * maintain and reason about. /student/login and /student/signup are
 * intentionally NOT behind this gate — like /login and /signup, they
 * must be reachable without a session at all.
 */
export function StudentProtectedRoute({ children }: StudentProtectedRouteProps) {
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
    return <Navigate to="/student/login" replace />
  }

  return <>{children}</>
}
