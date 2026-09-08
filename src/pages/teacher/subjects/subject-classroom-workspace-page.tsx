import { dataMode } from '@/lib/data-mode'

import { SubjectClassroomWorkspacePageDemo } from './subject-classroom-workspace-page-demo'
import { SubjectClassroomWorkspacePageReal } from './subject-classroom-workspace-page-real'

/** See subjects-page.tsx for the demo/real branching rationale. */
export function SubjectClassroomWorkspacePage() {
  return dataMode === 'supabase' ? <SubjectClassroomWorkspacePageReal /> : <SubjectClassroomWorkspacePageDemo />
}
