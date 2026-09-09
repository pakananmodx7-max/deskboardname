import { describe, expect, it } from 'vitest'

import {
  buildAttendanceExportTable,
  buildFilterSubtitle,
  buildFollowUpExportTable,
  buildGradeExportTable,
  buildMissingAssignmentExportTable,
} from '@/features/reports-real/report-export-builders'
import type { AttendanceSummaryRow, FollowUpRow, GradeSummaryGroup, MissingAssignmentRow, ReportFilters } from '@/types/report'

function filters(overrides: Partial<ReportFilters> = {}): ReportFilters {
  return { classroomId: null, subjectId: null, startDate: '2026-09-01', endDate: '2026-09-30', ...overrides }
}

describe('buildFilterSubtitle', () => {
  it('shows "ทุกห้องเรียน"/"ทุกวิชา" when no filter is selected', () => {
    const subtitle = buildFilterSubtitle(filters(), null, null)
    expect(subtitle).toContain('ทุกห้องเรียน')
    expect(subtitle).toContain('ทุกวิชา')
  })

  it('shows the actual classroom/subject name when filters are selected — reflects the current filters exactly', () => {
    const subtitle = buildFilterSubtitle(filters({ classroomId: 'room-1', subjectId: 'subj-1' }), 'ม.5/1', 'คณิตศาสตร์')
    expect(subtitle).toContain('ม.5/1')
    expect(subtitle).toContain('คณิตศาสตร์')
    expect(subtitle).not.toContain('ทุกห้องเรียน')
  })
})

describe('buildAttendanceExportTable — export data correctness', () => {
  it('produces one data row per report row with matching header count', () => {
    const rows: AttendanceSummaryRow[] = [
      {
        studentId: 's1',
        studentCode: 'S001',
        number: 1,
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        classroomId: 'room-1',
        classroomName: 'ม.5/1',
        present: 8,
        late: 1,
        leave: 0,
        absent: 1,
        total: 10,
        attendanceRate: 80,
      },
    ]
    const table = buildAttendanceExportTable(rows, 'subtitle')
    expect(table.rows).toHaveLength(1)
    expect(table.rows[0]).toHaveLength(table.headers.length)
    expect(table.rows[0]).toEqual([1, 'สมชาย ใจดี', 'S001', 'ม.5/1', 8, 1, 0, 1, 10, '80.0%'])
  })
})

describe('buildGradeExportTable — export data correctness', () => {
  it('flattens one row per (student, assignment) across every group', () => {
    const groups: GradeSummaryGroup[] = [
      {
        subjectId: 'subj-1',
        subjectName: 'คณิตศาสตร์',
        classroomId: 'room-1',
        classroomName: 'ม.5/1',
        assignments: [{ assignmentId: 'a1', title: 'งาน 1', maxScore: 100, dueDate: null }],
        students: [
          {
            studentId: 's1',
            studentCode: 'S001',
            number: 1,
            firstName: 'สมชาย',
            lastName: 'ใจดี',
            classroomId: 'room-1',
            classroomName: 'ม.5/1',
            scoresByAssignment: { a1: 80 },
            totalEarned: 80,
            totalPossible: 100,
            percentage: 80,
          },
        ],
      },
    ]
    const table = buildGradeExportTable(groups, 'subtitle')
    expect(table.rows).toHaveLength(1)
    expect(table.rows[0]).toContain('คณิตศาสตร์')
    expect(table.rows[0]).toContain(80)
  })

  it('shows a dash for an ungraded assignment rather than 0 or blank', () => {
    const groups: GradeSummaryGroup[] = [
      {
        subjectId: 'subj-1',
        subjectName: 'คณิตศาสตร์',
        classroomId: 'room-1',
        classroomName: 'ม.5/1',
        assignments: [{ assignmentId: 'a1', title: 'งาน 1', maxScore: 100, dueDate: null }],
        students: [
          {
            studentId: 's1',
            studentCode: null,
            number: 1,
            firstName: 'สมชาย',
            lastName: 'ใจดี',
            classroomId: 'room-1',
            classroomName: 'ม.5/1',
            scoresByAssignment: { a1: null },
            totalEarned: 0,
            totalPossible: 100,
            percentage: 0,
          },
        ],
      },
    ]
    const table = buildGradeExportTable(groups, 'subtitle')
    expect(table.rows[0]).toContain('-')
  })
})

describe('buildMissingAssignmentExportTable — export data correctness', () => {
  it('translates status codes into Thai labels', () => {
    const rows: MissingAssignmentRow[] = [
      {
        studentId: 's1',
        studentCode: null,
        number: 1,
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        classroomId: 'room-1',
        classroomName: 'ม.5/1',
        assignmentId: 'a1',
        assignmentTitle: 'งาน 1',
        subjectId: 'subj-1',
        subjectName: 'คณิตศาสตร์',
        dueDate: null,
        status: 'missing',
      },
    ]
    const table = buildMissingAssignmentExportTable(rows, 'subtitle')
    expect(table.rows[0]).toContain('ขาดส่ง')
    expect(table.rows[0]).toContain('ไม่มีกำหนดส่ง')
  })
})

describe('buildFollowUpExportTable — export data correctness', () => {
  it('joins multiple reasons into one cell and counts them', () => {
    const rows: FollowUpRow[] = [
      {
        studentId: 's1',
        studentCode: null,
        number: 1,
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        classroomId: 'room-1',
        classroomName: 'ม.5/1',
        reasons: [
          { rule: 'repeated_absences', label: 'ขาดเรียน 5 ครั้ง', shortLabel: 'ขาด 5 ครั้ง' },
          { rule: 'low_grade_percentage', label: 'คะแนนรวม 20%', shortLabel: 'คะแนน 20%' },
        ],
      },
    ]
    const table = buildFollowUpExportTable(rows, 'subtitle')
    expect(table.rows[0]).toContain(2)
    expect(table.rows[0].join('|')).toContain('ขาดเรียน 5 ครั้ง')
    expect(table.rows[0].join('|')).toContain('คะแนนรวม 20%')
  })
})
