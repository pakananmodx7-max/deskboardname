import { useDataMode } from '@/hooks/use-data-mode'

import { SubjectDetailPageDemo } from './subject-detail-page-demo'
import { SubjectDetailPageReal } from './subject-detail-page-real'

/** See subjects-page.tsx for the demo/real branching rationale. */
export function SubjectDetailPage() {
  const { status, mode } = useDataMode()

  if (status === 'resolving') return null

  return mode === 'supabase' ? <SubjectDetailPageReal /> : <SubjectDetailPageDemo />
}
