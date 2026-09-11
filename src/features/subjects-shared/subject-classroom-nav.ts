/**
 * Pure navigation/aggregation rules for the subject → classroom workspace
 * flow, shared verbatim by both subjects-real and demo-subjects (real and
 * demo mode must present the identical UX here — see the task's "Demo
 * mode: mirror the same UX" requirement). Generic over the caller's own
 * link-row shape so neither mode has to adapt its types to this module.
 */

interface LinkedClassroomLike {
  classroomId: string
}

/**
 * Resolves the subject root page's behavior for a given set of linked
 * classrooms: exactly one linked classroom means there is no real choice
 * to make, so the root page should redirect straight into that
 * classroom's workspace instead of showing a one-card picker. Zero or
 * many linked classrooms return null, meaning "render the picker/empty
 * state instead."
 */
export function resolveAutoRedirectClassroomId<T extends LinkedClassroomLike>(links: T[]): string | null {
  return links.length === 1 ? links[0].classroomId : null
}

/**
 * Whether `classroomId` (typically read straight from the :classroomId
 * route param) is actually one of the subject's currently-linked
 * classrooms. The classroom workspace page uses this to redirect back to
 * the subject root the moment someone opens a URL naming a classroom that
 * either was never linked to this subject or has since been unlinked —
 * closing the "type an arbitrary classroom id into the URL" path rather
 * than silently rendering that classroom's data inside this subject.
 */
export function isClassroomLinkedToSubject<T extends LinkedClassroomLike>(
  links: T[],
  classroomId: string | undefined,
): boolean {
  return Boolean(classroomId) && links.some((link) => link.classroomId === classroomId)
}

export interface SubjectClassroomSummary {
  totalClassrooms: number
  totalStudents: number
}

/**
 * The subject root page's "3 ห้องเรียน / 99 นักเรียน" summary. Sums each
 * linked classroom's own count rather than de-duplicating a merged
 * roster, so the total always agrees with what the individual classroom
 * cards below it show — including the (rare) case of a student enrolled
 * in more than one of this subject's linked classrooms, who is counted
 * once per classroom here, exactly as they are once per card.
 */
export function summarizeSubjectClassrooms<T extends { studentCount: number }>(links: T[]): SubjectClassroomSummary {
  return {
    totalClassrooms: links.length,
    totalStudents: links.reduce((sum, link) => sum + link.studentCount, 0),
  }
}

/** The classroom-scoped subject workspace route — the one canonical place
 * this URL shape is built, used by the root page's card links, the
 * auto-redirect, and the workspace header's classroom switcher alike. */
export function buildSubjectClassroomPath(subjectId: string, classroomId: string): string {
  return `/teacher/subjects/${subjectId}/classrooms/${classroomId}`
}

/** The one canonical place the assignment-detail route shape is built —
 * used by the Assignments tab's card links and (Dashboard Control
 * Center phase) the dashboard's assignment action center/upcoming list,
 * so a dashboard card always deep-links to the exact real assignment
 * detail page, never a deprecated flat /teacher/assignments route. */
export function buildAssignmentDetailPath(subjectId: string, classroomId: string, assignmentId: string): string {
  return `${buildSubjectClassroomPath(subjectId, classroomId)}/assignments/${assignmentId}`
}

/**
 * Same workspace route as buildSubjectClassroomPath, plus a `?tab=`
 * query string the workspace page (subject-classroom-workspace-page-
 * real.tsx) reads on mount to open directly on that tab instead of
 * always landing on ภาพรวม. Used by the Dashboard Control Center's
 * "เช็คชื่อ"/"ดู/แก้ไข" and "ให้คะแนน" deep links (Sections 3-4) so a
 * click goes straight to the real เช็คชื่อ/คะแนน tab, never a rebuilt
 * dashboard-local editor.
 */
export function buildSubjectClassroomTabPath(
  subjectId: string,
  classroomId: string,
  tab: 'students' | 'attendance' | 'assignments' | 'grades',
): string {
  return `${buildSubjectClassroomPath(subjectId, classroomId)}?tab=${tab}`
}

/** The one canonical place the STUDENT assignment-detail route shape is
 * built — `/student/subjects/:subjectId/assignments/:assignmentId`, used
 * by the Subject Workspace's งาน tab list to deep-link into
 * StudentAssignmentDetailPage ("ส่งงานออนไลน์"). Deliberately not scoped
 * by classroomId in the URL (unlike the teacher route) — a student only
 * ever has ONE classroom per subject, already resolved server-side by
 * RLS, so there is nothing for a second path segment to disambiguate. */
export function buildStudentAssignmentDetailPath(subjectId: string, assignmentId: string): string {
  return `/student/subjects/${subjectId}/assignments/${assignmentId}`
}

/**
 * The plain (non-subject-scoped) classroom detail route, with the same
 * `?tab=` convention as buildSubjectClassroomTabPath — read by
 * classroom-detail-page-real.tsx. Used by the Dashboard Control Center's
 * "ดูนักเรียน" follow-up action (Section 5) to open a student's own
 * classroom roster tab directly, reusing the existing
 * ClassroomStudentsTab/StudentDetailDrawer rather than a new student
 * view.
 */
export function buildClassroomTabPath(classroomId: string, tab: 'students'): string {
  return `/teacher/classrooms/${classroomId}?tab=${tab}`
}
