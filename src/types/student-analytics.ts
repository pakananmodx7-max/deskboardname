/**
 * วิเคราะห์นักเรียน (Student Analytics) — types for a single student's
 * multi-dimensional overview inside one subject+classroom workspace.
 *
 * Every metric here is derived from data this schema already has
 * (assignments/assignment_submissions, attendance_sessions/
 * attendance_records — see student-analytics-service.ts). There is
 * deliberately NO "คะแนนเก็บ" vs "คะแนนสอบ" split (assignments carry no
 * category field) and NO "พฤติกรรม" dimension (the only behavior-shaped
 * data in this app is SGS, which this feature must never read or depend
 * on) — see student-analytics-service.ts's own doc comment for the full
 * reasoning. Nothing in this file is ever computed from, or written to,
 * sgs_score_columns/sgs_scores.
 */

export type StudentAnalyticsMetricKey = 'grade' | 'completion' | 'onTime' | 'attendance'

export const STUDENT_ANALYTICS_METRIC_LABELS: Record<StudentAnalyticsMetricKey, string> = {
  grade: 'ผลการเรียน',
  completion: 'ส่งงานครบ',
  onTime: 'ส่งงานตรงเวลา',
  attendance: 'การเข้าเรียน',
}

/**
 * One radar/comparison-table dimension. `raw` is kept alongside `value`
 * (the 0-100 normalized figure the radar chart and table both render) so
 * a caller can show the real numerator/denominator instead of only the
 * normalized percentage — see the required "keep raw values separate
 * from normalized display values" rule.
 */
export interface StudentAnalyticsMetric {
  key: StudentAnalyticsMetricKey
  label: string
  /** 0-100, already normalized. Null when this dimension has no
   * denominator to measure against yet (e.g. no assignments, no
   * attendance sessions) — never fabricated as 0. */
  value: number | null
  /** Same dimension, computed the same way, averaged across the
   * classroom roster — null under the same "nothing to measure" rule. */
  classroomAverage: number | null
  /** Human-readable raw figure, e.g. "18/20 คะแนน", "7/8 ครั้ง" — null
   * exactly when `value` is null. */
  rawLabel: string | null
}

/** One point on the ordered-assignment trend line — an assignment this
 * student has a recorded score for, plus the classroom average on that
 * same assignment (null if nobody in the classroom has a score for it
 * yet, which cannot happen for a point that exists, but kept nullable
 * for the same "never fabricate" discipline as everywhere else). */
export interface StudentAnalyticsTrendPoint {
  assignmentId: string
  assignmentTitle: string
  dueDate: string | null
  /** 0-100 — this student's score/maxScore for this one assignment. */
  studentPercent: number
  /** 0-100 — average score/maxScore across every classroom member who
   * has a recorded score for this assignment. Null when this student is
   * the only one graded yet. */
  classroomAveragePercent: number | null
}

export interface StudentAnalyticsAttendanceSummary {
  present: number
  late: number
  leave: number
  absent: number
  total: number
  /** present/total * 100, or null when total === 0. */
  attendanceRate: number | null
}

export interface StudentAnalyticsAssignmentSummary {
  totalAssignments: number
  submitted: number
  onTime: number
  late: number
  missing: number
}

export type StudentAnalyticsEvidenceKind =
  | 'strongest_dimension'
  | 'below_classroom_average'
  | 'missing_assignments'
  | 'attendance_issue'
  | 'trend_improving'
  | 'trend_declining'

export interface StudentAnalyticsEvidenceItem {
  kind: StudentAnalyticsEvidenceKind
  /** Thai, always names the actual computed number(s) — never a vague
   * qualitative claim with nothing behind it, matching
   * followup-report-service.ts's FollowUpReason.label convention. */
  label: string
}

/** The full bundle student-analytics-service.ts's getStudentAnalyticsSnapshot
 * returns — everything the page renders, computed once from data fetched
 * in a single batched round of requests (never one query per section). */
export interface StudentAnalyticsSnapshot {
  metrics: StudentAnalyticsMetric[]
  trend: StudentAnalyticsTrendPoint[]
  attendance: StudentAnalyticsAttendanceSummary
  assignments: StudentAnalyticsAssignmentSummary
  evidence: StudentAnalyticsEvidenceItem[]
  /** Classroom roster size this snapshot's classroom averages were
   * computed over (active members only) — shown so a teacher can judge
   * how meaningful "classroom average" is for a very small class. */
  classroomSize: number
}

// ==================================================
// บันทึกติดตาม (follow-up notes) — see
// supabase/migrations/0026_student_followup_notes.sql
// ==================================================

export interface StudentFollowUpNote {
  id: string
  studentId: string
  classroomId: string
  subjectId: string
  body: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateStudentFollowUpNoteInput {
  studentId: string
  classroomId: string
  subjectId: string
  body: string
}
