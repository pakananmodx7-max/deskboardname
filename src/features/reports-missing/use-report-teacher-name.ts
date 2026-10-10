import { useAuth } from '@/lib/auth-context'
import { dataMode } from '@/lib/data-mode'

/** The signed-in teacher's display name for the report header and
 * signature (null when the profile has none — never invented). Demo Mode
 * uses the demo teacher shown in the demo header. */
export function useReportTeacherName(): string | null {
  const { profile } = useAuth()
  if (dataMode !== 'supabase') return 'คุณครูสมศรี'
  return profile?.displayName?.trim() || null
}
