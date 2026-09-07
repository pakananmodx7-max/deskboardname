import type { ActivityItem } from './activity'
import type { AssignmentSummary } from './assignment'
import type { AttendanceSummary } from './attendance'
import type { AtRiskStudent } from './risk'

export interface DashboardStats {
  totalStudents: number
  presentToday: number
  attendanceRate: number
  missingAssignments: number
  studentsAtRisk: number
}

export interface DashboardData {
  stats: DashboardStats
  attendance: AttendanceSummary
  atRiskStudents: AtRiskStudent[]
  assignments: AssignmentSummary[]
  recentActivity: ActivityItem[]
}

export * from './activity'
export * from './assignment'
export * from './attendance'
export * from './integration'
export * from './risk'
