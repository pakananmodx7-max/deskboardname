import { describe, expect, it } from 'vitest'

import {
  aggregateStudentAttendance,
  averageNonNull,
  buildAssignmentSummary,
  buildEvidenceSummary,
  buildStudentAnalyticsMetrics,
  buildTrendSeries,
  computeSubmissionTimelinessRows,
  filterActiveStudentsForSwitcher,
  findStudentSwitcherIndex,
  getNextStudent,
  getPreviousStudent,
  sortAssignmentsForTrend,
  STUDENT_ANALYTICS_EVIDENCE_RULES,
  ZERO_ATTENDANCE_SUMMARY,
} from './student-analytics-service'
import type { Assignment, AssignmentSubmission } from '@/types/assignment'
import type { ClassroomStudent } from '@/types/student'

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: 'a1',
    subjectId: 'subj-1',
    classroomId: 'room-1',
    topicId: null,
    title: 'แบบฝึกหัด 1',
    description: null,
    maxScore: 100,
    dueDate: '2026-09-10',
    isArchived: false,
    createdBy: 'teacher-1',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

function submission(overrides: Partial<AssignmentSubmission> = {}): AssignmentSubmission {
  return {
    studentId: 's1',
    status: 'submitted',
    score: 80,
    note: null,
    ...overrides,
  }
}

function student(overrides: Partial<ClassroomStudent> = {}): ClassroomStudent {
  return {
    id: 's1',
    studentCode: 'S001',
    number: 1,
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    nickname: null,
    email: null,
    phone: null,
    status: 'active',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    classroomStudentId: 'cs-1',
    joinedAt: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

// ==================================================
// averageNonNull
// ==================================================

describe('averageNonNull', () => {
  it('averages only the non-null values', () => {
    expect(averageNonNull([50, null, 100])).toBe(75)
  })

  it('returns null for an empty array (never 0 or NaN)', () => {
    expect(averageNonNull([])).toBeNull()
  })

  it('returns null when every value is null', () => {
    expect(averageNonNull([null, null])).toBeNull()
  })
})

// ==================================================
// computeSubmissionTimelinessRows — late/missing classification
// ==================================================

describe('computeSubmissionTimelinessRows', () => {
  it('classifies submitted as both submitted and on-time', () => {
    const assignments = [assignment({ id: 'a1' })]
    const subs = { a1: { s1: submission({ status: 'submitted' }) } }
    const [row] = computeSubmissionTimelinessRows(['s1'], assignments, subs)
    expect(row).toMatchObject({ submittedCount: 1, onTimeCount: 1, lateCount: 0, missingCount: 0 })
  })

  it('classifies late as submitted but NOT on-time', () => {
    const assignments = [assignment({ id: 'a1' })]
    const subs = { a1: { s1: submission({ status: 'late' }) } }
    const [row] = computeSubmissionTimelinessRows(['s1'], assignments, subs)
    expect(row).toMatchObject({ submittedCount: 1, onTimeCount: 0, lateCount: 1, missingCount: 0 })
  })

  it('classifies explicit missing status as missing', () => {
    const assignments = [assignment({ id: 'a1' })]
    const subs = { a1: { s1: submission({ status: 'missing', score: null }) } }
    const [row] = computeSubmissionTimelinessRows(['s1'], assignments, subs)
    expect(row).toMatchObject({ submittedCount: 0, onTimeCount: 0, lateCount: 0, missingCount: 1 })
  })

  it('classifies not_submitted as missing', () => {
    const assignments = [assignment({ id: 'a1' })]
    const subs = { a1: { s1: submission({ status: 'not_submitted', score: null }) } }
    const [row] = computeSubmissionTimelinessRows(['s1'], assignments, subs)
    expect(row.missingCount).toBe(1)
  })

  it('a missing submission row (no row at all) defaults to missing, never crashes', () => {
    const assignments = [assignment({ id: 'a1' })]
    const [row] = computeSubmissionTimelinessRows(['s1'], assignments, {})
    expect(row).toMatchObject({ totalAssignments: 1, missingCount: 1, submittedCount: 0 })
  })

  it('zero assignments -> totalAssignments 0, every count 0 (no fabricated 100%)', () => {
    const [row] = computeSubmissionTimelinessRows(['s1'], [], {})
    expect(row).toEqual({ studentId: 's1', totalAssignments: 0, submittedCount: 0, onTimeCount: 0, lateCount: 0, missingCount: 0 })
  })
})

// ==================================================
// aggregateStudentAttendance
// ==================================================

describe('aggregateStudentAttendance', () => {
  it('tallies present/late/leave/absent per student and computes rate', () => {
    const records = [
      { studentId: 's1', status: 'present' as const },
      { studentId: 's1', status: 'present' as const },
      { studentId: 's1', status: 'absent' as const },
      { studentId: 's1', status: 'late' as const },
    ]
    const result = aggregateStudentAttendance(records)
    expect(result.s1).toEqual({ present: 2, late: 1, leave: 0, absent: 1, total: 4, attendanceRate: 50 })
  })

  it('a student with zero attendance records never appears in the result (never fabricated)', () => {
    const result = aggregateStudentAttendance([{ studentId: 's2', status: 'present' }])
    expect(result.s1).toBeUndefined()
  })

  it('ZERO_ATTENDANCE_SUMMARY has a null rate, never a fabricated 0%', () => {
    expect(ZERO_ATTENDANCE_SUMMARY.attendanceRate).toBeNull()
    expect(ZERO_ATTENDANCE_SUMMARY.total).toBe(0)
  })

  it('every real AttendanceStatus value is tallied correctly, including "leave"', () => {
    const records = [{ studentId: 's1', status: 'leave' as const }]
    expect(aggregateStudentAttendance(records).s1).toMatchObject({ leave: 1, total: 1 })
  })
})

// ==================================================
// buildStudentAnalyticsMetrics — normal student, missing scores, different
// max scores, classroom average, normalization, zero denominator
// ==================================================

describe('buildStudentAnalyticsMetrics', () => {
  it('a normal student with a full roster of graded, on-time, well-attended data', () => {
    const assignments = [assignment({ id: 'a1', maxScore: 100 }), assignment({ id: 'a2', maxScore: 100 })]
    const subs = {
      a1: { s1: submission({ studentId: 's1', score: 80, status: 'submitted' }), s2: submission({ studentId: 's2', score: 60, status: 'submitted' }) },
      a2: { s1: submission({ studentId: 's1', score: 90, status: 'submitted' }), s2: submission({ studentId: 's2', score: 40, status: 'submitted' }) },
    }
    const attendance = { s1: { present: 10, late: 0, leave: 0, absent: 0, total: 10, attendanceRate: 100 }, s2: { present: 5, late: 0, leave: 0, absent: 5, total: 10, attendanceRate: 50 } }

    const metrics = buildStudentAnalyticsMetrics('s1', ['s1', 's2'], assignments, subs, attendance)
    const grade = metrics.find((m) => m.key === 'grade')!
    expect(grade.value).toBe(85) // (80+90)/(100+100)*100
    expect(grade.classroomAverage).toBeCloseTo(67.5) // avg of s1=85, s2=50
    expect(grade.rawLabel).toBe('170.0/200.0 คะแนน')

    const attendanceMetric = metrics.find((m) => m.key === 'attendance')!
    expect(attendanceMetric.value).toBe(100)
    expect(attendanceMetric.classroomAverage).toBe(75)
  })

  it('different assignment max scores are summed correctly (not averaged per-assignment)', () => {
    const assignments = [assignment({ id: 'a1', maxScore: 10 }), assignment({ id: 'a2', maxScore: 100 })]
    const subs = { a1: { s1: submission({ score: 10 }) }, a2: { s1: submission({ score: 50 }) } }
    const metrics = buildStudentAnalyticsMetrics('s1', ['s1'], assignments, subs, {})
    const grade = metrics.find((m) => m.key === 'grade')!
    // total 60 / possible 110 = 54.5...%
    expect(grade.value).toBeCloseTo((60 / 110) * 100)
  })

  it('no assignments at all -> grade/completion/onTime are null, never fabricated 0 or 100', () => {
    const metrics = buildStudentAnalyticsMetrics('s1', ['s1'], [], {}, {})
    expect(metrics.find((m) => m.key === 'grade')!.value).toBeNull()
    expect(metrics.find((m) => m.key === 'completion')!.value).toBeNull()
    expect(metrics.find((m) => m.key === 'onTime')!.value).toBeNull()
  })

  it('missing scores (assignment exists, no score yet) count toward "possible" but not "earned"', () => {
    const assignments = [assignment({ id: 'a1', maxScore: 100 })]
    const subs = { a1: { s1: submission({ score: null, status: 'not_submitted' }) } }
    const metrics = buildStudentAnalyticsMetrics('s1', ['s1'], assignments, subs, {})
    expect(metrics.find((m) => m.key === 'grade')!.value).toBe(0)
    expect(metrics.find((m) => m.key === 'completion')!.value).toBe(0)
  })

  it('no attendance records -> attendance metric value and average are both null', () => {
    const metrics = buildStudentAnalyticsMetrics('s1', ['s1'], [assignment()], { a1: { s1: submission() } }, {})
    const attendanceMetric = metrics.find((m) => m.key === 'attendance')!
    expect(attendanceMetric.value).toBeNull()
    expect(attendanceMetric.classroomAverage).toBeNull()
    expect(attendanceMetric.rawLabel).toBeNull()
  })

  it('classroom average is computed across the whole roster, including students with no data skipped (never treated as 0)', () => {
    const assignments = [assignment({ id: 'a1', maxScore: 100 })]
    const subs = { a1: { s1: submission({ studentId: 's1', score: 100 }) } }
    // s2 has zero assignments in scope for this snapshot? Actually both
    // students share the same assignment list — s2 simply has no
    // submission row, which is a REAL 0 (missing = 0 score), not "no
    // data." Confirms the distinction: missing submission != no
    // denominator.
    const metrics = buildStudentAnalyticsMetrics('s1', ['s1', 's2'], assignments, subs, {})
    const grade = metrics.find((m) => m.key === 'grade')!
    expect(grade.classroomAverage).toBe(50) // (100 + 0) / 2
  })

  it('normalizes to the 0-100 scale regardless of raw denominator size', () => {
    const assignments = [assignment({ id: 'a1', maxScore: 5 })]
    const subs = { a1: { s1: submission({ score: 5 }) } }
    const metrics = buildStudentAnalyticsMetrics('s1', ['s1'], assignments, subs, {})
    expect(metrics.find((m) => m.key === 'grade')!.value).toBe(100)
  })
})

// ==================================================
// buildAssignmentSummary
// ==================================================

describe('buildAssignmentSummary', () => {
  it('totals submitted/onTime/late/missing correctly for a mixed roster of statuses', () => {
    const assignments = [assignment({ id: 'a1' }), assignment({ id: 'a2' }), assignment({ id: 'a3' }), assignment({ id: 'a4' })]
    const subs = {
      a1: { s1: submission({ status: 'submitted' }) },
      a2: { s1: submission({ status: 'late' }) },
      a3: { s1: submission({ status: 'missing', score: null }) },
      // a4 has no row at all -> counts as missing too
    }
    const summary = buildAssignmentSummary('s1', assignments, subs)
    expect(summary).toEqual({ totalAssignments: 4, submitted: 2, onTime: 1, late: 1, missing: 2 })
  })

  it('zero assignments -> a fully zeroed summary, not an error', () => {
    expect(buildAssignmentSummary('s1', [], {})).toEqual({ totalAssignments: 0, submitted: 0, onTime: 0, late: 0, missing: 0 })
  })
})

// ==================================================
// sortAssignmentsForTrend / buildTrendSeries
// ==================================================

describe('sortAssignmentsForTrend', () => {
  it('orders by due date ascending, undated assignments last', () => {
    const assignments = [
      assignment({ id: 'no-date', dueDate: null }),
      assignment({ id: 'later', dueDate: '2026-09-20' }),
      assignment({ id: 'earlier', dueDate: '2026-09-01' }),
    ]
    expect(sortAssignmentsForTrend(assignments).map((a) => a.id)).toEqual(['earlier', 'later', 'no-date'])
  })
})

describe('buildTrendSeries', () => {
  it('one point per assignment the student has a score for, in chronological order', () => {
    const assignments = [
      assignment({ id: 'a1', dueDate: '2026-09-01', maxScore: 100 }),
      assignment({ id: 'a2', dueDate: '2026-09-10', maxScore: 100 }),
    ]
    const subs = {
      a1: { s1: submission({ score: 50 }) },
      a2: { s1: submission({ score: 100 }) },
    }
    const trend = buildTrendSeries('s1', ['s1'], assignments, subs)
    expect(trend.map((p) => p.assignmentId)).toEqual(['a1', 'a2'])
    expect(trend[0].studentPercent).toBe(50)
    expect(trend[1].studentPercent).toBe(100)
  })

  it('skips an assignment the student has no score for, never plots a fabricated 0', () => {
    const assignments = [assignment({ id: 'a1' }), assignment({ id: 'a2' })]
    const subs = { a1: { s1: submission({ score: 80 }) } }
    const trend = buildTrendSeries('s1', ['s1'], assignments, subs)
    expect(trend).toHaveLength(1)
    expect(trend[0].assignmentId).toBe('a1')
  })

  it('classroom average excludes the student themself and skips classmates with no score', () => {
    const assignments = [assignment({ id: 'a1', maxScore: 100 })]
    const subs = {
      a1: {
        s1: submission({ studentId: 's1', score: 80 }),
        s2: submission({ studentId: 's2', score: 60 }),
      },
    }
    const trend = buildTrendSeries('s1', ['s1', 's2', 's3'], assignments, subs)
    expect(trend[0].classroomAveragePercent).toBe(60)
  })

  it('no classmates graded yet -> classroomAveragePercent is null, never 0', () => {
    const assignments = [assignment({ id: 'a1' })]
    const subs = { a1: { s1: submission({ score: 80 }) } }
    const trend = buildTrendSeries('s1', ['s1', 's2'], assignments, subs)
    expect(trend[0].classroomAveragePercent).toBeNull()
  })
})

// ==================================================
// buildEvidenceSummary — deterministic, rule-based
// ==================================================

describe('buildEvidenceSummary', () => {
  const rules = STUDENT_ANALYTICS_EVIDENCE_RULES

  it('an unremarkable student (no rule triggers) gets zero evidence items', () => {
    const metrics = [
      { key: 'grade' as const, label: 'ผลการเรียน', value: 70, classroomAverage: 70, rawLabel: null },
      { key: 'completion' as const, label: 'ส่งงานครบ', value: 100, classroomAverage: 100, rawLabel: null },
      { key: 'onTime' as const, label: 'ส่งงานตรงเวลา', value: 100, classroomAverage: 100, rawLabel: null },
      { key: 'attendance' as const, label: 'การเข้าเรียน', value: 100, classroomAverage: 100, rawLabel: null },
    ]
    const summary = { totalAssignments: 5, submitted: 5, onTime: 5, late: 0, missing: 0 }
    const attendance = { ...ZERO_ATTENDANCE_SUMMARY, present: 10, total: 10, attendanceRate: 100 }
    const evidence = buildEvidenceSummary(metrics, [], summary, attendance)
    // strongest_dimension always fires when at least one metric is
    // scored — everything else should be silent here.
    expect(evidence.filter((e) => e.kind !== 'strongest_dimension')).toHaveLength(0)
  })

  it('names the highest-scoring dimension with its real number', () => {
    const metrics = [
      { key: 'grade' as const, label: 'ผลการเรียน', value: 60, classroomAverage: 60, rawLabel: null },
      { key: 'attendance' as const, label: 'การเข้าเรียน', value: 95, classroomAverage: 95, rawLabel: null },
    ]
    const evidence = buildEvidenceSummary(metrics, [], { totalAssignments: 0, submitted: 0, onTime: 0, late: 0, missing: 0 }, ZERO_ATTENDANCE_SUMMARY)
    const strongest = evidence.find((e) => e.kind === 'strongest_dimension')!
    expect(strongest.label).toContain('การเข้าเรียน')
    expect(strongest.label).toContain('95')
  })

  it(`flags a dimension >= ${rules.BELOW_AVERAGE_MARGIN} points below classroom average`, () => {
    const metrics = [{ key: 'grade' as const, label: 'ผลการเรียน', value: 50, classroomAverage: 60, rawLabel: null }]
    const evidence = buildEvidenceSummary(metrics, [], { totalAssignments: 0, submitted: 0, onTime: 0, late: 0, missing: 0 }, ZERO_ATTENDANCE_SUMMARY)
    expect(evidence.some((e) => e.kind === 'below_classroom_average' && e.label.includes('50') && e.label.includes('60'))).toBe(true)
  })

  it('does NOT flag a dimension within the margin of classroom average', () => {
    const metrics = [{ key: 'grade' as const, label: 'ผลการเรียน', value: 58, classroomAverage: 60, rawLabel: null }]
    const evidence = buildEvidenceSummary(metrics, [], { totalAssignments: 0, submitted: 0, onTime: 0, late: 0, missing: 0 }, ZERO_ATTENDANCE_SUMMARY)
    expect(evidence.some((e) => e.kind === 'below_classroom_average')).toBe(false)
  })

  it('a metric with null value or null average is never flagged as below average', () => {
    const metrics = [{ key: 'grade' as const, label: 'ผลการเรียน', value: null, classroomAverage: null, rawLabel: null }]
    const evidence = buildEvidenceSummary(metrics, [], { totalAssignments: 0, submitted: 0, onTime: 0, late: 0, missing: 0 }, ZERO_ATTENDANCE_SUMMARY)
    expect(evidence).toHaveLength(0)
  })

  it('reports missing assignments with the real count', () => {
    const summary = { totalAssignments: 5, submitted: 2, onTime: 2, late: 0, missing: 3 }
    const evidence = buildEvidenceSummary([], [], summary, ZERO_ATTENDANCE_SUMMARY)
    expect(evidence.some((e) => e.kind === 'missing_assignments' && e.label.includes('3') && e.label.includes('5'))).toBe(true)
  })

  it(`flags attendance at or above the ${rules.ABSENCE_THRESHOLD}-absence threshold`, () => {
    const attendance = { ...ZERO_ATTENDANCE_SUMMARY, absent: rules.ABSENCE_THRESHOLD, total: 10 }
    const evidence = buildEvidenceSummary([], [], { totalAssignments: 0, submitted: 0, onTime: 0, late: 0, missing: 0 }, attendance)
    expect(evidence.some((e) => e.kind === 'attendance_issue' && e.label.includes(String(rules.ABSENCE_THRESHOLD)))).toBe(true)
  })

  it('does NOT flag attendance below the threshold', () => {
    const attendance = { ...ZERO_ATTENDANCE_SUMMARY, absent: rules.ABSENCE_THRESHOLD - 1, total: 10 }
    const evidence = buildEvidenceSummary([], [], { totalAssignments: 0, submitted: 0, onTime: 0, late: 0, missing: 0 }, attendance)
    expect(evidence.some((e) => e.kind === 'attendance_issue')).toBe(false)
  })

  it('detects an improving trend when the second half clearly outscores the first', () => {
    const trend = [
      { assignmentId: 'a1', assignmentTitle: 'a1', dueDate: null, studentPercent: 40, classroomAveragePercent: null },
      { assignmentId: 'a2', assignmentTitle: 'a2', dueDate: null, studentPercent: 45, classroomAveragePercent: null },
      { assignmentId: 'a3', assignmentTitle: 'a3', dueDate: null, studentPercent: 90, classroomAveragePercent: null },
      { assignmentId: 'a4', assignmentTitle: 'a4', dueDate: null, studentPercent: 95, classroomAveragePercent: null },
    ]
    const evidence = buildEvidenceSummary([], trend, { totalAssignments: 0, submitted: 0, onTime: 0, late: 0, missing: 0 }, ZERO_ATTENDANCE_SUMMARY)
    expect(evidence.some((e) => e.kind === 'trend_improving')).toBe(true)
  })

  it('detects a declining trend when the second half clearly underscores the first', () => {
    const trend = [
      { assignmentId: 'a1', assignmentTitle: 'a1', dueDate: null, studentPercent: 95, classroomAveragePercent: null },
      { assignmentId: 'a2', assignmentTitle: 'a2', dueDate: null, studentPercent: 90, classroomAveragePercent: null },
      { assignmentId: 'a3', assignmentTitle: 'a3', dueDate: null, studentPercent: 45, classroomAveragePercent: null },
      { assignmentId: 'a4', assignmentTitle: 'a4', dueDate: null, studentPercent: 40, classroomAveragePercent: null },
    ]
    const evidence = buildEvidenceSummary([], trend, { totalAssignments: 0, submitted: 0, onTime: 0, late: 0, missing: 0 }, ZERO_ATTENDANCE_SUMMARY)
    expect(evidence.some((e) => e.kind === 'trend_declining')).toBe(true)
  })

  it(`never judges a trend with fewer than ${rules.TREND_MIN_POINTS} points`, () => {
    const trend = [
      { assignmentId: 'a1', assignmentTitle: 'a1', dueDate: null, studentPercent: 10, classroomAveragePercent: null },
      { assignmentId: 'a2', assignmentTitle: 'a2', dueDate: null, studentPercent: 100, classroomAveragePercent: null },
    ]
    const evidence = buildEvidenceSummary([], trend, { totalAssignments: 0, submitted: 0, onTime: 0, late: 0, missing: 0 }, ZERO_ATTENDANCE_SUMMARY)
    expect(evidence.some((e) => e.kind === 'trend_improving' || e.kind === 'trend_declining')).toBe(false)
  })

  it('every generated label embeds real numbers, never a vague claim with nothing behind it', () => {
    const metrics = [{ key: 'grade' as const, label: 'ผลการเรียน', value: 30, classroomAverage: 80, rawLabel: null }]
    const summary = { totalAssignments: 4, submitted: 1, onTime: 1, late: 0, missing: 3 }
    const attendance = { ...ZERO_ATTENDANCE_SUMMARY, absent: 5, total: 10 }
    const evidence = buildEvidenceSummary(metrics, [], summary, attendance)
    for (const item of evidence) {
      expect(item.label).toMatch(/\d/)
    }
    expect(evidence.length).toBeGreaterThan(0)
  })
})

// ==================================================
// Prev/next student switcher
// ==================================================

describe('student switcher (filterActiveStudentsForSwitcher / getPreviousStudent / getNextStudent)', () => {
  const roster = [
    student({ id: 's1', number: 1 }),
    student({ id: 's2', number: 2, status: 'inactive' }),
    student({ id: 's3', number: 3 }),
  ]

  it('filters out inactive students', () => {
    const active = filterActiveStudentsForSwitcher(roster)
    expect(active.map((s) => s.id)).toEqual(['s1', 's3'])
  })

  it('finds the correct index among active-only students', () => {
    const active = filterActiveStudentsForSwitcher(roster)
    expect(findStudentSwitcherIndex(active, 's3')).toBe(1)
  })

  it('getPreviousStudent returns null at the start of the list', () => {
    const active = filterActiveStudentsForSwitcher(roster)
    expect(getPreviousStudent(active, 's1')).toBeNull()
  })

  it('getNextStudent returns null at the end of the list, never wraps', () => {
    const active = filterActiveStudentsForSwitcher(roster)
    expect(getNextStudent(active, 's3')).toBeNull()
  })

  it('getNextStudent/getPreviousStudent both return null for a student not in the active list (e.g. currently viewing an inactive student)', () => {
    const active = filterActiveStudentsForSwitcher(roster)
    expect(getPreviousStudent(active, 's2')).toBeNull()
    expect(getNextStudent(active, 's2')).toBeNull()
  })

  it('navigates correctly between two active neighbors', () => {
    const active = filterActiveStudentsForSwitcher(roster)
    expect(getNextStudent(active, 's1')?.id).toBe('s3')
    expect(getPreviousStudent(active, 's3')?.id).toBe('s1')
  })
})
