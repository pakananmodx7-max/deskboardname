import type { AttendanceSummaryRow, FollowUpReason, FollowUpRow, GradeSummaryGroup, MissingAssignmentRow } from '@/types/report'

/**
 * Student Follow-up report — deterministic, rule-based only. NO AI/ML
 * scoring of any kind: every rule below is a plain, named, fixed
 * threshold applied to numbers already computed by the other three real
 * reports (attendance summary, grade summary, missing assignment) for
 * the SAME filters (classroom/subject/date range) the teacher currently
 * has selected. A student who matches zero rules never appears in the
 * output at all.
 *
 * Rules (all thresholds are named constants below, not magic numbers):
 *
 *   1. repeated_absences — the student's `absent` count (from the
 *      Attendance Summary row for this exact classroom, within the
 *      selected date range) is >= ABSENCE_THRESHOLD.
 *
 *   2. multiple_missing_assignments — the number of Missing Assignment
 *      rows for this student in this classroom (i.e. assignments whose
 *      status is not 'submitted', within the selected filters) is
 *      >= MISSING_ASSIGNMENT_THRESHOLD.
 *
 *   3. low_completion_rate — of every assignment in scope for this
 *      student's classroom (across every subject the Grade Summary
 *      covers), the fraction actually submitted is below
 *      LOW_COMPLETION_RATE_THRESHOLD. Only evaluated when there are at
 *      least MIN_ASSIGNMENTS_FOR_COMPLETION_RULE assignments in scope —
 *      a single assignment missing would otherwise trivially trigger
 *      "very low completion" (0% or 100%, nothing in between).
 *
 *   4. low_grade_percentage — the student's earned/possible score,
 *      summed across every subject+classroom group the Grade Summary
 *      covers for this classroom, is below LOW_GRADE_PERCENTAGE_THRESHOLD
 *      percent. Only evaluated when totalPossible > 0 (a classroom with
 *      no graded assignments yet has nothing to judge).
 *
 * Changing a threshold only ever requires editing the constants below —
 * nothing else in this file encodes a number.
 */
export const FOLLOWUP_RULES = {
  ABSENCE_THRESHOLD: 3,
  MISSING_ASSIGNMENT_THRESHOLD: 3,
  MIN_ASSIGNMENTS_FOR_COMPLETION_RULE: 2,
  LOW_COMPLETION_RATE_THRESHOLD: 0.5,
  LOW_GRADE_PERCENTAGE_THRESHOLD: 50,
} as const

interface StudentAggregate {
  key: string
  studentId: string
  studentCode: string | null
  number: number | null
  firstName: string
  lastName: string
  classroomId: string
  classroomName: string
  absentCount: number
  missingAssignmentCount: number
  totalAssignmentCount: number
  totalEarned: number
  totalPossible: number
}

function keyOf(studentId: string, classroomId: string): string {
  return `${studentId}:${classroomId}`
}

/**
 * Pure — combines the three already-computed reports (same filters) into
 * one row per (student, classroom) that matches at least one rule above.
 * Never fetches anything itself; report-service.ts's callers pass in
 * whatever they already fetched for the other three reports, so this
 * never issues a redundant query and can never see data the caller
 * didn't already have RLS-scoped access to.
 */
export function computeFollowUpReport(
  attendanceRows: AttendanceSummaryRow[],
  missingRows: MissingAssignmentRow[],
  gradeGroups: GradeSummaryGroup[],
): FollowUpRow[] {
  const aggregates = new Map<string, StudentAggregate>()

  function ensure(
    studentId: string,
    classroomId: string,
    info: { studentCode: string | null; number: number | null; firstName: string; lastName: string; classroomName: string },
  ): StudentAggregate {
    const key = keyOf(studentId, classroomId)
    let agg = aggregates.get(key)
    if (!agg) {
      agg = {
        key,
        studentId,
        classroomId,
        studentCode: info.studentCode,
        number: info.number,
        firstName: info.firstName,
        lastName: info.lastName,
        classroomName: info.classroomName,
        absentCount: 0,
        missingAssignmentCount: 0,
        totalAssignmentCount: 0,
        totalEarned: 0,
        totalPossible: 0,
      }
      aggregates.set(key, agg)
    }
    return agg
  }

  for (const row of attendanceRows) {
    const agg = ensure(row.studentId, row.classroomId, row)
    agg.absentCount = row.absent
  }

  for (const row of missingRows) {
    const agg = ensure(row.studentId, row.classroomId, row)
    agg.missingAssignmentCount += 1
  }

  for (const group of gradeGroups) {
    for (const student of group.students) {
      const agg = ensure(student.studentId, student.classroomId, student)
      agg.totalAssignmentCount += group.assignments.length
      agg.totalEarned += student.totalEarned
      agg.totalPossible += student.totalPossible
    }
  }

  const rows: FollowUpRow[] = []

  for (const agg of aggregates.values()) {
    const reasons: FollowUpReason[] = []

    if (agg.absentCount >= FOLLOWUP_RULES.ABSENCE_THRESHOLD) {
      reasons.push({
        rule: 'repeated_absences',
        label: `ขาดเรียน ${agg.absentCount} ครั้ง (เกณฑ์ ${FOLLOWUP_RULES.ABSENCE_THRESHOLD} ครั้งขึ้นไป) ในช่วงวันที่เลือก`,
      })
    }

    if (agg.missingAssignmentCount >= FOLLOWUP_RULES.MISSING_ASSIGNMENT_THRESHOLD) {
      reasons.push({
        rule: 'multiple_missing_assignments',
        label: `มีงานค้าง ${agg.missingAssignmentCount} ชิ้น (เกณฑ์ ${FOLLOWUP_RULES.MISSING_ASSIGNMENT_THRESHOLD} ชิ้นขึ้นไป)`,
      })
    }

    if (agg.totalAssignmentCount >= FOLLOWUP_RULES.MIN_ASSIGNMENTS_FOR_COMPLETION_RULE) {
      const submitted = agg.totalAssignmentCount - agg.missingAssignmentCount
      const completionRate = submitted / agg.totalAssignmentCount
      if (completionRate < FOLLOWUP_RULES.LOW_COMPLETION_RATE_THRESHOLD) {
        reasons.push({
          rule: 'low_completion_rate',
          label: `ส่งงานเพียง ${(completionRate * 100).toFixed(0)}% ของงานทั้งหมด ${agg.totalAssignmentCount} ชิ้น (เกณฑ์ต่ำกว่า ${
            FOLLOWUP_RULES.LOW_COMPLETION_RATE_THRESHOLD * 100
          }%)`,
        })
      }
    }

    if (agg.totalPossible > 0) {
      const percentage = (agg.totalEarned / agg.totalPossible) * 100
      if (percentage < FOLLOWUP_RULES.LOW_GRADE_PERCENTAGE_THRESHOLD) {
        reasons.push({
          rule: 'low_grade_percentage',
          label: `คะแนนรวม ${percentage.toFixed(0)}% (เกณฑ์ต่ำกว่า ${FOLLOWUP_RULES.LOW_GRADE_PERCENTAGE_THRESHOLD}%)`,
        })
      }
    }

    if (reasons.length === 0) continue

    rows.push({
      studentId: agg.studentId,
      studentCode: agg.studentCode,
      number: agg.number,
      firstName: agg.firstName,
      lastName: agg.lastName,
      classroomId: agg.classroomId,
      classroomName: agg.classroomName,
      reasons,
    })
  }

  return rows.sort(
    (a, b) =>
      b.reasons.length - a.reasons.length ||
      a.classroomName.localeCompare(b.classroomName, 'th') ||
      (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER),
  )
}
