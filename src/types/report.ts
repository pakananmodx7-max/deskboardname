import type { AttendanceStatus } from './attendance'
import type { SubmissionStatus } from './assignment'

/**
 * Shared filter state for every real report — classroom/subject are
 * optional narrowing filters (null = "every classroom/subject the
 * teacher owns"); startDate/endDate (yyyy-mm-dd, inclusive) are always
 * set (see getDefaultDateRange in report-service.ts). Every report
 * function reads exclusively through this schema's existing RLS
 * (teacher_id = auth.uid(), transitively via classroom ownership) — a
 * filter here only ever NARROWS what's shown, it can never be used to
 * see another teacher's data, because the underlying query can only ever
 * return rows RLS already permits.
 */
export interface ReportFilters {
  classroomId: string | null
  subjectId: string | null
  startDate: string
  endDate: string
}

export interface ReportStudentRef {
  studentId: string
  studentCode: string | null
  number: number | null
  firstName: string
  lastName: string
  classroomId: string
  classroomName: string
}

/** One row of the Attendance Summary report — one student in one
 * classroom, tallied over every attendance_records row reachable from an
 * attendance_sessions row within [startDate, endDate] (and matching the
 * subject filter, when set). */
export interface AttendanceSummaryRow extends ReportStudentRef {
  present: number
  late: number
  leave: number
  absent: number
  total: number
  /** present / total * 100, or null when total === 0 (never a
   * divide-by-zero NaN) — same convention as
   * student-portal-service.ts's computeAttendanceRate. */
  attendanceRate: number | null
}

/** One assignment column in a Grade Summary group's table — mirrors
 * assignment-service.ts's Assignment shape, trimmed to what the report
 * displays. */
export interface GradeSummaryAssignmentRef {
  assignmentId: string
  title: string
  maxScore: number
  dueDate: string | null
}

/** One student row within a Grade Summary group — reuses
 * assignment-service.ts's StudentGradeRow shape (computeGradeRows) so
 * the exact same total/possible/percentage arithmetic the real Grades
 * tab already uses is what a report shows too, never a second
 * competing computation. */
export interface GradeSummaryStudentRow extends ReportStudentRef {
  scoresByAssignment: Record<string, number | null>
  totalEarned: number
  totalPossible: number
  percentage: number | null
}

/** Grade Summary is grouped "per subject+classroom" (Section 2's own
 * wording) because an assignment always belongs to exactly one
 * subject+classroom pair — there is no meaningful way to merge grade
 * columns across two different subjects into one table. */
export interface GradeSummaryGroup {
  subjectId: string
  subjectName: string
  classroomId: string
  classroomName: string
  assignments: GradeSummaryAssignmentRef[]
  students: GradeSummaryStudentRow[]
}

/** One row of the Missing Assignment report — one student's outstanding
 * (non-'submitted') status on one assignment. */
export interface MissingAssignmentRow extends ReportStudentRef {
  assignmentId: string
  assignmentTitle: string
  subjectId: string
  subjectName: string
  dueDate: string | null
  status: SubmissionStatus
}

export type FollowUpRuleKey =
  | 'repeated_absences'
  | 'multiple_missing_assignments'
  | 'low_completion_rate'
  | 'low_grade_percentage'

export interface FollowUpReason {
  rule: FollowUpRuleKey
  /** Thai, includes the actual measured number and the threshold, e.g.
   * "ขาดเรียน 4 ครั้ง (เกณฑ์ 3 ครั้งขึ้นไป)" — see followup-report-service.ts
   * for the exact rule definitions and threshold constants. Used by the
   * Reports page's Student Follow-up table. */
  label: string
  /** Same measured number, no threshold/explanation — e.g. "ขาด 4 ครั้ง",
   * "ค้าง 3 งาน", "คะแนน 42%" — computed in the exact same place as
   * `label` (never a separate/reimplemented rule), used by the Dashboard
   * Control Center's compact "นักเรียนที่ควรติดตาม" list (Section 5). */
  shortLabel: string
}

/** One row of the Student Follow-up report — a student flagged by at
 * least one deterministic rule within the selected filters. Students
 * matching zero rules never appear here. */
export interface FollowUpRow extends ReportStudentRef {
  reasons: FollowUpReason[]
}

export interface AttendanceStatusMeta {
  status: AttendanceStatus
  label: string
}
