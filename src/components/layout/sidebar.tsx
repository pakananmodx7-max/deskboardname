import { ChevronDown, GraduationCap, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { isGroupActive, isLinkActive, navItems, resolveGroupExpanded, type NavEntry, type NavGroup, type NavLink as NavLinkItem } from '@/components/layout/nav-items'
import { SemesterSelect } from '@/features/semester/semester-select'
import { cn } from '@/lib/utils'

interface SidebarProps {
  mobileOpen: boolean
  onCloseMobile: () => void
}

const LINK_CLASSES =
  'group flex items-center gap-3 rounded-full px-3.5 py-2.5 text-sm font-medium transition-[color,background-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50'
/** A fully filled pill (not just a tint) — the strongest, most obvious
 * "you are here" signal in the nav, matching the same solid-primary
 * pill language used by the segmented filters elsewhere in the app. */
const LINK_ACTIVE = 'bg-sidebar-active text-sidebar-active-foreground shadow-sm'
const LINK_INACTIVE = 'text-sidebar-foreground/80 hover:bg-sidebar-active/10 hover:text-sidebar-foreground'
/** Gradient + soft glow layered on the solid active pill (index.css). */
const ACTIVE_ACCENT = 'kc-nav-active'
/** Inactive icons pick up the primary color on hover. */
const ICON_INACTIVE = 'text-muted-foreground transition-colors group-hover:text-primary'

function NavLeafRow({ item, onNavigate }: { item: NavLinkItem; onNavigate?: () => void }) {
  const { pathname } = useLocation()
  const active = isLinkActive(item, pathname)
  // Plain Link: NavLink would set aria-current from its own exact match
  // only, ignoring activePrefixes.
  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(LINK_CLASSES, active ? cn(LINK_ACTIVE, ACTIVE_ACCENT) : LINK_INACTIVE)}
    >
      <item.icon className={cn('size-[18px] shrink-0', !active && ICON_INACTIVE)} />
      <span className="truncate">{item.label}</span>
      {item.badge && (
        <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
          {item.badge}
        </span>
      )}
    </Link>
  )
}

function groupStorageKey(id: string): string {
  return `krunameclass:sidebar-group:${id}`
}

/** The teacher's last expand/collapse choice for a group (default open). */
function readGroupExpanded(id: string): boolean {
  try {
    return window.localStorage.getItem(groupStorageKey(id)) !== 'collapsed'
  } catch {
    return true
  }
}

function writeGroupExpanded(id: string, expanded: boolean): void {
  try {
    window.localStorage.setItem(groupStorageKey(id), expanded ? 'expanded' : 'collapsed')
  } catch {
    // Private mode / blocked storage — the in-memory state still applies.
  }
}

/**
 * A collapsible group (ระบบจัดการชั้นเรียน). The header is a real button
 * (Enter/Space toggle, aria-expanded + aria-controls); its children are
 * indented links. It opens by itself when one of its children is the
 * current page, and the teacher can still collapse or expand it by hand.
 * The header is never a link, so no destination appears twice.
 */
function NavGroupRow({ group, onNavigate }: { group: NavGroup; onNavigate?: () => void }) {
  const { pathname } = useLocation()
  const active = isGroupActive(group, pathname)
  const [userExpanded, setUserExpanded] = useState(() => readGroupExpanded(group.id))
  const [collapsedOnPath, setCollapsedOnPath] = useState<string | null>(null)
  const expanded = resolveGroupExpanded({ active, userExpanded, collapsedOnPath, pathname })
  const listId = `sidebar-group-${group.id}`

  function toggle() {
    const next = !expanded
    setUserExpanded(next)
    setCollapsedOnPath(next ? null : pathname)
    writeGroupExpanded(group.id, next)
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls={listId}
        className={cn(
          LINK_CLASSES,
          'w-full text-left',
          active ? 'font-semibold text-sidebar-foreground hover:bg-sidebar-active/10' : LINK_INACTIVE,
        )}
      >
        <group.icon className={cn('size-[18px] shrink-0', active ? 'text-primary' : ICON_INACTIVE)} />
        <span className="min-w-0 flex-1 truncate">{group.label}</span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', !expanded && '-rotate-90')} aria-hidden="true" />
      </button>
      {expanded && (
        <ul id={listId} aria-label={group.label} className="ml-5 mt-0.5 space-y-0.5 border-l border-sidebar-border pl-2">
          {group.children.map((child) => (
            <li key={child.to}>
              <NavLeafRow item={child} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function NavEntryRow({ entry, onNavigate }: { entry: NavEntry; onNavigate?: () => void }) {
  if (entry.type === 'link') return <NavLeafRow item={entry} onNavigate={onNavigate} />
  if (entry.type === 'group') return <NavGroupRow group={entry} onNavigate={onNavigate} />
  return (
    <div className="space-y-0.5">
      <p className="px-3 pb-1.5 pt-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/80">
        {entry.label}
      </p>
      {entry.entries.map((child) => (
        <NavEntryRow key={child.type === 'group' ? child.id : child.to} entry={child} onNavigate={onNavigate} />
      ))}
    </div>
  )
}

function SidebarContent({ onNavigate, mobile = false }: { onNavigate?: () => void; mobile?: boolean }) {
  return (
    <div className="kc-sidebar-surface flex h-full flex-col text-sidebar-foreground">
      <div className="flex h-16 items-center gap-2.5 border-b border-sidebar-border px-5">
        <div className="kc-nav-active flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <GraduationCap className="size-5" />
        </div>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-bold tracking-tight text-foreground">KrunameClass</p>
          <p className="truncate text-xs text-muted-foreground">ระบบจัดการห้องเรียน</p>
        </div>
      </div>

      {mobile && (
        // Phones only (the drawer never renders at md+): the header hides
        // its semester selector below sm, so it lives here instead.
        <div className="border-b border-sidebar-border px-4 py-3 sm:hidden">
          <SemesterSelect id="mobile-semester-select" className="w-full [&_select]:w-full [&_select]:max-w-none" />
        </div>
      )}

      <nav aria-label="เมนูหลัก" className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
        {navItems.map((entry) => (
          <NavEntryRow key={entry.type === 'section' ? entry.label : entry.type === 'group' ? entry.id : entry.to} entry={entry} onNavigate={onNavigate} />
        ))}
      </nav>

      <div className="border-t border-sidebar-border px-5 py-4 text-xs text-muted-foreground">
        © 2026 KrunameClass. All rights reserved.
      </div>
    </div>
  )
}

function CompactRailLink({ item, pathname }: { item: NavLinkItem; pathname: string }) {
  const active = isLinkActive(item, pathname)
  return (
    <Link
      to={item.to}
      title={item.label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex size-10 items-center justify-center rounded-full transition-[color,background-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        active ? cn('bg-sidebar-active text-sidebar-active-foreground', ACTIVE_ACCENT) : 'text-sidebar-foreground/80 hover:bg-sidebar-active/10 hover:text-primary',
      )}
    >
      <item.icon className="size-5" />
      <span className="sr-only">{item.label}</span>
    </Link>
  )
}

/** Icon-only rail shown at tablet widths (md–lg), where the full labeled
 * sidebar doesn't fit. Every destination is its own icon + tooltip;
 * there is no room for expand/collapse here, so a group's children are
 * always shown, set apart by a divider. */
function CompactSidebarContent() {
  const { pathname } = useLocation()
  return (
    <div className="kc-sidebar-surface flex h-full flex-col items-center text-sidebar-foreground">
      <div className="flex h-16 w-full items-center justify-center border-b border-sidebar-border">
        <div className="kc-nav-active flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <GraduationCap className="size-5" />
        </div>
      </div>

      <nav aria-label="เมนูหลัก" className="flex flex-1 flex-col items-center gap-1.5 overflow-y-auto py-4">
        {navItems.map((entry) =>
          entry.type === 'group' ? (
            // No room for the group's label at icon width — its children
            // are grouped for assistive tech and set apart by a divider.
            <div key={entry.id} role="group" aria-label={entry.label} className="flex flex-col items-center gap-1.5 border-b border-sidebar-border pb-2">
              {entry.children.map((child) => (
                <CompactRailLink key={child.to} item={child} pathname={pathname} />
              ))}
            </div>
          ) : entry.type === 'link' ? (
            <CompactRailLink key={entry.to} item={entry} pathname={pathname} />
          ) : (
            entry.entries.map((child) =>
              child.type === 'link' ? (
                <CompactRailLink key={child.to} item={child} pathname={pathname} />
              ) : (
                child.children.map((grandchild) => <CompactRailLink key={grandchild.to} item={grandchild} pathname={pathname} />)
              ),
            )
          ),
        )}
      </nav>
    </div>
  )
}

/** Escape closes the phone drawer (it only exists below md). */
function MobileDrawerEscape({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return null
}

export function Sidebar({ mobileOpen, onCloseMobile }: SidebarProps) {
  return (
    <>
      <aside className="hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar lg:block">
        <SidebarContent />
      </aside>

      <aside className="hidden w-16 shrink-0 border-r border-sidebar-border bg-sidebar md:block lg:hidden">
        <CompactSidebarContent />
      </aside>

      {mobileOpen && <MobileDrawerEscape onClose={onCloseMobile} />}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div role="dialog" aria-modal="true" aria-label="เมนูหลัก" className="relative z-10 h-full w-[min(18rem,86vw)] bg-sidebar shadow-elevated">
            <button
              type="button"
              onClick={onCloseMobile}
              className="absolute right-3 top-3 rounded-full p-1.5 text-muted-foreground hover:bg-accent"
              aria-label="ปิดเมนู"
            >
              <X className="size-4" />
            </button>
            <SidebarContent onNavigate={onCloseMobile} mobile />
          </div>
        </div>
      )}
    </>
  )
}
