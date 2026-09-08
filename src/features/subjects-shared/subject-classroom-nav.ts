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
