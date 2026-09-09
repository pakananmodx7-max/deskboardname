import { BookOpen, CalendarCheck, GraduationCap, LayoutDashboard, type LucideIcon } from 'lucide-react'

export interface StudentNavItem {
  label: string
  to: string
  icon: LucideIcon
}

/**
 * The student portal's own nav — completely separate from navItems.ts
 * (the teacher sidebar). A student account must never see any
 * /teacher/* destination; this list is the only navigation
 * StudentSidebar ever renders.
 *
 * No standalone "งานของฉัน" entry — "รายวิชาของฉัน" (/student/subjects) is
 * the one academic hub; every assignment is reached through its subject's
 * own "งาน" tab (see the Subject Workspace, student-subject-detail-page.tsx),
 * never a second, competing flat assignment list. The old
 * /student/assignments route still exists as a redirect into
 * /student/subjects for any bookmarked/old link, but it is deliberately
 * not in this nav list.
 */
export const studentNavItems: StudentNavItem[] = [
  { label: 'หน้าหลัก', to: '/student/dashboard', icon: LayoutDashboard },
  { label: 'รายวิชาของฉัน', to: '/student/subjects', icon: BookOpen },
  { label: 'การเข้าเรียน', to: '/student/attendance', icon: CalendarCheck },
  { label: 'คะแนน', to: '/student/grades', icon: GraduationCap },
]
