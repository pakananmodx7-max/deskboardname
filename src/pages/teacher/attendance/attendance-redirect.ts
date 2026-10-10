import { buildSubjectClassroomTabPath } from '@/features/subjects-shared/subject-classroom-nav'

/** Where /teacher/attendance goes when the URL names no subject + classroom:
 * the subject list, the real entry point for taking attendance. */
export const ATTENDANCE_REDIRECT_TARGET = '/teacher/subjects'

const SUBJECT_PARAMS = ['subjectId', 'subject_id', 'subject']
const CLASSROOM_PARAMS = ['classroomId', 'classroom_id', 'classroom']
/** UUIDs (real mode) and demo ids — never a path fragment. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

function firstParam(params: URLSearchParams, names: string[]): string | null {
  for (const name of names) {
    const value = params.get(name)?.trim()
    if (value) return SAFE_ID.test(value) ? value : null
  }
  return null
}

/**
 * Target for an old standalone-attendance URL. A bookmark that names both
 * a subject and a classroom opens that subject workspace's เช็คชื่อ tab
 * (which checks the ids against the teacher's own data and RLS, and falls
 * back to the subject list when they don't exist); anything else goes to
 * the subject list.
 */
export function resolveAttendanceRedirect(search: string): string {
  const params = new URLSearchParams(search)
  const subjectId = firstParam(params, SUBJECT_PARAMS)
  const classroomId = firstParam(params, CLASSROOM_PARAMS)
  return subjectId && classroomId ? buildSubjectClassroomTabPath(subjectId, classroomId, 'attendance') : ATTENDANCE_REDIRECT_TARGET
}
