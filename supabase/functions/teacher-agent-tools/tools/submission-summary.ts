// Deno-independent (no Deno.*, no npm: imports, no imports from shared.ts)
// so this exact module can be imported both from the Edge Function handler
// (with a .ts extension) and from a Vitest test file (without one) for real
// executed coverage — see _shared/tool-schema.ts for the established pattern.

export interface SummaryAssignmentRow {
  id: string
  title: string
  isArchived: boolean
}

export interface SummaryStudentRow {
  id: string
  number: number | null
}

export interface SummarySubmissionRow {
  assignmentId: string
  studentId: string
  status: string
}

export interface AssignmentSubmissionSummary {
  assignmentId: string
  title: string
  totalStudents: number
  submittedCount: number
  missingCount: number
  missingStudentNumbers: number[]
}

/** Compact per-assignment submission summary for every ACTIVE (non-archived)
 * assignment, given a classroom's full roster and every submission row for
 * those assignments. "Submitted" is whatever the caller passes as
 * submittedStatuses (the Edge Function passes shared.ts's own
 * SUBMITTED_STATUSES, so this stays the same definition of "turned in" as
 * get_missing_submissions/list_assignments — a student with no row at all
 * counts as missing, same as a 'not_submitted'/'missing' row). */
export function computeClassroomSubmissionSummary(
  assignments: readonly SummaryAssignmentRow[],
  roster: readonly SummaryStudentRow[],
  submissions: readonly SummarySubmissionRow[],
  submittedStatuses: readonly string[],
): AssignmentSubmissionSummary[] {
  const totalStudents = roster.length

  return assignments
    .filter((assignment) => !assignment.isArchived)
    .map((assignment) => {
      const submittedStudentIds = new Set(
        submissions
          .filter((s) => s.assignmentId === assignment.id && submittedStatuses.includes(s.status))
          .map((s) => s.studentId),
      )

      const missingStudents = roster.filter((student) => !submittedStudentIds.has(student.id))
      const missingStudentNumbers = missingStudents
        .map((student) => student.number)
        .filter((n): n is number => n !== null)
        .sort((a, b) => a - b)

      return {
        assignmentId: assignment.id,
        title: assignment.title,
        totalStudents,
        submittedCount: totalStudents - missingStudents.length,
        missingCount: missingStudents.length,
        missingStudentNumbers,
      }
    })
}
