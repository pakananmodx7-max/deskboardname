import { dataMode } from '@/lib/data-mode'

import { AttendancePageDemo } from './attendance-page-demo'
import { AttendancePageReal } from './attendance-page-real'

/** See subjects-page.tsx for the demo/real branching rationale. */
export function AttendancePage() {
  return dataMode === 'supabase' ? <AttendancePageReal /> : <AttendancePageDemo />
}
