import { Menu } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'

import { StudentSidebar } from '@/components/layout/student-sidebar'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { useAuth } from '@/lib/auth-context'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { getMyClassrooms, getMyStudentProfile } from '@/services/student-portal-service'
import type { MyClassroom, MyStudentProfile } from '@/types/student-portal'

/**
 * Shell for every /student/* portal page — its own sidebar (never the
 * teacher one), never any /teacher/* link. Loads the signed-in student's
 * own profile + classroom(s) ONCE here (for the sidebar's identity
 * block); each page underneath fetches whatever else it needs itself,
 * matching the rest of this app's per-page data-loading convention.
 *
 * getMyStudentProfile() returning null means "not an approved, linked
 * student" (pending/rejected/never-linked — RLS's students_select_own_linked
 * policy, 0011, only ever returns a row once a teacher has approved the
 * link) — this is the ONE gate that decides whether the portal renders
 * at all, and it is derived entirely server-side from auth.uid(), never
 * from anything client-supplied. A non-approved account is sent back to
 * /student/pending, which already knows how to render the right
 * pending/rejected/no-request-yet state.
 */
export function StudentLayout() {
  const { signOut } = useAuth()
  const navigate = useNavigate()

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [profile, setProfile] = useState<MyStudentProfile | null>(null)
  const [classroom, setClassroom] = useState<MyClassroom | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)

    getMyStudentProfile()
      .then((p) => {
        if (!active) return
        if (!p) {
          navigate('/student/pending', { replace: true })
          return
        }
        setProfile(p)
        return getMyClassrooms().then((classrooms) => {
          if (active) setClassroom(classrooms[0] ?? null)
        })
      })
      .catch((err: unknown) => {
        if (active) setError(toFriendlyErrorMessage(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [navigate])

  async function handleSignOut() {
    await signOut()
    navigate('/student/login', { replace: true })
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">กำลังโหลด...</div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center p-4 text-center text-sm text-destructive">
        {error}
      </div>
    )
  }

  if (!profile) {
    // navigate() above is already redirecting; render nothing while it happens.
    return null
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <StudentSidebar
        profile={profile}
        classroom={classroom}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        onSignOut={handleSignOut}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center gap-3 border-b border-border bg-card px-4 sm:px-6 lg:justify-end">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
          <div className="flex-1 lg:hidden" />
          <ThemeToggle />
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
