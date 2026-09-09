import {
  BarChart3,
  BookOpen,
  Bot,
  LayoutDashboard,
  Plug,
  School,
  Settings,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
}

/**
 * No top-level "Attendance", "Assignments", or "Grades" item on
 * purpose — all three always belong to a specific subject + classroom
 * (never a standalone, classroom-less concept), so they're managed from
 * inside /teacher/subjects/:subjectId/classrooms/:classroomId's เช็คชื่อ,
 * งาน, and คะแนน tabs, not from their own sidebar destinations. See
 * /teacher/attendance, /teacher/assignments, and /teacher/grades in
 * router.tsx for what happens to the old direct URLs.
 */
export const navItems: NavItem[] = [
  { label: 'Dashboard', to: '/teacher/dashboard', icon: LayoutDashboard },
  { label: 'ห้องเรียน', to: '/teacher/classrooms', icon: School },
  { label: 'Students', to: '/teacher/students', icon: Users },
  { label: 'Subjects', to: '/teacher/subjects', icon: BookOpen },
  { label: 'คำขอเชื่อมบัญชีนักเรียน', to: '/teacher/student-link-requests', icon: UserCheck },
  { label: 'Reports', to: '/teacher/reports', icon: BarChart3 },
  { label: 'AI Assistant', to: '/teacher/ai', icon: Bot },
  { label: 'Integrations', to: '/teacher/integrations', icon: Plug },
  { label: 'Settings', to: '/teacher/settings', icon: Settings },
]
