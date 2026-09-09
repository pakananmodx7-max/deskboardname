import { GraduationCap, LogOut, X } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import { studentNavItems } from '@/components/layout/student-nav-items'
import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import type { MyClassroom, MyStudentProfile } from '@/types/student-portal'

interface StudentSidebarProps {
  profile: MyStudentProfile | null
  classroom: MyClassroom | null
  mobileOpen: boolean
  onCloseMobile: () => void
  onSignOut: () => void
}

function StudentIdentity({ profile, classroom }: { profile: MyStudentProfile | null; classroom: MyClassroom | null }) {
  const displayName = profile ? `${profile.firstName} ${profile.lastName}` : '-'
  const initials = profile ? profile.firstName.slice(0, 2) : 'นร'

  return (
    <div className="flex items-center gap-3 border-b border-border px-5 py-4">
      <Avatar>{initials}</Avatar>
      <div className="min-w-0 leading-tight">
        <p className="truncate text-sm font-medium">{displayName}</p>
        <p className="truncate text-xs text-muted-foreground">
          {profile?.studentCode ? `รหัส ${profile.studentCode}` : '-'}
          {classroom ? ` · ${classroom.name}` : ''}
        </p>
      </div>
    </div>
  )
}

function StudentSidebarContent({
  profile,
  classroom,
  onSignOut,
  onNavigate,
}: {
  profile: MyStudentProfile | null
  classroom: MyClassroom | null
  onSignOut: () => void
  onNavigate?: () => void
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2 border-b border-border px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <GraduationCap className="size-5" />
        </div>
        <span className="text-sm font-semibold tracking-tight">AI Classroom</span>
      </div>

      <StudentIdentity profile={profile} classroom={classroom} />

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {studentNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )
            }
          >
            <item.icon className="size-4 shrink-0" />
            <span className="truncate">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <button
          type="button"
          onClick={onSignOut}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <LogOut className="size-4 shrink-0" />
          ออกจากระบบ
        </button>
      </div>
    </div>
  )
}

/**
 * The student portal's own sidebar — completely separate component from
 * Sidebar (the teacher one), rendering only studentNavItems and never
 * any /teacher/* link. Same responsive shape (full sidebar on desktop,
 * a slide-over on mobile) as the teacher Sidebar for visual consistency,
 * but nothing is shared between the two beyond that layout pattern.
 */
export function StudentSidebar({ profile, classroom, mobileOpen, onCloseMobile, onSignOut }: StudentSidebarProps) {
  return (
    <>
      <aside className="hidden w-64 shrink-0 border-r border-border bg-card lg:block">
        <StudentSidebarContent profile={profile} classroom={classroom} onSignOut={onSignOut} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={onCloseMobile} aria-hidden="true" />
          <div className="relative z-10 h-full w-64 bg-card shadow-xl">
            <button
              type="button"
              onClick={onCloseMobile}
              className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground hover:bg-accent"
              aria-label="Close menu"
            >
              <X className="size-4" />
            </button>
            <StudentSidebarContent profile={profile} classroom={classroom} onSignOut={onSignOut} onNavigate={onCloseMobile} />
          </div>
        </div>
      )}
    </>
  )
}
