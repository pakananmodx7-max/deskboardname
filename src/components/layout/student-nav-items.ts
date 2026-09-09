import { BookOpen, CalendarCheck, ClipboardList, GraduationCap, LayoutDashboard, type LucideIcon } from 'lucide-react'

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
 */
export const studentNavItems: StudentNavItem[] = [
  { label: 'หน้าหลัก', to: '/student/dashboard', icon: LayoutDashboard },
  { label: 'รายวิชาของฉัน', to: '/student/subjects', icon: BookOpen },
  { label: 'งานของฉัน', to: '/student/assignments', icon: ClipboardList },
  { label: 'การเข้าเรียน', to: '/student/attendance', icon: CalendarCheck },
  { label: 'คะแนน', to: '/student/grades', icon: GraduationCap },
]
