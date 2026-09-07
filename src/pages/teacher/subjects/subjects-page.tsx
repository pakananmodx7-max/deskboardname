import { dataMode } from '@/lib/data-mode'

import { SubjectsPageDemo } from './subjects-page-demo'
import { SubjectsPageReal } from './subjects-page-real'

/**
 * Branches between the demo (mock, in-memory) Subjects page and the real
 * Supabase-backed one. ProtectedRoute (wrapping /teacher/*) already
 * guarantees a signed-in session by the time this renders in supabase
 * mode, so the branch here is a plain, synchronous check against the
 * static dataMode constant — see src/lib/data-mode.ts and
 * src/components/auth/protected-route.tsx.
 */
export function SubjectsPage() {
  return dataMode === 'supabase' ? <SubjectsPageReal /> : <SubjectsPageDemo />
}
