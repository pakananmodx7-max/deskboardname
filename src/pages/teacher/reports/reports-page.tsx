import { dataMode } from '@/lib/data-mode'

import { ReportsPageDemo } from './reports-page-demo'
import { ReportsPageReal } from './reports-page-real'

/** See subjects-page.tsx for the demo/real branching rationale. */
export function ReportsPage() {
  return dataMode === 'supabase' ? <ReportsPageReal /> : <ReportsPageDemo />
}
