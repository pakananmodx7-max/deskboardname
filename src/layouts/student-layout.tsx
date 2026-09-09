import { LogOut, Menu } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'

import { AvatarUploadButton } from '@/components/layout/avatar-upload-button'
import { NotificationBell } from '@/components/layout/notification-bell'
import { NotificationToast } from '@/components/layout/notification-toast'
import { StudentSidebar } from '@/components/layout/student-sidebar'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { useAuth } from '@/lib/auth-context'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { StudentNotificationsProvider, useStudentNotificationsContext } from '@/lib/student-notifications-context'
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
    <StudentNotificationsProvider studentId={profile.id}>
      <div className="flex h-screen overflow-hidden bg-background">
        <StudentSidebar
          profile={profile}
          classroom={classroom}
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
          onSignOut={handleSignOut}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <StudentTopBar
            profile={profile}
            classroom={classroom}
            onAvatarChanged={(avatarPath) => setProfile((prev) => (prev ? { ...prev, avatarPath } : prev))}
            onOpenMobileMenu={() => setMobileMenuOpen(true)}
            onSignOut={handleSignOut}
          />

          <main className="flex-1 overflow-y-auto p-4 sm:p-6">
            <Outlet />
          </main>
        </div>
      </div>

      <StudentNotificationToastLayer />
    </StudentNotificationsProvider>
  )
}

/**
 * The "TOP" region from the dashboard redesign spec — avatar, name,
 * code, classroom, notification bell, theme toggle, logout — hoisted
 * into the layout header (present on every /student/* page, not just
 * the dashboard) rather than duplicated as a second header on the
 * dashboard page alone.
 */
function StudentTopBar({
  profile,
  classroom,
  onAvatarChanged,
  onOpenMobileMenu,
  onSignOut,
}: {
  profile: MyStudentProfile
  classroom: MyClassroom | null
  onAvatarChanged: (avatarPath: string | null) => void
  onOpenMobileMenu: () => void
  onSignOut: () => void
}) {
  const { notifications, unreadCount, loading, error, markRead, markAllRead } = useStudentNotificationsContext()

  return (
    <header className="flex h-16 items-center gap-3 border-b border-border bg-card px-4 sm:px-6">
      <button
        type="button"
        onClick={onOpenMobileMenu}
        className="rounded-md p-2 text-muted-foreground hover:bg-accent lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="size-5" />
      </button>

      <AvatarUploadButton avatarPath={profile.avatarPath} firstName={profile.firstName} onChanged={onAvatarChanged} />

      <div className="min-w-0 leading-tight">
        <p className="truncate text-sm font-medium">
          {profile.firstName} {profile.lastName}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {profile.studentCode ? `รหัส ${profile.studentCode}` : '-'}
          {classroom ? ` · ${classroom.name}` : ''}
        </p>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <NotificationBell
          notifications={notifications}
          unreadCount={unreadCount}
          loading={loading}
          error={error}
          onMarkRead={markRead}
          onMarkAllRead={markAllRead}
        />
        <ThemeToggle />
        <button
          type="button"
          onClick={onSignOut}
          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          aria-label="ออกจากระบบ"
        >
          <LogOut className="size-5" />
        </button>
      </div>
    </header>
  )
}

function StudentNotificationToastLayer() {
  const { toastNotification, dismissToast, markRead } = useStudentNotificationsContext()
  return (
    <NotificationToast
      notification={toastNotification}
      onDismiss={dismissToast}
      onView={() => {
        if (toastNotification) markRead(toastNotification.id)
        dismissToast()
      }}
    />
  )
}
