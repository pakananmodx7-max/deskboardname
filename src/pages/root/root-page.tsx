import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'

import { StartupPending } from '@/features/startup/startup-pending'
import { useAuth } from '@/lib/auth-context'
import { dataMode } from '@/lib/data-mode'
import { isRecoveryInProgress } from '@/lib/password-recovery'
import { RoleChoicePage } from '@/pages/root/role-choice-page'
import { deriveMyLinkStatus, getMyLinkRequests } from '@/services/student-link-service'
import type { StudentAccountLinkRequest } from '@/types/student-link-request'

/**
 * Where a signed-in student with the given link-request history should
 * land: no request yet -> the link-account form; approved -> the real
 * dashboard (Student Portal Phase 2, 0011_student_portal_read_access.sql)
 * directly, rather than bouncing through /student/pending's own
 * approved->dashboard redirect; pending/rejected -> /student/pending,
 * which renders the right state for each. Pure so it's testable without
 * rendering anything.
 */
export function deriveStudentRootDestination(requests: StudentAccountLinkRequest[]): string {
  const status = deriveMyLinkStatus(requests)
  if (status.status === 'none') return '/student/link-account'
  if (status.status === 'approved') return '/student/dashboard'
  return '/student/pending'
}

/**
 * "/" — decides, purely from auth state, what a visitor should see:
 *  - demo mode: straight into the interactive demo, same as /login.
 *  - no session: the public role-choice page (teacher vs student).
 *  - teacher/admin session: /teacher/dashboard.
 *  - student session: /student/link-account or /student/pending,
 *    depending on their link-request history (fetched here, since that
 *    history isn't part of the auth-context profile).
 */
export function RootPage() {
  const { status, user, profile } = useAuth()
  const isStudent = profile?.role === 'student'

  const [studentDestination, setStudentDestination] = useState<string | null>(null)

  useEffect(() => {
    if (!isStudent) return
    let active = true
    getMyLinkRequests()
      .then((requests) => {
        if (active) setStudentDestination(deriveStudentRootDestination(requests))
      })
      .catch(() => {
        if (active) setStudentDestination('/student/link-account')
      })
    return () => {
      active = false
    }
  }, [isStudent])

  if (dataMode === 'demo') {
    return <Navigate to="/teacher/dashboard" replace />
  }

  if (status === 'loading' || (user && !profile)) {
    return <StartupPending />
  }

  if (!user) {
    return <RoleChoicePage />
  }

  if (isStudent) {
    // Safety net: a recovery email whose redirect was not allowed lands on
    // the Site URL ("/") — send the student to the reset form instead of
    // into the app with the recovery session.
    if (isRecoveryInProgress()) return <Navigate to="/student/reset-password" replace />
    if (studentDestination === null) {
      return <StartupPending />
    }
    return <Navigate to={studentDestination} replace />
  }

  return <Navigate to="/teacher/dashboard" replace />
}
