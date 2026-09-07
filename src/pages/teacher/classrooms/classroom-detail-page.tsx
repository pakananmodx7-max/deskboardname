import { dataMode } from '@/lib/data-mode'

import { ClassroomDetailPageDemo } from './classroom-detail-page-demo'
import { ClassroomDetailPageReal } from './classroom-detail-page-real'

/** See subjects-page.tsx for the demo/real branching rationale. */
export function ClassroomDetailPage() {
  return dataMode === 'supabase' ? <ClassroomDetailPageReal /> : <ClassroomDetailPageDemo />
}
