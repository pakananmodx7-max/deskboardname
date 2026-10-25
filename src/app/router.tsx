import { ListChecks, Plus } from 'lucide-react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'

import { ProtectedRoute } from '@/components/auth/protected-route'
import { StudentProtectedRoute } from '@/components/auth/student-protected-route'
import { StudentLayout } from '@/layouts/student-layout'
import { TeacherLayout } from '@/layouts/teacher-layout'
import { SemesterProvider } from '@/features/semester/semester-context'
import { StartupGate } from '@/features/startup/startup-gate'
import { AuthProvider } from '@/lib/auth-context'
import { ENABLE_TEACHER_REGISTRATION } from '@/lib/feature-flags'
import { ForgotPasswordPage } from '@/pages/auth/forgot-password-page'
import { LoginPage } from '@/pages/auth/login-page'
import { ResetPasswordPage } from '@/pages/auth/reset-password-page'
import { SignupPage } from '@/pages/auth/signup-page'
import { RootPage } from '@/pages/root/root-page'
import { StudentAttendancePage } from '@/pages/student/attendance/student-attendance-page'
import { StudentDashboardPage } from '@/pages/student/dashboard/student-dashboard-page'
import { StudentForgotPasswordPage } from '@/pages/student/forgot-password-page'
import { StudentGradesPage } from '@/pages/student/grades/student-grades-page'
import { StudentLinkAccountPage } from '@/pages/student/link-account-page'
import { StudentLoginPage } from '@/pages/student/login-page'
import { StudentPendingPage } from '@/pages/student/pending-page'
import { StudentResetPasswordPage } from '@/pages/student/reset-password-page'
import { StudentSignupPage } from '@/pages/student/signup-page'
import { StudentAssignmentDetailPage } from '@/pages/student/subjects/student-assignment-detail-page'
import { StudentSubjectDetailPage } from '@/pages/student/subjects/student-subject-detail-page'
import { StudentSubjectsPage } from '@/pages/student/subjects/student-subjects-page'
import { AssignmentsRedirectPage } from '@/pages/teacher/assignments/assignments-redirect-page'
import { AttendanceRedirectPage } from '@/pages/teacher/attendance/attendance-redirect-page'
import { ClassroomDetailPage } from '@/pages/teacher/classrooms/classroom-detail-page'
import { ComingSoonModulePage } from '@/pages/teacher/coming-soon/coming-soon-module-page'
import { DocumentCenterPage } from '@/pages/teacher/documents/document-center-page'
import { DashboardPage } from '@/pages/teacher/dashboard/dashboard-page'
import { AgentToolsDevPage } from '@/pages/teacher/dev/agent-tools-dev-page'
import { GradesRedirectPage } from '@/pages/teacher/grades/grades-redirect-page'
import { HermesAgentPage } from '@/pages/teacher/hermes/hermes-agent-page'
import { IntegrationsPage } from '@/pages/teacher/integrations/integrations-page'
import { AttendanceReportPrintPage } from '@/pages/teacher/reports/attendance-report-print-page'
import { MissingReportPrintPage } from '@/pages/teacher/reports/missing-report-print-page'
import { ReportsPage } from '@/pages/teacher/reports/reports-page'
import { SettingsPage } from '@/pages/teacher/settings/settings-page'
import { StudentLinkRequestsPage } from '@/pages/teacher/student-link-requests/student-link-requests-page'
import { StudentsSectionLayout } from '@/pages/teacher/students/students-section-layout'
import { StudentsPage } from '@/pages/teacher/students/students-page'
import { StudentAnalyticsPage } from '@/pages/teacher/subjects/student-analytics-page'
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
  // Teacher self-registration is behind ENABLE_TEACHER_REGISTRATION
  // (off for now): a direct visit goes to the teacher login page. The
  // database refuses new teacher accounts on its own as well (0028).
  { path: 'signup', element: ENABLE_TEACHER_REGISTRATION ? <SignupPage /> : <Navigate to="/login" replace /> },
  { path: 'forgot-password', element: <ForgotPasswordPage /> },
  { path: 'reset-password', element: <ResetPasswordPage /> },
  { path: 'student/login', element: <StudentLoginPage /> },
  { path: 'student/signup', element: <StudentSignupPage /> },
  // Student password recovery — public (no guard), so a recovery link is
  // never redirected away before the new password is saved.
  { path: 'student/forgot-password', element: <StudentForgotPasswordPage /> },
  { path: 'student/reset-password', element: <StudentResetPasswordPage /> },
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
  // A4 print preview of Reports → งานค้างส่ง — outside the teacher layout
  // so no sidebar/top bar reaches the paper; same auth guard and shared
  // semester selection as the teacher area.
  {
    path: '/teacher/reports/attendance/print',
    element: (
      <ProtectedRoute>
        <SemesterProvider>
          <AttendanceReportPrintPage />
        </SemesterProvider>
      </ProtectedRoute>
    ),
  },
  {
    path: '/teacher/reports/missing/print',
    element: (
      <ProtectedRoute>
        <SemesterProvider>
          <MissingReportPrintPage />
        </SemesterProvider>
      </ProtectedRoute>
    ),
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
      // The unified dashboard — former home, classroom overview and
      // classroom list in one page. The two retired URLs redirect here
      // (one hop, to a route that never redirects back — no loop).
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'classroom-management', element: <Navigate to="/teacher/dashboard" replace /> },
      { path: 'classrooms', element: <Navigate to="/teacher/dashboard#classrooms" replace /> },
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
      {
        path: 'subjects/:subjectId/classrooms/:classroomId/students/:studentId/analytics',
        element: <StudentAnalyticsPage />,
      },
      // The standalone attendance page was removed (attendance lives in each
      // subject's เช็คชื่อ tab); old URLs only redirect — see the page.
      { path: 'attendance', element: <AttendanceRedirectPage /> },
      { path: 'attendance/*', element: <AttendanceRedirectPage /> },
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
      { path: 'documents', element: <DocumentCenterPage /> },
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
      <StartupGate>
        <RouterProvider router={router} />
      </StartupGate>
    </AuthProvider>
  )
}
