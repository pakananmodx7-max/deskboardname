import { dataMode } from '@/lib/data-mode'

import { DashboardPageDemo } from './dashboard-page-demo'
import { DashboardPageReal } from './dashboard-page-real'

/** See subjects-page.tsx for the demo/real branching rationale. */
export function DashboardPage() {
  return dataMode === 'supabase' ? <DashboardPageReal /> : <DashboardPageDemo />
}
