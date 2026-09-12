import { DashboardPage } from '@/pages/teacher/dashboard/dashboard-page'

/**
 * ระบบจัดการชั้นเรียน → ภาพรวม (/teacher/classroom-management). This is
 * the SAME Control Center content that used to live at /teacher/dashboard
 * (DashboardPage → DashboardPageReal/DashboardPageDemo), unchanged —
 * only its position in the navigation moved, from the global home route
 * to the classroom management module's own overview page. See
 * home-page.tsx for the NEW global /teacher/dashboard content (a
 * cross-module command center, not a replacement for this page).
 */
export function ClassroomOverviewPage() {
  return <DashboardPage />
}
