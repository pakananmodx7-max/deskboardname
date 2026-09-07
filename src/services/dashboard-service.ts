import {
  mockAssignments,
  mockAtRiskStudents,
  mockAttendanceSummary,
  mockDashboardStats,
  mockRecentActivity,
} from '@/data/dashboard-mock'
import { mockIntegrationStatus } from '@/data/integration-mock'
import type { DashboardData } from '@/types/dashboard'
import type { IntegrationStatusItem } from '@/types/integration'

/**
 * Service layer boundary for dashboard data.
 * UI components call these functions instead of importing mock data directly,
 * so swapping the mock source for Supabase later only touches this file.
 */
export async function getDashboardData(): Promise<DashboardData> {
  return {
    stats: mockDashboardStats,
    attendance: mockAttendanceSummary,
    atRiskStudents: mockAtRiskStudents,
    assignments: mockAssignments,
    recentActivity: mockRecentActivity,
  }
}

export async function getIntegrationStatus(): Promise<IntegrationStatusItem[]> {
  return mockIntegrationStatus
}
