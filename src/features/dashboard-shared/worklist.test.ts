import { describe, expect, it } from 'vitest'

import { attendanceToWorklistItems, assignmentsToWorklistItems, followUpToWorklistItems } from '@/features/dashboard-shared/worklist'
import type { AssignmentActionItem, TodayAttendanceStatus } from '@/services/dashboard-service'
import type { FollowUpRow } from '@/types/report'

function attendanceStatus(overrides: Partial<TodayAttendanceStatus> = {}): TodayAttendanceStatus {
  return {
    subjectId: 'subj-1',
    subjectName: 'คณิตศาสตร์',
    classroomId: 'room-1',
    classroomName: 'ม.5/1',
    status: 'not_taken',
    recordCount: 0,
    ...overrides,
  }
}

function assignmentItem(overrides: Partial<AssignmentActionItem> = {}): AssignmentActionItem {
  return {
    assignmentId: 'a-1',
    title: 'ใบงานที่ 1',
    subjectId: 'subj-1',
    subjectName: 'คณิตศาสตร์',
    classroomId: 'room-1',
    classroomName: 'ม.5/1',
    dueDate: null,
    submittedCount: 0,
    totalCount: 10,
    missingCount: 10,
    ungradedCount: 0,
    ...overrides,
  }
}

function followUpRow(overrides: Partial<FollowUpRow> = {}): FollowUpRow {
  return {
    studentId: 'stu-1',
    studentCode: 'S001',
    number: 1,
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    classroomId: 'room-1',
    classroomName: 'ม.5/1',
    reasons: [{ rule: 'repeated_absences', label: 'ขาดเรียน 4 ครั้ง (เกณฑ์ 3 ครั้งขึ้นไป)', shortLabel: 'ขาด 4 ครั้ง' }],
    ...overrides,
  }
}

describe('attendanceToWorklistItems', () => {
  it('includes only "not_taken" pairs — a worklist is what needs doing, not a full status report', () => {
    const items = attendanceToWorklistItems([attendanceStatus({ status: 'not_taken' }), attendanceStatus({ status: 'taken', classroomId: 'room-2' })])
    expect(items).toHaveLength(1)
    expect(items[0].actionLabel).toBe('เช็กชื่อ')
  })

  it('deep-links to the exact subject+classroom attendance tab, never a generic route', () => {
    const [item] = attendanceToWorklistItems([attendanceStatus()])
    expect(item.actionTo).toBe('/teacher/subjects/subj-1/classrooms/room-1?tab=attendance')
  })
})

describe('assignmentsToWorklistItems', () => {
  it('reuses selectAssignmentsNeedingAttention — an assignment with no missing/ungraded work is excluded', () => {
    const items = assignmentsToWorklistItems([assignmentItem({ missingCount: 0, ungradedCount: 0 })])
    expect(items).toHaveLength(0)
  })

  it('labels a missing-submissions item distinctly from an ungraded-only item', () => {
    const [missing] = assignmentsToWorklistItems([assignmentItem({ missingCount: 3, ungradedCount: 0 })])
    expect(missing.badgeLabel).toBe('ค้าง 3 คน')
    expect(missing.actionLabel).toBe('ดูงาน')

    const [ungraded] = assignmentsToWorklistItems([assignmentItem({ missingCount: 0, ungradedCount: 5 })])
    expect(ungraded.badgeLabel).toBe('ยังไม่ให้คะแนน 5 คน')
    expect(ungraded.actionLabel).toBe('ให้คะแนน')
  })

  it('deep-links to the exact assignment detail page', () => {
    const [item] = assignmentsToWorklistItems([assignmentItem()])
    expect(item.actionTo).toBe('/teacher/subjects/subj-1/classrooms/room-1/assignments/a-1')
  })
})

describe('followUpToWorklistItems', () => {
  it('uses the reason\'s shortLabel, the same compact label the old follow-up card used', () => {
    const [item] = followUpToWorklistItems([followUpRow()])
    expect(item.badgeLabel).toBe('ขาด 4 ครั้ง')
    expect(item.title).toBe('สมชาย ใจดี')
  })

  it('deep-links to the classroom\'s students tab', () => {
    const [item] = followUpToWorklistItems([followUpRow()])
    expect(item.actionTo).toBe('/teacher/classrooms/room-1?tab=students')
  })

  it('falls back to a generic label when a row somehow has no reasons', () => {
    const [item] = followUpToWorklistItems([followUpRow({ reasons: [] })])
    expect(item.badgeLabel).toBe('ควรติดตาม')
  })
})
