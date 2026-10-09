import { DashboardPage } from '@/pages/teacher/dashboard/dashboard-page'

/**
 * ระบบจัดการชั้นเรียน → ภาพรวม (/teacher/classroom-management) — the
 * Classroom Analytics Dashboard (DashboardPage → DashboardPageReal /
 * DashboardPageDemo, see features/classroom-analytics). See
 * home-page.tsx for the global /teacher/dashboard content (a
 * cross-module command center, not a replacement for this page).
 */
export function ClassroomOverviewPage() {
  return <DashboardPage />
}
