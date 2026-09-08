export type StudentLinkRequestStatus = 'pending' | 'approved' | 'rejected'

/** Minimal, non-enumerable match returned by the find_student_for_link
 * RPC — never the full students row (no student_code, email, phone;
 * see supabase/migrations/0008_student_account_links.sql). */
export interface StudentLinkCandidate {
  studentId: string
  firstName: string
  lastName: string
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
