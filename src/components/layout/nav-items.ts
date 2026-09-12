import {
  Award,
  BarChart3,
  Bot,
  CalendarCheck,
  ClipboardList,
  FileText,
  Home,
  ListChecks,
  Plus,
  School,
  Settings,
  Users,
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
}

/**
 * A collapsible module: clicking its own row navigates to `to` (the
 * module's landing/overview page) AND toggles the expand state; its
 * `children` are always plain NavLinks, never another nested group —
 * this app's IA intentionally stays at 2 levels of real nesting (see
 * the design goal "avoid unnecessary nested navigation"). A 3rd level
 * (e.g. Students' own "รายชื่อนักเรียน"/"คำขอเชื่อมบัญชี" split) is
 * handled with in-page tabs instead of more sidebar depth — see
 * students-section-layout.tsx.
 */
export interface NavGroup {
  type: 'group'
  label: string
  to: string
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
 * The global sidebar's structure — a personal management PLATFORM, with
 * the existing classroom features grouped under exactly one module
 * ("ระบบจัดการชั้นเรียน"). New systems are added as more entries inside
 * the "ระบบของฉัน" section (ระบบเอกสาร/งานและเตือนความจำ today are
 * placeholders — see coming-soon-module-page.tsx), never as additional
 * top-level rows, so the sidebar itself does not grow more cluttered as
 * more systems arrive. Hermes Agent and Settings stay OUTSIDE "ระบบของฉัน"
 * deliberately: Hermes is a cross-system agent (it may eventually act on
 * more than just classroom management), not a feature that belongs to
 * any one module — see hermes-agent-page.tsx's own doc comment.
 *
 * No top-level "Attendance", "Assignments", or "Grades" item on
 * purpose — all three always belong to a specific subject + classroom
 * (never a standalone, classroom-less concept), so their sidebar
 * entries below point at the SAME existing "please pick a subject first"
 * redirect pages every old bookmark to /teacher/attendance,
 * /teacher/assignments, or /teacher/grades already lands on (see
 * router.tsx) — nothing new was built for them, and nothing about how
 * attendance/assignments/grades actually work changed.
 */
export const navItems: NavEntry[] = [
  { type: 'link', label: 'หน้าหลัก', to: '/teacher/dashboard', icon: Home },
  {
    type: 'section',
    label: 'ระบบของฉัน',
    entries: [
      {
        type: 'group',
        label: 'ระบบจัดการชั้นเรียน',
        to: '/teacher/classroom-management',
        icon: School,
        children: [
          { type: 'link', label: 'ภาพรวม', to: '/teacher/classroom-management', icon: Home },
          { type: 'link', label: 'ห้องเรียน', to: '/teacher/classrooms', icon: School },
          { type: 'link', label: 'นักเรียน', to: '/teacher/students', icon: Users },
          { type: 'link', label: 'รายวิชา', to: '/teacher/subjects', icon: FileText },
          { type: 'link', label: 'งานและการบ้าน', to: '/teacher/assignments', icon: ClipboardList },
          { type: 'link', label: 'เช็กชื่อ', to: '/teacher/attendance', icon: CalendarCheck },
          { type: 'link', label: 'คะแนนและการประเมิน', to: '/teacher/grades', icon: Award },
          { type: 'link', label: 'รายงาน', to: '/teacher/reports', icon: BarChart3 },
        ],
      },
      { type: 'link', label: 'ระบบเอกสาร', to: '/teacher/documents', icon: FileText, badge: 'เร็ว ๆ นี้' },
      { type: 'link', label: 'งานและเตือนความจำ', to: '/teacher/tasks', icon: ListChecks, badge: 'เร็ว ๆ นี้' },
      { type: 'link', label: 'เพิ่มระบบใหม่', to: '/teacher/add-module', icon: Plus },
    ],
  },
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

/** True when `pathname` is exactly one of `group`'s children's `to`, or a
 * sub-path of one (e.g. "/teacher/students/requests" still counts as
 * "นักเรียน" being active) — used to auto-expand the module and
 * highlight it even when the URL was typed/bookmarked directly rather
 * than reached by clicking through the sidebar. */
export function isGroupActive(group: NavGroup, pathname: string): boolean {
  return group.children.some((child) => pathname === child.to || pathname.startsWith(`${child.to}/`))
}
