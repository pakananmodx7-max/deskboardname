import { dataMode } from '@/lib/data-mode'

import { StudentsPageDemo } from './students-page-demo'
import { StudentsPageReal } from './students-page-real'

/** See subjects-page.tsx for the demo/real branching rationale. */
export function StudentsPage() {
  return dataMode === 'supabase' ? <StudentsPageReal /> : <StudentsPageDemo />
}
