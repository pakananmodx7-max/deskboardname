import {
  BarChart3,
  BookOpen,
  Bot,
  CalendarCheck,
  GraduationCap,
  LayoutDashboard,
  Plug,
  School,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
}

/**
 * No top-level "Assignments" item on purpose — an assignment always
 * belongs to a specific subject + classroom (never a standalone,
 * classroom-less concept), so it's managed from inside
 * /teacher/subjects/:subjectId/classrooms/:classroomId's งาน tab, not
 * from its own sidebar destination. See /teacher/assignments in
 * router.tsx for what happens to the old direct URL.
 */
export const navItems: NavItem[] = [
  { label: 'Dashboard', to: '/teacher/dashboard', icon: LayoutDashboard },
  { label: 'ห้องเรียน', to: '/teacher/classrooms', icon: School },
  { label: 'Students', to: '/teacher/students', icon: Users },
  { label: 'Subjects', to: '/teacher/subjects', icon: BookOpen },
  { label: 'Attendance', to: '/teacher/attendance', icon: CalendarCheck },
  { label: 'Grades', to: '/teacher/grades', icon: GraduationCap },
  { label: 'Reports', to: '/teacher/reports', icon: BarChart3 },
  { label: 'AI Assistant', to: '/teacher/ai', icon: Bot },
  { label: 'Integrations', to: '/teacher/integrations', icon: Plug },
  { label: 'Settings', to: '/teacher/settings', icon: Settings },
]
