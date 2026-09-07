import { useDataMode } from '@/hooks/use-data-mode'

import { SubjectsPageDemo } from './subjects-page-demo'
import { SubjectsPageReal } from './subjects-page-real'

/**
 * Branches between the demo (mock, in-memory) Subjects page and the real
 * Supabase-backed one. See src/hooks/use-data-mode.ts for how the mode is
 * decided — real data is only used once Supabase is configured AND a
 * session is signed in, so the deployed demo (no env vars, no auth UI
 * yet) always renders SubjectsPageDemo.
 */
export function SubjectsPage() {
  const { status, mode } = useDataMode()

  if (status === 'resolving') return null

  return mode === 'supabase' ? <SubjectsPageReal /> : <SubjectsPageDemo />
}
