import { getSupabaseClient } from '@/lib/supabase'
import type { ProfileRole } from '@/types/profile'
import type {
  StudentAccountLinkRequest,
  StudentLinkCandidate,
  StudentLinkClassroomOption,
  StudentLinkRequestForReview,
  StudentLinkRequestStatus,
} from '@/types/student-link-request'

interface StudentAccountLinkRequestRow {
  id: string
  student_id: string
  requested_by: string
  status: StudentLinkRequestStatus
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
  created_at: string
  updated_at: string
}

function mapRequest(row: StudentAccountLinkRequestRow): StudentAccountLinkRequest {
  return {
    id: row.id,
    studentId: row.student_id,
    requestedBy: row.requested_by,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function requireUserId(): Promise<string> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) {
    throw new Error('กรุณาเข้าสู่ระบบก่อนใช้งาน')
  }
  return data.user.id
}

/** The calling account's own profile role — used right after sign-in on
 * /student/login to reject a non-student account before routing anywhere
 * student-specific (RLS would already block every student-only write
 * regardless; this is purely a fast, friendly UI check). */
export async function getMyRole(): Promise<ProfileRole> {
  const supabase = getSupabaseClient()
  const userId = await requireUserId()

  const { data, error } = await supabase.from('profiles').select('role').eq('id', userId).single()
  if (error) throw error
  return (data as { role: ProfileRole }).role
}

/**
 * The classroom choices for the /student/link-account selector — scoped
 * to classrooms that actually contain an unlinked student with the given
 * student_code (never the full classroom directory). See
 * list_classrooms_for_student_code's doc comment in
 * 0009_student_link_classroom_lookup.sql for the full security
 * rationale. An empty array means the code matched no unlinked student
 * in any classroom.
 */
export async function listClassroomsForStudentCode(studentCode: string): Promise<StudentLinkClassroomOption[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.rpc('list_classrooms_for_student_code', {
    p_student_code: studentCode,
  })
  if (error) throw error

  const rows = (data ?? []) as { classroom_id: string; classroom_name: string }[]
  return rows.map((row) => ({ classroomId: row.classroom_id, classroomName: row.classroom_name }))
}

/**
 * The ONLY way a student account may query anything about the students
 * table — see find_student_for_link_in_classroom's doc comment in
 * 0009_student_link_classroom_lookup.sql for the full security
 * rationale. Identity is confirmed by student_code + classroom_id
 * together (student_code alone is not unique across the whole students
 * table — see 0001's "student_code duplicate strategy"), minimal fields
 * only, excludes already-linked students, and rejects an ambiguous
 * multi-match WITHIN the selected classroom rather than guessing.
 * Returns null for "not found in this classroom" (or already claimed —
 * indistinguishable on purpose); throws for an ambiguous match or an
 * unauthorized caller.
 */
export async function findStudentForLink(
  studentCode: string,
  classroomId: string,
): Promise<StudentLinkCandidate | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.rpc('find_student_for_link_in_classroom', {
    p_student_code: studentCode,
    p_classroom_id: classroomId,
  })
  if (error) throw error

  const rows = (data ?? []) as {
    student_id: string
    student_code: string
    first_name: string
    last_name: string
    classroom_name: string
  }[]
  if (rows.length === 0) return null

  const row = rows[0]
  return {
    studentId: row.student_id,
    studentCode: row.student_code,
    firstName: row.first_name,
    lastName: row.last_name,
    classroomName: row.classroom_name,
  }
}

/**
 * Submits a pending link request for the CURRENT user (requested_by is
 * always the caller's own id — never a parameter, so it can never be
 * forged from the client). RLS (student_account_link_requests_insert_own,
 * 0008) independently re-verifies the caller is role='student' and the
 * target is actually a valid, unclaimed student — this function does not
 * duplicate those checks client-side, it just submits and lets the
 * database reject it with a friendly error if something's changed since
 * the lookup (e.g. someone else claimed it, or the caller already has a
 * pending request for a different student).
 */
export async function submitLinkRequest(studentId: string): Promise<StudentAccountLinkRequest> {
  const supabase = getSupabaseClient()
  const userId = await requireUserId()

  const { data, error } = await supabase
    .from('student_account_link_requests')
    .insert({ student_id: studentId, requested_by: userId })
    .select('*')
    .single()

  if (error) throw error
  return mapRequest(data as StudentAccountLinkRequestRow)
}

/** Every link request the CURRENT user has ever submitted, most recent
 * first — enough to derive "no request yet / pending / approved /
 * rejected" without ever reading the students table directly (see
 * deriveMyLinkStatus). */
export async function getMyLinkRequests(): Promise<StudentAccountLinkRequest[]> {
  const supabase = getSupabaseClient()
  const userId = await requireUserId()

  const { data, error } = await supabase
    .from('student_account_link_requests')
    .select('*')
    .eq('requested_by', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data as StudentAccountLinkRequestRow[]).map(mapRequest)
}

/**
 * Requests visible to the calling teacher — RLS
 * (student_account_link_requests_select_own_or_teacher /
 * _select_admin, 0008) already scopes this to students currently in one
 * of the teacher's own classrooms (or, for an admin, everything); this
 * function does not add any additional filtering beyond an optional
 * status. The target student's name/code and the requesting account's
 * email/display name are fetched as separate scoped queries and merged
 * in JS rather than a single embedded PostgREST join, since
 * student_account_link_requests has two FKs into profiles
 * (requested_by, reviewed_by) that would otherwise need an explicit
 * relationship hint — simpler and more robust to keep these as plain,
 * independently-scoped queries, matching this codebase's existing
 * pattern (e.g. subjects-real/tabs/assignments-tab.tsx combining
 * assignments + submissions).
 */
export async function getLinkRequestsForTeacher(
  status?: StudentLinkRequestStatus,
): Promise<StudentLinkRequestForReview[]> {
  const supabase = getSupabaseClient()

  let query = supabase.from('student_account_link_requests').select('*').order('created_at', { ascending: true })
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) throw error

  const rows = data as StudentAccountLinkRequestRow[]
  if (rows.length === 0) return []

  const studentIds = [...new Set(rows.map((r) => r.student_id))]
  const requesterIds = [...new Set(rows.map((r) => r.requested_by))]

  const [studentsResult, profilesResult] = await Promise.all([
    supabase.from('students').select('id, first_name, last_name, student_code').in('id', studentIds),
    supabase.from('profiles').select('id, email, display_name').in('id', requesterIds),
  ])
  if (studentsResult.error) throw studentsResult.error
  if (profilesResult.error) throw profilesResult.error

  const studentRows = studentsResult.data as { id: string; first_name: string; last_name: string; student_code: string | null }[]
  const profileRows = profilesResult.data as { id: string; email: string | null; display_name: string | null }[]

  const studentById = new Map(studentRows.map((s) => [s.id, s]))
  const profileById = new Map(profileRows.map((p) => [p.id, p]))

  return rows.map((row) => {
    const student = studentById.get(row.student_id)
    const profile = profileById.get(row.requested_by)
    return {
      ...mapRequest(row),
      studentFirstName: student?.first_name ?? '',
      studentLastName: student?.last_name ?? '',
      studentCode: student?.student_code ?? null,
      requesterEmail: profile?.email ?? null,
      requesterDisplayName: profile?.display_name ?? null,
    }
  })
}

/**
 * Approves one request via the approve_student_link_request RPC (0008)
 * — SECURITY DEFINER, re-verifies classroom ownership (or admin) and
 * every invariant (target not already linked, requester not already
 * linked elsewhere) itself; this function is a thin pass-through, never
 * a place that could be trusted to enforce authorization on its own.
 */
export async function approveLinkRequest(requestId: string): Promise<StudentAccountLinkRequest> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.rpc('approve_student_link_request', { p_request_id: requestId })
  if (error) throw error
  return mapRequest(data as StudentAccountLinkRequestRow)
}

export async function rejectLinkRequest(requestId: string, note?: string): Promise<StudentAccountLinkRequest> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.rpc('reject_student_link_request', {
    p_request_id: requestId,
    p_note: note ?? null,
  })
  if (error) throw error
  return mapRequest(data as StudentAccountLinkRequestRow)
}

export interface BulkApproveResult {
  succeeded: string[]
  failed: { id: string; error: unknown }[]
}

/**
 * Bulk approve is a client-side parallel loop over the single-item RPC
 * (Promise.allSettled, not a dedicated SQL bulk function) — same
 * pattern as assignment-service.ts's bulkSetSubmissionStatus. Each
 * approval is independently authorized by the RPC, so one request being
 * ineligible (e.g. its target got claimed by someone else moments ago)
 * must never block the others from succeeding — the caller gets back
 * exactly which ids succeeded and which failed (with why), rather than
 * an all-or-nothing result.
 */
export async function bulkApproveLinkRequests(requestIds: string[]): Promise<BulkApproveResult> {
  const results = await Promise.allSettled(requestIds.map((id) => approveLinkRequest(id)))
  const succeeded: string[] = []
  const failed: { id: string; error: unknown }[] = []

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      succeeded.push(requestIds[i])
    } else {
      failed.push({ id: requestIds[i], error: result.reason })
    }
  })

  return { succeeded, failed }
}

/**
 * Pure — derives the single overall status a student's own UI should
 * show from their full request history (most recent request wins;
 * "none" means they've never submitted one at all). Used by both
 * /student/login (to decide where to redirect after signing in) and
 * /student/pending (to decide what to render), so the two can never
 * disagree about what "my current status" means.
 */
export function deriveMyLinkStatus(
  requests: StudentAccountLinkRequest[],
): { status: 'none' } | { status: StudentLinkRequestStatus; request: StudentAccountLinkRequest } {
  if (requests.length === 0) return { status: 'none' }

  const latest = requests.reduce((most_recent, r) =>
    new Date(r.createdAt).getTime() > new Date(most_recent.createdAt).getTime() ? r : most_recent,
  )
  return { status: latest.status, request: latest }
}
