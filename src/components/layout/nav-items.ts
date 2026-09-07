import {
  BarChart3,
  BookOpen,
  Bot,
  CalendarCheck,
  ClipboardList,
  GraduationCap,
  LayoutDashboard,
  Plug,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
}

export const navItems: NavItem[] = [
  { label: 'Dashboard', to: '/teacher/dashboard', icon: LayoutDashboard },
  { label: 'Students', to: '/teacher/students', icon: Users },
  { label: 'Subjects', to: '/teacher/subjects', icon: BookOpen },
  { label: 'Attendance', to: '/teacher/attendance', icon: CalendarCheck },
  { label: 'Assignments', to: '/teacher/assignments', icon: ClipboardList },
  { label: 'Grades', to: '/teacher/grades', icon: GraduationCap },
  { label: 'Reports', to: '/teacher/reports', icon: BarChart3 },
  { label: 'AI Assistant', to: '/teacher/ai', icon: Bot },
  { label: 'Integrations', to: '/teacher/integrations', icon: Plug },
  { label: 'Settings', to: '/teacher/settings', icon: Settings },
]
