import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'

import { TeacherLayout } from '@/layouts/teacher-layout'
import { AiPage } from '@/pages/teacher/ai/ai-page'
import { AssignmentsPage } from '@/pages/teacher/assignments/assignments-page'
import { AttendancePage } from '@/pages/teacher/attendance/attendance-page'
import { DashboardPage } from '@/pages/teacher/dashboard/dashboard-page'
import { GradesPage } from '@/pages/teacher/grades/grades-page'
import { IntegrationsPage } from '@/pages/teacher/integrations/integrations-page'
import { ReportsPage } from '@/pages/teacher/reports/reports-page'
import { SettingsPage } from '@/pages/teacher/settings/settings-page'
import { StudentsPage } from '@/pages/teacher/students/students-page'

const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/teacher/dashboard" replace />,
  },
  {
    path: '/teacher',
    element: <TeacherLayout />,
    children: [
      { index: true, element: <Navigate to="/teacher/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'students', element: <StudentsPage /> },
      { path: 'attendance', element: <AttendancePage /> },
      { path: 'assignments', element: <AssignmentsPage /> },
      { path: 'grades', element: <GradesPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'ai', element: <AiPage /> },
      { path: 'integrations', element: <IntegrationsPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/teacher/dashboard" replace />,
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
