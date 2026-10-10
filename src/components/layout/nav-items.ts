import {
  BarChart3,
  BookOpen,
  Bot,
  CalendarCheck,
  ClipboardList,
  FileText,
  LayoutDashboard,
  School,
  Settings,
  type LucideIcon,
} from 'lucide-react'

/** A single, directly-navigable sidebar destination. */
export interface NavLink {
  type: 'link'
  label: string
  to: string
  icon: LucideIcon
  /** Shown as a small muted tag next to the label (e.g. "เร็ว ๆ นี้" for a
   * module that isn't built yet) — never affects navigation, purely a
   * visual hint set expectations before the teacher clicks through. */
  badge?: string
  /** Extra path prefixes that also mark this link active — e.g. a
   * classroom's own page (/teacher/classrooms/:id) belongs to ภาพรวม,
   * where the classroom list now lives. */
  activePrefixes?: string[]
}

/**
 * A collapsible group of links. The group row itself is a toggle (not a
 * link): its destinations are its children, so nothing is listed twice.
 * `id` names the children list for aria-controls and remembers the
 * teacher's expand/collapse choice. Children are plain NavLinks — the
 * sidebar stays at most two levels deep.
 */
export interface NavGroup {
  type: 'group'
  id: string
  label: string
  icon: LucideIcon
  children: NavLink[]
}

/** A plain, non-navigable section divider (e.g. "ระบบของฉัน") — groups
 * a set of modules/entries visually without being a link itself. */
export interface NavSection {
  type: 'section'
  label: string
  entries: (NavLink | NavGroup)[]
}

export type NavEntry = NavLink | NavGroup | NavSection

/**
 * The global teacher sidebar:
 *
 *   ระบบจัดการชั้นเรียน (collapsible group)
 *     ภาพรวม → the unified dashboard (/teacher/dashboard; the old
 *       /teacher/classroom-management and /teacher/classrooms URLs
 *       redirect there — see router.tsx). A classroom's own page
 *       (/teacher/classrooms/:id) also highlights ภาพรวม.
 *     รายวิชา, งานและสื่อการสอน, การเช็คชื่อ, รายงาน
 *   ระบบเอกสาร (coming soon), Hermes Agent, ตั้งค่า
 *
 * งานและสื่อการสอน and การเช็คชื่อ open the existing "เลือกรายวิชาก่อน"
 * entry pages (both are taken per subject + classroom). /teacher/tasks and
 * /teacher/add-module keep their routes but are not linked here.
 */
export const CLASSROOM_GROUP_ID = 'classroom-management'

export const navItems: NavEntry[] = [
  {
    type: 'group',
    id: CLASSROOM_GROUP_ID,
    label: 'ระบบจัดการชั้นเรียน',
    icon: School,
    children: [
      { type: 'link', label: 'ภาพรวม', to: '/teacher/dashboard', icon: LayoutDashboard, activePrefixes: ['/teacher/classrooms'] },
      { type: 'link', label: 'รายวิชา', to: '/teacher/subjects', icon: BookOpen },
      { type: 'link', label: 'งานและสื่อการสอน', to: '/teacher/assignments', icon: ClipboardList },
      { type: 'link', label: 'การเช็คชื่อ', to: '/teacher/attendance', icon: CalendarCheck },
      { type: 'link', label: 'รายงาน', to: '/teacher/reports', icon: BarChart3 },
    ],
  },
  { type: 'link', label: 'ระบบเอกสาร', to: '/teacher/documents', icon: FileText, badge: 'เร็ว ๆ นี้' },
  { type: 'link', label: 'Hermes Agent', to: '/teacher/hermes', icon: Bot },
  { type: 'link', label: 'ตั้งค่า', to: '/teacher/settings', icon: Settings },
]

/** Every real, navigable `to` target across the whole tree, in a flat
 * list — used by the icon-only compact rail (which has no room to
 * render groups/sections, only individual link icons) and by tests
 * that need to check "is this path present anywhere". */
export function flattenNavLinks(entries: NavEntry[] = navItems): NavLink[] {
  const result: NavLink[] = []
  for (const entry of entries) {
    if (entry.type === 'link') result.push(entry)
    else if (entry.type === 'group') result.push(...entry.children)
    else result.push(...flattenNavLinks(entry.entries))
  }
  return result
}

/** True when any child of `group` is active for `pathname` (including a
 * child's activePrefixes, e.g. /teacher/classrooms/:id → ภาพรวม). */
export function isGroupActive(group: NavGroup, pathname: string): boolean {
  return group.children.some((child) => isLinkActive(child, pathname))
}

/**
 * Whether a group is shown expanded:
 *   - open when the teacher left it open (`userExpanded`), or
 *   - open whenever one of its children is the current page, unless the
 *     teacher collapsed it on this very page (`collapsedOnPath`). Moving
 *     to another child page opens it again.
 */
export function resolveGroupExpanded(input: { active: boolean; userExpanded: boolean; collapsedOnPath: string | null; pathname: string }): boolean {
  return input.userExpanded || (input.active && input.collapsedOnPath !== input.pathname)
}

/** NavLink's own exact/sub-path match, plus the link's activePrefixes. */
export function isLinkActive(link: NavLink, pathname: string): boolean {
  const matches = (to: string) => pathname === to || pathname.startsWith(`${to}/`)
  return matches(link.to) || (link.activePrefixes ?? []).some(matches)
}
