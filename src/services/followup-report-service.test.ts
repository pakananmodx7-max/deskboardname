import { describe, expect, it } from 'vitest'

import { computeFollowUpReport, FOLLOWUP_RULES } from '@/services/followup-report-service'
import type {
  AttendanceSummaryRow,
  GradeSummaryGroup,
  GradeSummaryStudentRow,
  MissingAssignmentRow,
  ReportStudentRef,
} from '@/types/report'

function ref(overrides: Partial<ReportStudentRef> = {}): ReportStudentRef {
  return {
    studentId: 's1',
    studentCode: 'S001',
    number: 1,
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    classroomId: 'room-1',
    classroomName: 'ม.5/1',
    ...overrides,
  }
}

function attendanceRow(overrides: Partial<AttendanceSummaryRow> = {}): AttendanceSummaryRow {
  return { ...ref(), present: 5, late: 0, leave: 0, absent: 0, total: 5, attendanceRate: 100, ...overrides }
}

function gradeStudentRow(overrides: Partial<GradeSummaryStudentRow> = {}): GradeSummaryStudentRow {
  const totalEarned = overrides.totalEarned ?? 0
  const totalPossible = overrides.totalPossible ?? 0
  return {
    ...ref(),
    scoresByAssignment: {},
    totalEarned,
    totalPossible,
    percentage: totalPossible > 0 ? (totalEarned / totalPossible) * 100 : null,
    ...overrides,
  }
}

function missingRow(overrides: Partial<MissingAssignmentRow> = {}): MissingAssignmentRow {
  return {
    ...ref(),
    assignmentId: 'a1',
    assignmentTitle: 'งาน 1',
    subjectId: 'subj-1',
    subjectName: 'คณิตศาสตร์',
    dueDate: '2026-09-10',
    status: 'not_submitted',
    ...overrides,
  }
}

function gradeGroup(overrides: Partial<GradeSummaryGroup> = {}): GradeSummaryGroup {
  return {
    subjectId: 'subj-1',
    subjectName: 'คณิตศาสตร์',
    classroomId: 'room-1',
    classroomName: 'ม.5/1',
    assignments: [
      { assignmentId: 'a1', title: 'งาน 1', maxScore: 100, dueDate: '2026-09-10' },
      { assignmentId: 'a2', title: 'งาน 2', maxScore: 100, dueDate: '2026-09-20' },
    ],
    students: [],
    ...overrides,
  }
}

describe('computeFollowUpReport — rule: repeated_absences', () => {
  it('flags a student at the absence threshold', () => {
    const rows = computeFollowUpReport([attendanceRow({ absent: FOLLOWUP_RULES.ABSENCE_THRESHOLD, total: 10 })], [], [])
    expect(rows).toHaveLength(1)
    expect(rows[0].reasons.map((r) => r.rule)).toContain('repeated_absences')
  })

  it('does not flag a student just below the threshold', () => {
    const rows = computeFollowUpReport(
      [attendanceRow({ absent: FOLLOWUP_RULES.ABSENCE_THRESHOLD - 1, total: 10 })],
      [],
      [],
    )
    expect(rows).toHaveLength(0)
  })
})

describe('computeFollowUpReport — rule: multiple_missing_assignments', () => {
  it('flags a student at the missing-assignment threshold', () => {
    const rows = computeFollowUpReport(
      [],
      Array.from({ length: FOLLOWUP_RULES.MISSING_ASSIGNMENT_THRESHOLD }, (_, i) => missingRow({ assignmentId: `a${i}` })),
      [],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].reasons.map((r) => r.rule)).toContain('multiple_missing_assignments')
  })

  it('does not flag a student just below the threshold', () => {
    const rows = computeFollowUpReport(
      [],
      Array.from({ length: FOLLOWUP_RULES.MISSING_ASSIGNMENT_THRESHOLD - 1 }, (_, i) => missingRow({ assignmentId: `a${i}` })),
      [],
    )
    expect(rows).toHaveLength(0)
  })
})

describe('computeFollowUpReport — rule: low_completion_rate', () => {
  it('flags a student below the completion-rate threshold when enough assignments exist', () => {
    // 4 assignments total, 3 missing -> 25% completion, well under 50%
    const group = gradeGroup({
      assignments: Array.from({ length: 4 }, (_, i) => ({ assignmentId: `a${i}`, title: `t${i}`, maxScore: 100, dueDate: null })),
      students: [gradeStudentRow({ totalEarned: 0, totalPossible: 400 })],
    })
    const missing = Array.from({ length: 3 }, (_, i) => missingRow({ assignmentId: `a${i}` }))
    const rows = computeFollowUpReport([], missing, [group])
    expect(rows[0].reasons.map((r) => r.rule)).toContain('low_completion_rate')
  })

  it('does not evaluate the rule with fewer than the minimum assignment count', () => {
    const group = gradeGroup({
      assignments: [{ assignmentId: 'a0', title: 't', maxScore: 100, dueDate: null }],
      students: [gradeStudentRow({ totalEarned: 0, totalPossible: 100 })],
    })
    const missing = [missingRow({ assignmentId: 'a0' })]
    const rows = computeFollowUpReport([], missing, [group])
    expect(rows.every((r) => !r.reasons.some((reason) => reason.rule === 'low_completion_rate'))).toBe(true)
  })
})

describe('computeFollowUpReport — rule: low_grade_percentage', () => {
  it('flags a student below the grade-percentage threshold', () => {
    const group = gradeGroup({
      students: [gradeStudentRow({ totalEarned: 30, totalPossible: 200 })], // 15%
    })
    const rows = computeFollowUpReport([], [], [group])
    expect(rows[0].reasons.map((r) => r.rule)).toContain('low_grade_percentage')
  })

  it('does not flag a student at or above the threshold', () => {
    const group = gradeGroup({
      students: [gradeStudentRow({ totalEarned: 150, totalPossible: 200 })], // 75%
    })
    const rows = computeFollowUpReport([], [], [group])
    expect(rows).toHaveLength(0)
  })

  it('does not evaluate the rule when totalPossible is 0 (nothing graded yet)', () => {
    const group = gradeGroup({
      assignments: [],
      students: [gradeStudentRow({ totalEarned: 0, totalPossible: 0 })],
    })
    const rows = computeFollowUpReport([], [], [group])
    expect(rows).toHaveLength(0)
  })
})

describe('computeFollowUpReport — general behavior', () => {
  it('a student matching zero rules never appears in the output', () => {
    const rows = computeFollowUpReport(
      [attendanceRow({ absent: 0 })],
      [],
      [gradeGroup({ students: [gradeStudentRow({ totalEarned: 90, totalPossible: 100 })] })],
    )
    expect(rows).toHaveLength(0)
  })

  it('a student can carry multiple reasons at once', () => {
    const attendance = [attendanceRow({ absent: FOLLOWUP_RULES.ABSENCE_THRESHOLD })]
    const missing = Array.from({ length: FOLLOWUP_RULES.MISSING_ASSIGNMENT_THRESHOLD }, (_, i) => missingRow({ assignmentId: `a${i}` }))
    const rows = computeFollowUpReport(attendance, missing, [])
    expect(rows).toHaveLength(1)
    expect(rows[0].reasons.length).toBeGreaterThanOrEqual(2)
  })

  it('never merges two different students into one row', () => {
    const attendance = [
      attendanceRow({ studentId: 's1', absent: FOLLOWUP_RULES.ABSENCE_THRESHOLD }),
      attendanceRow({ studentId: 's2', absent: FOLLOWUP_RULES.ABSENCE_THRESHOLD }),
    ]
    const rows = computeFollowUpReport(attendance, [], [])
    expect(rows.map((r) => r.studentId).sort()).toEqual(['s1', 's2'])
  })

  it('every reason label documents the actual measured number and the threshold', () => {
    const rows = computeFollowUpReport([attendanceRow({ absent: 5 })], [], [])
    expect(rows[0].reasons[0].label).toContain('5')
    expect(rows[0].reasons[0].label).toContain(String(FOLLOWUP_RULES.ABSENCE_THRESHOLD))
  })
})
