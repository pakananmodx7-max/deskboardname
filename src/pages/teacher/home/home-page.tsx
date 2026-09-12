import { dataMode } from '@/lib/data-mode'

import { HomePageDemo } from './home-page-demo'
import { HomePageReal } from './home-page-real'

/** See subjects-page.tsx for the demo/real branching rationale. */
export function HomePage() {
  return dataMode === 'supabase' ? <HomePageReal /> : <HomePageDemo />
}
