import { RequestRecoveryPage } from '@/features/password-recovery/request-recovery-page'

/** /student/forgot-password — see RequestRecoveryPage. */
export function StudentForgotPasswordPage() {
  return <RequestRecoveryPage audience="student" />
}
