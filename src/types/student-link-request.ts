export type StudentLinkRequestStatus = 'pending' | 'approved' | 'rejected'

/** One minimal classroom choice for the /student/link-account classroom
 * selector — id + name ONLY (never roster, teacher, grades, attendance,
 * or assignments). Returned by list_classrooms_for_student_code, scoped
 * to classrooms that actually contain an unlinked student with the
 * entered student_code — never the full classroom directory. See
 * supabase/migrations/0009_student_link_classroom_lookup.sql. */
export interface StudentLinkClassroomOption {
  classroomId: string
  classroomName: string
}

/** Minimal, non-enumerable match returned by
 * find_student_for_link_in_classroom — never the full students row (no
 * email, phone, number, nickname, status; see
 * supabase/migrations/0009_student_link_classroom_lookup.sql). Identity
 * is confirmed by student_code + classroom together, not student_code
 * alone — student_code is not unique across the whole students table. */
export interface StudentLinkCandidate {
  studentId: string
  studentCode: string
  firstName: string
  lastName: string
  classroomName: string
}

export interface StudentAccountLinkRequest {
  id: string
  studentId: string
  requestedBy: string
  status: StudentLinkRequestStatus
  reviewedBy: string | null
  reviewedAt: string | null
  reviewNote: string | null
  createdAt: string
  updatedAt: string
}

/** Denormalized view used by the teacher-facing review page — the
 * request row plus the identifying info a teacher actually needs to
 * make a decision (the target student's name/code, already visible to
 * them via students_select_via_classroom, and the requesting account's
 * email/display name, visible via the new narrow
 * profiles_select_via_link_request policy). */
export interface StudentLinkRequestForReview extends StudentAccountLinkRequest {
  studentFirstName: string
  studentLastName: string
  studentCode: string | null
  requesterEmail: string | null
  requesterDisplayName: string | null
}
