import { dataMode } from '@/lib/data-mode'

import { ClassroomsPageDemo } from './classrooms-page-demo'
import { ClassroomsPageReal } from './classrooms-page-real'

/** See subjects-page.tsx for the demo/real branching rationale. */
export function ClassroomsPage() {
  return dataMode === 'supabase' ? <ClassroomsPageReal /> : <ClassroomsPageDemo />
}
