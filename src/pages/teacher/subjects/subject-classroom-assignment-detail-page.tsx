import { dataMode } from '@/lib/data-mode'

import { SubjectClassroomAssignmentDetailPageDemo } from './subject-classroom-assignment-detail-page-demo'
import { SubjectClassroomAssignmentDetailPageReal } from './subject-classroom-assignment-detail-page-real'

/** See subjects-page.tsx for the demo/real branching rationale. */
export function SubjectClassroomAssignmentDetailPage() {
  return dataMode === 'supabase' ? (
    <SubjectClassroomAssignmentDetailPageReal />
  ) : (
    <SubjectClassroomAssignmentDetailPageDemo />
  )
}
