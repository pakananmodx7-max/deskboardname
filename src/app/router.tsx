import { FileText, ListChecks, Plus } from 'lucide-react'
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
import { AssignmentsRedirectPage } from '@/pages/teacher/assignments/assignments-redirect-page'
import { AttendanceRedirectPage } from '@/pages/teacher/attendance/attendance-redirect-page'
import { ClassroomOverviewPage } from '@/pages/teacher/classroom-management/classroom-overview-page'
import { ClassroomDetailPage } from '@/pages/teacher/classrooms/classroom-detail-page'
import { ClassroomsPage } from '@/pages/teacher/classrooms/classrooms-page'
import { ComingSoonModulePage } from '@/pages/teacher/coming-soon/coming-soon-module-page'
import { AgentToolsDevPage } from '@/pages/teacher/dev/agent-tools-dev-page'
import { GradesRedirectPage } from '@/pages/teacher/grades/grades-redirect-page'
import { HermesAgentPage } from '@/pages/teacher/hermes/hermes-agent-page'
import { HomePage } from '@/pages/teacher/home/home-page'
import { IntegrationsPage } from '@/pages/teacher/integrations/integrations-page'
import { ReportsPage } from '@/pages/teacher/reports/reports-page'
import { SettingsPage } from '@/pages/teacher/settings/settings-page'
import { StudentLinkRequestsPage } from '@/pages/teacher/student-link-requests/student-link-requests-page'
import { StudentsSectionLayout } from '@/pages/teacher/students/students-section-layout'
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
      { path: 'dashboard', element: <HomePage /> },
      { path: 'classroom-management', element: <ClassroomOverviewPage /> },
      { path: 'classrooms', element: <ClassroomsPage /> },
      { path: 'classrooms/:classroomId', element: <ClassroomDetailPage /> },
      {
        path: 'students',
        element: <StudentsSectionLayout />,
        children: [
          { index: true, element: <StudentsPage /> },
          { path: 'requests', element: <StudentLinkRequestsPage /> },
        ],
      },
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
      // คำขอเชื่อมบัญชีนักเรียน moved under Students as an in-page tab
      // (Requirement 3) — this old URL/bookmark still goes somewhere real.
      { path: 'student-link-requests', element: <Navigate to="/teacher/students/requests" replace /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'hermes', element: <HermesAgentPage /> },
      // The old AI Assistant demo chat is no longer this app's "AI" story
      // (Requirement 5) — superseded by the Hermes Agent Control Center.
      // ai-page.tsx itself is left in place, untouched, simply unrouted.
      { path: 'ai', element: <Navigate to="/teacher/hermes" replace /> },
      { path: 'integrations', element: <IntegrationsPage /> },
      { path: 'documents', element: <ComingSoonModulePage icon={FileText} title="ระบบเอกสาร" description="จัดเก็บและจัดการเอกสาร แบบฟอร์ม และไฟล์ต่าง ๆ ของคุณในที่เดียว" badge="เร็ว ๆ นี้" /> },
      { path: 'tasks', element: <ComingSoonModulePage icon={ListChecks} title="งานและเตือนความจำ" description="รายการสิ่งที่ต้องทำและการเตือนความจำส่วนตัวของคุณ" badge="เร็ว ๆ นี้" /> },
      { path: 'add-module', element: <ComingSoonModulePage icon={Plus} title="เพิ่มระบบใหม่" description="บอกเราว่าคุณอยากให้เพิ่มระบบอะไรเข้ามาในแพลตฟอร์มนี้ต่อไป" /> },
      { path: 'settings', element: <SettingsPage /> },
      // TEMPORARY developer-only diagnostic panel for the Teacher Agent
      // Tool Layer (supabase/functions/teacher-agent-tools) — reachable
      // only by URL, deliberately NOT added to nav-items.ts. Still fully
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
