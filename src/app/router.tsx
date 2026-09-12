import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'

import { ProtectedRoute } from '@/components/auth/protected-route'
import { StudentProtectedRoute } from '@/components/auth/student-protected-route'
import { StudentLayout } from '@/layouts/student-layout'
import { TeacherLayout } from '@/layouts/teacher-layout'
import { AuthProvider } from '@/lib/auth-context'
import { ForgotPasswordPage } from '@/pages/auth/forgot-password-page'
import { LoginPage } from '@/pages/auth/login-page'
import { ResetPasswordPage } from '@/pages/auth/reset-password-page'
import { SignupPage } from '@/pages/auth/signup-page'
import { RootPage } from '@/pages/root/root-page'
import { StudentAttendancePage } from '@/pages/student/attendance/student-attendance-page'
import { StudentDashboardPage } from '@/pages/student/dashboard/student-dashboard-page'
import { StudentGradesPage } from '@/pages/student/grades/student-grades-page'
import { StudentLinkAccountPage } from '@/pages/student/link-account-page'
import { StudentLoginPage } from '@/pages/student/login-page'
import { StudentPendingPage } from '@/pages/student/pending-page'
import { StudentSignupPage } from '@/pages/student/signup-page'
import { StudentAssignmentDetailPage } from '@/pages/student/subjects/student-assignment-detail-page'
import { StudentSubjectDetailPage } from '@/pages/student/subjects/student-subject-detail-page'
import { StudentSubjectsPage } from '@/pages/student/subjects/student-subjects-page'
import { AiPage } from '@/pages/teacher/ai/ai-page'
import { AssignmentsRedirectPage } from '@/pages/teacher/assignments/assignments-redirect-page'
import { AttendanceRedirectPage } from '@/pages/teacher/attendance/attendance-redirect-page'
import { ClassroomDetailPage } from '@/pages/teacher/classrooms/classroom-detail-page'
import { ClassroomsPage } from '@/pages/teacher/classrooms/classrooms-page'
import { DashboardPage } from '@/pages/teacher/dashboard/dashboard-page'
import { AgentToolsDevPage } from '@/pages/teacher/dev/agent-tools-dev-page'
import { GradesRedirectPage } from '@/pages/teacher/grades/grades-redirect-page'
import { IntegrationsPage } from '@/pages/teacher/integrations/integrations-page'
import { ReportsPage } from '@/pages/teacher/reports/reports-page'
import { SettingsPage } from '@/pages/teacher/settings/settings-page'
import { StudentLinkRequestsPage } from '@/pages/teacher/student-link-requests/student-link-requests-page'
import { StudentsPage } from '@/pages/teacher/students/students-page'
import { SubjectClassroomAssignmentDetailPage } from '@/pages/teacher/subjects/subject-classroom-assignment-detail-page'
import { SubjectClassroomWorkspacePage } from '@/pages/teacher/subjects/subject-classroom-workspace-page'
import { SubjectDetailPage } from '@/pages/teacher/subjects/subject-detail-page'
import { SubjectsPage } from '@/pages/teacher/subjects/subjects-page'

const router = createBrowserRouter([
  {
    path: '/',
    element: <RootPage />,
  },
  { path: 'login', element: <LoginPage /> },
  { path: 'signup', element: <SignupPage /> },
  { path: 'forgot-password', element: <ForgotPasswordPage /> },
  { path: 'reset-password', element: <ResetPasswordPage /> },
  { path: 'student/login', element: <StudentLoginPage /> },
  { path: 'student/signup', element: <StudentSignupPage /> },
  {
    path: 'student/link-account',
    element: (
      <StudentProtectedRoute>
        <StudentLinkAccountPage />
      </StudentProtectedRoute>
    ),
  },
  {
    path: 'student/pending',
    element: (
      <StudentProtectedRoute>
        <StudentPendingPage />
      </StudentProtectedRoute>
    ),
  },
  {
    path: '/student',
    element: (
      <StudentProtectedRoute>
        <StudentLayout />
      </StudentProtectedRoute>
    ),
    children: [
      { index: true, element: <Navigate to="/student/dashboard" replace /> },
      { path: 'dashboard', element: <StudentDashboardPage /> },
      { path: 'subjects', element: <StudentSubjectsPage /> },
      { path: 'subjects/:subjectId', element: <StudentSubjectDetailPage /> },
      { path: 'subjects/:subjectId/assignments/:assignmentId', element: <StudentAssignmentDetailPage /> },
      // งานของฉัน is no longer a standalone sidebar destination — every
      // assignment is reached through its own subject's "งาน" tab now
      // (see the Subject Workspace, student-subject-detail-page.tsx).
      // This route stays only so an old bookmark/link still goes
      // somewhere real instead of 404ing.
      { path: 'assignments', element: <Navigate to="/student/subjects" replace /> },
      { path: 'attendance', element: <StudentAttendancePage /> },
      { path: 'grades', element: <StudentGradesPage /> },
    ],
  },
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
      { path: 'classrooms', element: <ClassroomsPage /> },
      { path: 'classrooms/:classroomId', element: <ClassroomDetailPage /> },
      { path: 'students', element: <StudentsPage /> },
      { path: 'subjects', element: <SubjectsPage /> },
      { path: 'subjects/:subjectId', element: <SubjectDetailPage /> },
      {
        path: 'subjects/:subjectId/classrooms/:classroomId',
        element: <SubjectClassroomWorkspacePage />,
      },
      {
        path: 'subjects/:subjectId/classrooms/:classroomId/assignments/:assignmentId',
        element: <SubjectClassroomAssignmentDetailPage />,
      },
      { path: 'attendance', element: <AttendanceRedirectPage /> },
      { path: 'assignments', element: <AssignmentsRedirectPage /> },
      { path: 'grades', element: <GradesRedirectPage /> },
      { path: 'student-link-requests', element: <StudentLinkRequestsPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'ai', element: <AiPage /> },
      { path: 'integrations', element: <IntegrationsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      // TEMPORARY developer-only diagnostic panel for the Teacher Agent
      // Tool Layer (supabase/functions/teacher-agent-tools) — reachable
      // only by URL, deliberately NOT added to nav-items.ts (whose own
      // test pins the sidebar to an exact 9-item list). Still fully
      // gated by the surrounding <ProtectedRoute>/<TeacherLayout>
      // above: an unauthenticated or student-role session never reaches
      // it, same as every real teacher page. Remove this route once the
      // Teacher Agent Tool Layer has a real (non-diagnostic) UI.
      { path: 'dev/agent-tools', element: <AgentToolsDevPage /> },
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
