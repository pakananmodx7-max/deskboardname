import { ResetPasswordView } from '@/features/password-recovery/reset-password-view'

/** /student/reset-password — the student recovery link's landing page. */
export function StudentResetPasswordPage() {
  return <ResetPasswordView audience="student" />
}
