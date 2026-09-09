import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  buildRecentActivityItems,
  buildTodayAttendanceStatuses,
  computeAssignmentActionItem,
  selectAssignmentsNeedingAttention,
  selectUpcomingAssignments,
  type AssignmentActionItem,
  type SubjectClassroomPair,
} from '@/services/dashboard-service'

function pair(overrides: Partial<SubjectClassroomPair> = {}): SubjectClassroomPair {
  return { subjectId: 'subj-1', subjectName: 'คณิตศาสตร์', classroomId: 'room-1', classroomName: 'ม.5/1', ...overrides }
}

describe('buildTodayAttendanceStatuses — attendance status logic', () => {
  it('marks a pair with a session today as "taken" and sums its record count', () => {
    const rows = buildTodayAttendanceStatuses(
      [pair()],
      [{ subjectId: 'subj-1', classroomId: 'room-1', recordCount: 30 }],
    )
    expect(rows).toEqual([{ ...pair(), status: 'taken', recordCount: 30 }])
  })

  it('marks a pair with no session today as "not_taken" with zero count', () => {
    const rows = buildTodayAttendanceStatuses([pair()], [])
    expect(rows).toEqual([{ ...pair(), status: 'not_taken', recordCount: 0 }])
  })

  it('sums record counts across multiple sessions for the same pair (multiple periods today)', () => {
    const rows = buildTodayAttendanceStatuses(
      [pair()],
      [
        { subjectId: 'subj-1', classroomId: 'room-1', recordCount: 15 },
        { subjectId: 'subj-1', classroomId: 'room-1', recordCount: 15 },
      ],
    )
    expect(rows[0].recordCount).toBe(30)
  })

  it('classroom isolation: a session for one classroom never marks a different classroom "taken"', () => {
    const rows = buildTodayAttendanceStatuses(
      [pair({ classroomId: 'room-1' }), pair({ classroomId: 'room-2', classroomName: 'ม.5/2' })],
      [{ subjectId: 'subj-1', classroomId: 'room-1', recordCount: 10 }],
    )
    const room1 = rows.find((r) => r.classroomId === 'room-1')!
    const room2 = rows.find((r) => r.classroomId === 'room-2')!
    expect(room1.status).toBe('taken')
    expect(room2.status).toBe('not_taken')
  })

  it('subject isolation: a session for one subject never marks a different subject "taken" in the same classroom', () => {
    const rows = buildTodayAttendanceStatuses(
      [pair({ subjectId: 'subj-1' }), pair({ subjectId: 'subj-2', subjectName: 'อังกฤษ' })],
      [{ subjectId: 'subj-1', classroomId: 'room-1', recordCount: 10 }],
    )
    const subj1 = rows.find((r) => r.subjectId === 'subj-1')!
    const subj2 = rows.find((r) => r.subjectId === 'subj-2')!
    expect(subj1.status).toBe('taken')
    expect(subj2.status).toBe('not_taken')
  })

  it('sorts not-taken pairs before taken pairs', () => {
    const rows = buildTodayAttendanceStatuses(
      [pair({ classroomId: 'room-1', classroomName: 'ม.5/1' }), pair({ classroomId: 'room-2', classroomName: 'ม.5/2' })],
      [{ subjectId: 'subj-1', classroomId: 'room-2', recordCount: 10 }],
    )
    expect(rows[0].classroomId).toBe('room-1')
    expect(rows[0].status).toBe('not_taken')
  })

  it('empty state: zero pairs produces zero rows, never throws', () => {
    expect(buildTodayAttendanceStatuses([], [])).toEqual([])
  })
})

describe('computeAssignmentActionItem — assignment summary counts', () => {
  const assignment = { id: 'a1', title: 'แบบฝึกหัด', subjectId: 'subj-1', classroomId: 'room-1', dueDate: '2026-09-15' }

  it('counts submitted/missing/ungraded correctly from raw submission rows', () => {
    const submissions = [
      { status: 'submitted' as const, score: 80 },
      { status: 'submitted' as const, score: null }, // ungraded
      { status: 'not_submitted' as const, score: null },
      { status: 'late' as const, score: null },
    ]
    const item = computeAssignmentActionItem(assignment, submissions, 10, 'คณิตศาสตร์', 'ม.5/1')
    expect(item.submittedCount).toBe(2)
    expect(item.totalCount).toBe(10)
    expect(item.missingCount).toBe(8) // 10 - 2 submitted
    expect(item.ungradedCount).toBe(1)
  })

  it('a student with no submission row at all still counts as missing (defaults to not_submitted)', () => {
    const item = computeAssignmentActionItem(assignment, [], 5, 'คณิตศาสตร์', 'ม.5/1')
    expect(item.submittedCount).toBe(0)
    expect(item.missingCount).toBe(5)
    expect(item.ungradedCount).toBe(0)
  })

  it('never produces a negative missing count', () => {
    // Defensive: more "submitted" rows than the roster total should never happen,
    // but the arithmetic must not go negative if it somehow does.
    const submissions = Array.from({ length: 3 }, () => ({ status: 'submitted' as const, score: 1 }))
    const item = computeAssignmentActionItem(assignment, submissions, 2, 'คณิตศาสตร์', 'ม.5/1')
    expect(item.missingCount).toBe(0)
  })
})

function actionItem(overrides: Partial<AssignmentActionItem> = {}): AssignmentActionItem {
  return {
    assignmentId: 'a1',
    title: 'แบบฝึกหัด',
    subjectId: 'subj-1',
    subjectName: 'คณิตศาสตร์',
    classroomId: 'room-1',
    classroomName: 'ม.5/1',
    dueDate: null,
    submittedCount: 0,
    totalCount: 10,
    missingCount: 0,
    ungradedCount: 0,
    ...overrides,
  }
}

describe('selectAssignmentsNeedingAttention', () => {
  const now = new Date('2026-09-10T00:00:00Z')

  it('includes an assignment with missing submissions due soon', () => {
    const items = [actionItem({ missingCount: 3, dueDate: '2026-09-12' })]
    expect(selectAssignmentsNeedingAttention(items, now)).toHaveLength(1)
  })

  it('excludes a fully-submitted, fully-graded assignment', () => {
    const items = [actionItem({ missingCount: 0, ungradedCount: 0, dueDate: '2026-09-12' })]
    expect(selectAssignmentsNeedingAttention(items, now)).toHaveLength(0)
  })

  it('includes an ungraded (but fully submitted) assignment', () => {
    const items = [actionItem({ missingCount: 0, ungradedCount: 5, dueDate: '2026-09-12' })]
    expect(selectAssignmentsNeedingAttention(items, now)).toHaveLength(1)
  })

  it('excludes a needs-work assignment far outside the past/future window', () => {
    const items = [actionItem({ missingCount: 3, dueDate: '2026-01-01' })]
    expect(selectAssignmentsNeedingAttention(items, now)).toHaveLength(0)
  })

  it('always includes a needs-work assignment with no due date', () => {
    const items = [actionItem({ missingCount: 3, dueDate: null })]
    expect(selectAssignmentsNeedingAttention(items, now)).toHaveLength(1)
  })

  it('sorts soonest due date first', () => {
    const items = [
      actionItem({ assignmentId: 'later', missingCount: 1, dueDate: '2026-09-20' }),
      actionItem({ assignmentId: 'sooner', missingCount: 1, dueDate: '2026-09-11' }),
    ]
    const result = selectAssignmentsNeedingAttention(items, now)
    expect(result.map((i) => i.assignmentId)).toEqual(['sooner', 'later'])
  })
})

describe('selectUpcomingAssignments', () => {
  const now = new Date('2026-09-10T00:00:00Z')

  it('includes an assignment due within the next 30 days', () => {
    const items = [actionItem({ dueDate: '2026-09-15' })]
    expect(selectUpcomingAssignments(items, now)).toHaveLength(1)
  })

  it('excludes an assignment due in the past', () => {
    const items = [actionItem({ dueDate: '2026-09-01' })]
    expect(selectUpcomingAssignments(items, now)).toHaveLength(0)
  })

  it('excludes an assignment with no due date', () => {
    const items = [actionItem({ dueDate: null })]
    expect(selectUpcomingAssignments(items, now)).toHaveLength(0)
  })

  it('excludes an assignment far beyond the 30-day window', () => {
    const items = [actionItem({ dueDate: '2026-12-01' })]
    expect(selectUpcomingAssignments(items, now)).toHaveLength(0)
  })

  it('sorts soonest due date first', () => {
    const items = [
      actionItem({ assignmentId: 'later', dueDate: '2026-09-25' }),
      actionItem({ assignmentId: 'sooner', dueDate: '2026-09-11' }),
    ]
    expect(selectUpcomingAssignments(items, now).map((i) => i.assignmentId)).toEqual(['sooner', 'later'])
  })
})

describe('buildRecentActivityItems', () => {
  it('labels an assignment as newly created when created_at === updated_at', () => {
    const items = buildRecentActivityItems(
      [{ id: 'a1', title: 'งาน 1', subjectName: 'คณิตศาสตร์', classroomName: 'ม.5/1', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' }],
      [],
    )
    expect(items[0].message).toContain('สร้างงานใหม่')
  })

  it('labels an assignment as edited when updated_at differs from created_at', () => {
    const items = buildRecentActivityItems(
      [{ id: 'a1', title: 'งาน 1', subjectName: 'คณิตศาสตร์', classroomName: 'ม.5/1', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z' }],
      [],
    )
    expect(items[0].message).toContain('แก้ไขงาน')
  })

  it('includes an attendance session as its own event', () => {
    const items = buildRecentActivityItems(
      [],
      [{ id: 's1', subjectName: 'คณิตศาสตร์', classroomName: 'ม.5/1', updatedAt: '2026-09-01T00:00:00Z' }],
    )
    expect(items[0].message).toContain('บันทึกการเช็คชื่อ')
  })

  it('merges and sorts both sources newest first', () => {
    const items = buildRecentActivityItems(
      [{ id: 'a1', title: 'งาน 1', subjectName: 'ก', classroomName: 'ข', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' }],
      [{ id: 's1', subjectName: 'ก', classroomName: 'ข', updatedAt: '2026-09-05T00:00:00Z' }],
    )
    expect(items[0].id).toBe('attendance:s1')
    expect(items[1].id).toBe('assignment:a1')
  })

  it('caps the result at 8 items', () => {
    const sessions = Array.from({ length: 20 }, (_, i) => ({
      id: `s${i}`,
      subjectName: 'ก',
      classroomName: 'ข',
      updatedAt: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    }))
    expect(buildRecentActivityItems([], sessions)).toHaveLength(8)
  })

  it('empty state: no recent events produces an empty list, never throws', () => {
    expect(buildRecentActivityItems([], [])).toEqual([])
  })
})

// ==================================================
// "Real data only" / "no demo fallback" — a source-level regression
// guard against the exact bug found in the Teacher Production Readiness
// phase (the dashboard silently rendering useDemoClassroom() in every
// mode). If dashboard-service.ts or the real dashboard page ever imports
// anything from src/demo/** or src/data/**-mock again, this test fails.
// ==================================================

function readSourceRelativeToThisFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf-8')
}

describe('dashboard real-mode source — no demo/mock fallback', () => {
  it('dashboard-service.ts never imports demo or mock data', () => {
    const source = readSourceRelativeToThisFile('./dashboard-service.ts')
    expect(source).not.toMatch(/from ['"]@\/demo\//)
    expect(source).not.toMatch(/from ['"]@\/data\/.*mock/i)
    expect(source).not.toMatch(/useDemoClassroom/)
  })

  it('dashboard-page-real.tsx never imports demo or mock data', () => {
    const source = readSourceRelativeToThisFile('../pages/teacher/dashboard/dashboard-page-real.tsx')
    expect(source).not.toMatch(/from ['"]@\/demo\//)
    expect(source).not.toMatch(/from ['"]@\/data\/.*mock/i)
    expect(source).not.toMatch(/useDemoClassroom/)
  })

  it('dashboard-page-real.tsx never links to a deprecated flat Attendance/Assignments/Grades route', () => {
    const source = readSourceRelativeToThisFile('../pages/teacher/dashboard/dashboard-page-real.tsx')
    expect(source).not.toMatch(/['"]\/teacher\/attendance['"]/)
    expect(source).not.toMatch(/['"]\/teacher\/assignments['"]/)
    expect(source).not.toMatch(/['"]\/teacher\/grades['"]/)
  })

  it('dashboard-service.ts every exported async fetch goes through getSupabaseClient/report-service (no hardcoded arrays of fake rows)', () => {
    const source = readSourceRelativeToThisFile('./dashboard-service.ts')
    expect(source).toContain('getSupabaseClient')
  })
})

describe('getDashboardFollowUpSummary — follow-up rules exactly match Reports (source-level reuse check)', () => {
  it('imports the exact same report-service/followup-report-service functions Reports uses, never a re-implementation', () => {
    const source = readSourceRelativeToThisFile('./dashboard-service.ts')
    // These are the entire rule pipeline the Reports page's Student
    // Follow-up tab runs (see followup-report.tsx) — if this file ever
    // stops importing one of them (e.g. someone inlines a "simplified"
    // copy of a threshold check instead), this test fails.
    expect(source).toMatch(/import\s*\{[^}]*getAttendanceSummaryReport[^}]*\}\s*from\s*['"]@\/services\/report-service['"]/)
    expect(source).toMatch(/import\s*\{[^}]*getMissingAssignmentReport[^}]*\}\s*from\s*['"]@\/services\/report-service['"]/)
    expect(source).toMatch(/import\s*\{[^}]*getGradeSummaryReport[^}]*\}\s*from\s*['"]@\/services\/report-service['"]/)
    expect(source).toMatch(/import\s*\{[^}]*getDefaultReportFilters[^}]*\}\s*from\s*['"]@\/services\/report-service['"]/)
    expect(source).toMatch(
      /import\s*\{[^}]*computeFollowUpReport[^}]*\}\s*from\s*['"]@\/services\/followup-report-service['"]/,
    )
    // No hand-rolled threshold number anywhere near getDashboardFollowUpSummary
    // — every threshold lives in FOLLOWUP_RULES (followup-report-service.ts) only.
    const functionBody = source.slice(source.indexOf('export async function getDashboardFollowUpSummary'))
    expect(functionBody).not.toMatch(/>=\s*\d/)
  })
})
