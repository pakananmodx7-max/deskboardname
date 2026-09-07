import { dataMode } from '@/lib/data-mode'

import { SubjectDetailPageDemo } from './subject-detail-page-demo'
import { SubjectDetailPageReal } from './subject-detail-page-real'

/** See subjects-page.tsx for the demo/real branching rationale. */
export function SubjectDetailPage() {
  return dataMode === 'supabase' ? <SubjectDetailPageReal /> : <SubjectDetailPageDemo />
}
