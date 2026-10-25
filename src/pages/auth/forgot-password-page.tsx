import { RequestRecoveryPage } from '@/features/password-recovery/request-recovery-page'

/** /forgot-password — teacher password recovery; see RequestRecoveryPage. */
export function ForgotPasswordPage() {
  return <RequestRecoveryPage audience="teacher" />
}
