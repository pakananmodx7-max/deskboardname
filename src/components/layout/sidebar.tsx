import { GraduationCap, X } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import { navItems } from '@/components/layout/nav-items'
import { cn } from '@/lib/utils'

interface SidebarProps {
  mobileOpen: boolean
  onCloseMobile: () => void
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2 border-b border-border px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <GraduationCap className="size-5" />
        </div>
        <span className="text-sm font-semibold tracking-tight">AI Classroom</span>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navItems.map((item) => (
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

      <div className="border-t border-border px-5 py-4 text-xs text-muted-foreground">
        AI Classroom Management
        <br />
        v0.1.0 — Prototype
      </div>
    </div>
  )
}

/** Icon-only rail shown at tablet widths (md–lg) where a full labeled
 * sidebar doesn't fit comfortably but a persistent nav still should,
 * rather than immediately dropping to the mobile hamburger pattern. */
function CompactSidebarContent() {
  return (
    <div className="flex h-full flex-col items-center">
      <div className="flex h-16 w-full items-center justify-center border-b border-border">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <GraduationCap className="size-5" />
        </div>
      </div>

      <nav className="flex flex-1 flex-col items-center gap-1 overflow-y-auto py-4">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            title={item.label}
            className={({ isActive }) =>
              cn(
                'flex size-10 items-center justify-center rounded-md transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )
            }
          >
            <item.icon className="size-5" />
            <span className="sr-only">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export function Sidebar({ mobileOpen, onCloseMobile }: SidebarProps) {
  return (
    <>
      <aside className="hidden w-64 shrink-0 border-r border-border bg-card lg:block">
        <SidebarContent />
      </aside>

      <aside className="hidden w-16 shrink-0 border-r border-border bg-card md:block lg:hidden">
        <CompactSidebarContent />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full w-64 bg-card shadow-xl">
            <button
              type="button"
              onClick={onCloseMobile}
              className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground hover:bg-accent"
              aria-label="Close menu"
            >
              <X className="size-4" />
            </button>
            <SidebarContent onNavigate={onCloseMobile} />
          </div>
        </div>
      )}
    </>
  )
}
