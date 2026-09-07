import type {
  DemoClassroomInfo,
  DemoStudent,
  DemoSubjectAssignment,
  SubmissionStatus,
} from '@/demo/types'

export function getStudentIdsForClassrooms(
  classroomIds: string[],
  classrooms: DemoClassroomInfo[],
): string[] {
  const ids = new Set<string>()
  for (const classroomId of classroomIds) {
    const classroom = classrooms.find((c) => c.id === classroomId)
    classroom?.studentIds.forEach((id) => ids.add(id))
  }
  return Array.from(ids)
}

export function getStudentsForClassrooms(
  classroomIds: string[],
  classrooms: DemoClassroomInfo[],
  allStudents: DemoStudent[],
): DemoStudent[] {
  const ids = new Set(getStudentIdsForClassrooms(classroomIds, classrooms))
  return allStudents.filter((s) => ids.has(s.id))
}

export interface AssignmentSubmissionSummary {
  submitted: number
  notSubmitted: number
  late: number
  missing: number
  total: number
  average: number | null
}

export function computeAssignmentSummary(assignment: DemoSubjectAssignment): AssignmentSubmissionSummary {
  const summary: AssignmentSubmissionSummary = {
    submitted: 0,
    notSubmitted: 0,
    late: 0,
    missing: 0,
    total: 0,
    average: null,
  }

  const scores: number[] = []

  for (const submission of Object.values(assignment.submissions)) {
    summary.total += 1
    if (submission.status === 'submitted') summary.submitted += 1
    else if (submission.status === 'not_submitted') summary.notSubmitted += 1
    else if (submission.status === 'late') summary.late += 1
    else if (submission.status === 'missing') summary.missing += 1

    if (submission.score !== null) scores.push(submission.score)
  }

  if (scores.length > 0) {
    summary.average = scores.reduce((a, b) => a + b, 0) / scores.length
  }

  return summary
}

const UNRESOLVED_STATUSES: SubmissionStatus[] = ['not_submitted', 'late', 'missing']

/** studentId -> number of subject assignments not cleanly submitted (late/missing/not submitted). */
export function computeSubjectMissingByStudent(
  assignments: DemoSubjectAssignment[],
): Record<string, number> {
  const missing: Record<string, number> = {}
  for (const assignment of assignments) {
    for (const [studentId, submission] of Object.entries(assignment.submissions)) {
      if (UNRESOLVED_STATUSES.includes(submission.status)) {
        missing[studentId] = (missing[studentId] ?? 0) + 1
      }
    }
  }
  return missing
}

export interface SubjectStudentGradeRow {
  studentId: string
  scoresByAssignment: Record<string, number | null>
  total: number
  average: number | null
}

export function computeSubjectGrades(
  studentIds: string[],
  assignments: DemoSubjectAssignment[],
): SubjectStudentGradeRow[] {
  return studentIds.map((studentId) => {
    const scoresByAssignment: Record<string, number | null> = {}
    let total = 0
    const percentages: number[] = []

    for (const assignment of assignments) {
      const score = assignment.submissions[studentId]?.score ?? null
      scoresByAssignment[assignment.id] = score
      if (score !== null) {
        total += score
        percentages.push((score / assignment.maxScore) * 100)
      }
    }

    const average = percentages.length > 0 ? percentages.reduce((a, b) => a + b, 0) / percentages.length : null

    return { studentId, scoresByAssignment, total, average }
  })
}

/** Percentage (0-100) average across all assignments, normalized per assignment's maxScore first
 * so assignments worth different points don't skew the subject-level figure. */
export function computeSubjectAverageScore(assignments: DemoSubjectAssignment[]): number | null {
  const percentageAverages: number[] = []

  for (const assignment of assignments) {
    const summary = computeAssignmentSummary(assignment)
    if (summary.average !== null) {
      percentageAverages.push((summary.average / assignment.maxScore) * 100)
    }
  }

  if (percentageAverages.length === 0) return null
  return percentageAverages.reduce((a, b) => a + b, 0) / percentageAverages.length
}
