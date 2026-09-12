import { ChevronDown, GraduationCap, X } from 'lucide-react'
import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

import { flattenNavLinks, isGroupActive, navItems, type NavEntry, type NavGroup, type NavLink as NavLinkItem } from '@/components/layout/nav-items'
import { cn } from '@/lib/utils'

interface SidebarProps {
  mobileOpen: boolean
  onCloseMobile: () => void
}

const LINK_CLASSES =
  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors'
const LINK_ACTIVE = 'bg-primary/10 text-primary'
const LINK_INACTIVE = 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'

function NavLeafRow({ item, indent, onNavigate }: { item: NavLinkItem; indent?: boolean; onNavigate?: () => void }) {
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) => cn(LINK_CLASSES, indent && 'pl-9', isActive ? LINK_ACTIVE : LINK_INACTIVE)}
    >
      <item.icon className="size-4 shrink-0" />
      <span className="truncate">{item.label}</span>
      {item.badge && (
        <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
          {item.badge}
        </span>
      )}
    </NavLink>
  )
}

/** The one collapsible entry in the tree today (ระบบจัดการชั้นเรียน) —
 * clicking the row itself navigates to the module's overview page AND
 * toggles its children open/closed; a chevron gives the same toggle
 * without navigating, for a teacher who just wants to peek at the list. */
function NavGroupRow({ group, onNavigate }: { group: NavGroup; onNavigate?: () => void }) {
  const location = useLocation()
  const active = isGroupActive(group, location.pathname)
  const [expanded, setExpanded] = useState(true)

  return (
    <div>
      <div className={cn(LINK_CLASSES, 'pr-1.5', active ? LINK_ACTIVE : LINK_INACTIVE)}>
        <NavLink to={group.to} onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-3">
          <group.icon className="size-4 shrink-0" />
          <span className="truncate">{group.label}</span>
        </NavLink>
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="shrink-0 rounded p-1 hover:bg-accent"
          aria-label={expanded ? `ย่อ ${group.label}` : `ขยาย ${group.label}`}
          aria-expanded={expanded}
        >
          <ChevronDown className={cn('size-3.5 transition-transform', !expanded && '-rotate-90')} />
        </button>
      </div>
      {expanded && (
        <div className="mt-0.5 space-y-0.5">
          {group.children.map((child) => (
            <NavLeafRow key={child.to} item={child} indent onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  )
}

function NavEntryRow({ entry, onNavigate }: { entry: NavEntry; onNavigate?: () => void }) {
  if (entry.type === 'link') return <NavLeafRow item={entry} onNavigate={onNavigate} />
  if (entry.type === 'group') return <NavGroupRow group={entry} onNavigate={onNavigate} />
  return (
    <div className="space-y-0.5">
      <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        {entry.label}
      </p>
      {entry.entries.map((child) => (
        <NavEntryRow key={child.type === 'group' ? child.to : child.to} entry={child} onNavigate={onNavigate} />
      ))}
    </div>
  )
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2 border-b border-border px-5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <GraduationCap className="size-5" />
        </div>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-bold tracking-tight">ระบบการจัดการชั้นเรียน</p>
          <p className="truncate text-xs text-muted-foreground">จัดทำโดยครูเนม</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navItems.map((entry) => (
          <NavEntryRow key={entry.type === 'section' ? entry.label : entry.to} entry={entry} onNavigate={onNavigate} />
        ))}
      </nav>

      <div className="border-t border-border px-5 py-4 text-xs text-muted-foreground">
        ระบบการจัดการชั้นเรียน
        <br />
        v0.1.0 — Prototype
      </div>
    </div>
  )
}

/** Icon-only rail shown at tablet widths (md–lg) where a full labeled
 * sidebar doesn't fit comfortably but a persistent nav still should,
 * rather than immediately dropping to the mobile hamburger pattern.
 * Renders every real destination FLATTENED (see flattenNavLinks) —
 * there is no room for group/section labels or expand/collapse
 * affordances at icon-only width, so each destination is just its own
 * icon + tooltip, exactly like before this redesign. */
function CompactSidebarContent() {
  const links = flattenNavLinks()
  return (
    <div className="flex h-full flex-col items-center">
      <div className="flex h-16 w-full items-center justify-center border-b border-border">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <GraduationCap className="size-5" />
        </div>
      </div>

      <nav className="flex flex-1 flex-col items-center gap-1 overflow-y-auto py-4">
        {links.map((item) => (
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
