import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'

import { ProtectedRoute } from '@/components/auth/protected-route'
import { TeacherLayout } from '@/layouts/teacher-layout'
import { AuthProvider } from '@/lib/auth-context'
import { ForgotPasswordPage } from '@/pages/auth/forgot-password-page'
import { LoginPage } from '@/pages/auth/login-page'
import { ResetPasswordPage } from '@/pages/auth/reset-password-page'
import { SignupPage } from '@/pages/auth/signup-page'
import { AiPage } from '@/pages/teacher/ai/ai-page'
import { AssignmentsPage } from '@/pages/teacher/assignments/assignments-page'
import { AttendancePage } from '@/pages/teacher/attendance/attendance-page'
import { DashboardPage } from '@/pages/teacher/dashboard/dashboard-page'
import { GradesPage } from '@/pages/teacher/grades/grades-page'
import { IntegrationsPage } from '@/pages/teacher/integrations/integrations-page'
import { ReportsPage } from '@/pages/teacher/reports/reports-page'
import { SettingsPage } from '@/pages/teacher/settings/settings-page'
import { StudentsPage } from '@/pages/teacher/students/students-page'
import { SubjectAssignmentDetailPage } from '@/pages/teacher/subjects/subject-assignment-detail-page'
import { SubjectDetailPage } from '@/pages/teacher/subjects/subject-detail-page'
import { SubjectsPage } from '@/pages/teacher/subjects/subjects-page'

const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/teacher/dashboard" replace />,
  },
  { path: 'login', element: <LoginPage /> },
  { path: 'signup', element: <SignupPage /> },
  { path: 'forgot-password', element: <ForgotPasswordPage /> },
  { path: 'reset-password', element: <ResetPasswordPage /> },
  {
    path: '/teacher',
    element: (
      <ProtectedRoute>
        <TeacherLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <Navigate to="/teacher/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'students', element: <StudentsPage /> },
      { path: 'subjects', element: <SubjectsPage /> },
      { path: 'subjects/:subjectId', element: <SubjectDetailPage /> },
      {
        path: 'subjects/:subjectId/assignments/:assignmentId',
        element: <SubjectAssignmentDetailPage />,
      },
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
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  )
}
