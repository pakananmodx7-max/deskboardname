import { describe, expect, it } from 'vitest'

import {
  computeAttendanceRate,
  computeMyGrades,
  countUnreadNotifications,
  filterMyAssignments,
  getPendingAssignments,
  isMissingOptionalColumnError,
  isOptionalTableMissingError,
  mergeCalendarItems,
  summarizeMyAttendance,
  summarizeMyTodo,
  validateAvatarFile,
} from '@/services/student-portal-service'
import type { MyAssignment, MyAttendanceRecord, MyCalendarEntry, MyNotification } from '@/types/student-portal'

function assignment(overrides: Partial<MyAssignment> = {}): MyAssignment {
  return {
    id: 'a1',
    subjectId: 'subj-1',
    subjectName: 'คณิตศาสตร์',
    classroomId: 'room-1',
    classroomName: 'ม.5/1',
    title: 'แบบฝึกหัด',
    description: null,
    maxScore: 100,
    dueDate: '2026-09-01',
    status: 'not_submitted',
    score: null,
    ...overrides,
  }
}

function attendance(overrides: Partial<MyAttendanceRecord> = {}): MyAttendanceRecord {
  return {
    sessionId: 's1',
    classroomId: 'room-1',
    classroomName: 'ม.5/1',
    subjectId: null,
    subjectName: null,
    periodNumber: null,
    attendanceDate: '2026-09-01',
    status: 'present',
    ...overrides,
  }
}

describe('filterMyAssignments — /student/assignments filter tabs', () => {
  const items = [
    assignment({ id: 'a1', status: 'not_submitted' }),
    assignment({ id: 'a2', status: 'submitted' }),
    assignment({ id: 'a3', status: 'late' }),
    assignment({ id: 'a4', status: 'missing' }),
  ]

  it('"all" returns every assignment unfiltered', () => {
    expect(filterMyAssignments(items, 'all')).toHaveLength(4)
  })

  it('filters to exactly one status at a time', () => {
    expect(filterMyAssignments(items, 'not_submitted').map((a) => a.id)).toEqual(['a1'])
    expect(filterMyAssignments(items, 'submitted').map((a) => a.id)).toEqual(['a2'])
    expect(filterMyAssignments(items, 'late').map((a) => a.id)).toEqual(['a3'])
    expect(filterMyAssignments(items, 'missing').map((a) => a.id)).toEqual(['a4'])
  })
})

describe('getPendingAssignments — dashboard "งานที่ต้องทำ"', () => {
  it('includes not_submitted and late, excludes submitted and missing', () => {
    const items = [
      assignment({ id: 'a1', status: 'not_submitted' }),
      assignment({ id: 'a2', status: 'submitted' }),
      assignment({ id: 'a3', status: 'late' }),
      assignment({ id: 'a4', status: 'missing' }),
    ]
    expect(getPendingAssignments(items).map((a) => a.id)).toEqual(['a1', 'a3'])
  })
})

describe('summarizeMyAttendance / computeAttendanceRate', () => {
  it('tallies each status and computes the present-rate percentage', () => {
    const records = [
      attendance({ status: 'present' }),
      attendance({ status: 'present' }),
      attendance({ status: 'late' }),
      attendance({ status: 'absent' }),
    ]
    const summary = summarizeMyAttendance(records)
    expect(summary).toEqual({ present: 2, late: 1, leave: 0, absent: 1, total: 4 })
    expect(computeAttendanceRate(summary)).toBe(50)
  })

  it('returns null attendance rate (never NaN) when there is no history yet', () => {
    const summary = summarizeMyAttendance([])
    expect(summary.total).toBe(0)
    expect(computeAttendanceRate(summary)).toBeNull()
  })
})

describe('computeMyGrades — /student/grades, never another student\'s data', () => {
  it('groups by subject+classroom, computing per-subject and grand totals', () => {
    const items = [
      assignment({ id: 'a1', subjectId: 'math', subjectName: 'คณิตศาสตร์', classroomId: 'r1', maxScore: 100, score: 80 }),
      assignment({ id: 'a2', subjectId: 'math', subjectName: 'คณิตศาสตร์', classroomId: 'r1', maxScore: 50, score: null }),
      assignment({ id: 'a3', subjectId: 'eng', subjectName: 'อังกฤษ', classroomId: 'r1', maxScore: 100, score: 60 }),
    ]
    const result = computeMyGrades(items)

    expect(result.bySubject).toHaveLength(2)
    const math = result.bySubject.find((s) => s.subjectId === 'math')!
    expect(math.earned).toBe(80)
    expect(math.possible).toBe(150)
    expect(math.percentage).toBeCloseTo((80 / 150) * 100)
    expect(math.assignments.find((a) => a.assignmentId === 'a2')?.percentage).toBeNull()

    expect(result.totalEarned).toBe(140)
    expect(result.totalPossible).toBe(250)
    expect(result.totalPercentage).toBeCloseTo((140 / 250) * 100)
  })

  it('never shows a class average/highest/lowest — the summary has no such fields', () => {
    const result = computeMyGrades([assignment()])
    expect(result).not.toHaveProperty('classAverage')
    expect(result).not.toHaveProperty('highest')
    expect(result).not.toHaveProperty('lowest')
  })

  it('returns an empty summary (0/0/null) with no assignments', () => {
    const result = computeMyGrades([])
    expect(result).toEqual({ bySubject: [], totalEarned: 0, totalPossible: 0, totalPercentage: null })
  })
})

describe('summarizeMyTodo — dashboard "งานของฉัน" summary', () => {
  const now = new Date('2026-09-10T00:00:00Z')

  it('counts outstanding (not_submitted + late), due-soon (within 3 days, overdue included), and submitted', () => {
    const items = [
      assignment({ id: 'a1', status: 'not_submitted', dueDate: '2026-09-11' }), // within 3 days
      assignment({ id: 'a2', status: 'late', dueDate: '2026-09-05' }), // overdue -> still due-soon
      assignment({ id: 'a3', status: 'not_submitted', dueDate: '2026-09-30' }), // far future
      assignment({ id: 'a4', status: 'not_submitted', dueDate: null }), // no due date
      assignment({ id: 'a5', status: 'submitted' }),
      assignment({ id: 'a6', status: 'missing' }),
    ]
    const result = summarizeMyTodo(items, now)
    expect(result.outstanding).toBe(4) // a1, a2, a3, a4
    expect(result.dueSoon).toBe(2) // a1, a2
    expect(result.submitted).toBe(1) // a5 only — 'late' is not "already submitted" in this app's status model
  })

  it('returns all-zero for an empty assignment list', () => {
    expect(summarizeMyTodo([], now)).toEqual({ outstanding: 0, dueSoon: 0, submitted: 0 })
  })
})

function calendarEntry(overrides: Partial<MyCalendarEntry> = {}): MyCalendarEntry {
  return {
    id: 'ce1',
    title: 'ทบทวนบทที่ 3',
    note: null,
    eventDate: '2026-09-12',
    eventTime: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

describe('mergeCalendarItems — personal notes + read-only assignment due dates', () => {
  it('merges both kinds, sorted by date, and excludes assignments with no due date', () => {
    const entries = [calendarEntry({ id: 'ce1', eventDate: '2026-09-15' })]
    const assignments = [
      assignment({ id: 'a1', title: 'งาน 1', dueDate: '2026-09-10' }),
      assignment({ id: 'a2', title: 'งาน 2', dueDate: null }),
    ]
    const items = mergeCalendarItems(entries, assignments)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ kind: 'assignment-due', assignmentId: 'a1' })
    expect(items[1]).toMatchObject({ kind: 'note', entry: { id: 'ce1' } })
  })

  it('returns an empty list when there are no notes and no due dates', () => {
    expect(mergeCalendarItems([], [assignment({ dueDate: null })])).toEqual([])
  })
})

function notification(overrides: Partial<MyNotification> = {}): MyNotification {
  return {
    id: 'n1',
    senderName: 'ครูสมชาย',
    title: null,
    message: 'กรุณาติดต่อครู',
    readAt: null,
    createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

describe('countUnreadNotifications', () => {
  it('counts only notifications with readAt === null', () => {
    const items = [
      notification({ id: 'n1', readAt: null }),
      notification({ id: 'n2', readAt: '2026-09-02T00:00:00Z' }),
      notification({ id: 'n3', readAt: null }),
    ]
    expect(countUnreadNotifications(items)).toBe(2)
  })
})

describe('validateAvatarFile', () => {
  it('accepts jpg/png/webp under the size limit', () => {
    expect(validateAvatarFile({ type: 'image/jpeg', size: 1024 })).toBeNull()
    expect(validateAvatarFile({ type: 'image/png', size: 1024 })).toBeNull()
    expect(validateAvatarFile({ type: 'image/webp', size: 1024 })).toBeNull()
  })

  it('rejects an unsupported file type', () => {
    expect(validateAvatarFile({ type: 'image/gif', size: 1024 })).toMatch(/JPG, PNG หรือ WEBP/)
  })

  it('rejects a file over 2MB', () => {
    expect(validateAvatarFile({ type: 'image/jpeg', size: 2 * 1024 * 1024 + 1 })).toMatch(/2MB/)
  })
})

// ==================================================
// PRODUCTION BUG regression — 0012 (student_calendar_entries,
// teacher_student_notifications, students.avatar_path) is written but
// NOT applied to production. getMyStudentProfile/getMyCalendarEntries/
// getMyNotifications must degrade gracefully instead of throwing, since
// getMyStudentProfile in particular gates StudentLayout — every single
// /student/* route — and previously blanked the ENTIRE student portal
// the moment its SELECT named the not-yet-existing avatar_path column.
// ==================================================

describe('isMissingOptionalColumnError — the exact Postgres "undefined_column" error (42703)', () => {
  it('is true for a real undefined_column error, e.g. selecting students.avatar_path before 0012 is applied', () => {
    expect(isMissingOptionalColumnError({ code: '42703', message: 'column students.avatar_path does not exist' })).toBe(true)
  })

  it('is false for an unrelated error code', () => {
    expect(isMissingOptionalColumnError({ code: '42501', message: 'permission denied' })).toBe(false)
  })

  it('is false for null/undefined/a non-error value (never throws itself)', () => {
    expect(isMissingOptionalColumnError(null)).toBe(false)
    expect(isMissingOptionalColumnError(undefined)).toBe(false)
    expect(isMissingOptionalColumnError('not an error object')).toBe(false)
  })
})

describe('isOptionalTableMissingError — the exact Postgres "undefined_table" error (42P01)', () => {
  it('is true for a real undefined_table error, e.g. querying student_calendar_entries/teacher_student_notifications before 0012 is applied', () => {
    expect(isOptionalTableMissingError({ code: '42P01', message: 'relation "student_calendar_entries" does not exist' })).toBe(true)
  })

  it('is false for an unrelated error code', () => {
    expect(isOptionalTableMissingError({ code: '42703', message: 'column does not exist' })).toBe(false)
  })

  it('is false for null/undefined/a non-error value', () => {
    expect(isOptionalTableMissingError(null)).toBe(false)
    expect(isOptionalTableMissingError(undefined)).toBe(false)
  })
})
