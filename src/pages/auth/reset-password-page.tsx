import { ResetPasswordView } from '@/features/password-recovery/reset-password-view'

/** /reset-password — the teacher recovery link's landing page. */
export function ResetPasswordPage() {
  return <ResetPasswordView audience="teacher" />
}
