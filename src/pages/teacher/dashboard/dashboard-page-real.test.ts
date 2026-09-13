import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./dashboard-page-real.tsx', import.meta.url), 'utf-8')
}

describe('DashboardPageReal — unified worklist replaces the old 4 misleading/overlapping cards (C1)', () => {
  const source = readSource()

  it('no longer renders Quick Actions (4 of its 6 buttons pointed at the identical URL regardless of label)', () => {
    expect(source).not.toContain('<QuickActions')
  })

  it('no longer renders the 3 separate cards now merged into one WorklistCard', () => {
    expect(source).not.toContain('<TodayAttendanceCard')
    expect(source).not.toContain('<AssignmentActionCard')
    expect(source).not.toContain('<DashboardFollowUpCard')
  })

  it('no longer renders the Upcoming list — it overlapped the same assignment data the worklist already covers', () => {
    expect(source).not.toContain('<UpcomingAssignmentsCard')
  })

  it('renders one WorklistCard fed by all 3 existing data sources merged, plus a compact StatStrip', () => {
    expect(source).toContain('<WorklistCard')
    expect(source).toContain('<StatStrip')
    expect(source).toContain('attendanceToWorklistItems(attendanceItems)')
    expect(source).toContain('assignmentsToWorklistItems(assignmentItems)')
    expect(source).toContain('followUpToWorklistItems(followUpRows)')
  })

  it('keeps Recent Activity — a log of the past is not redundant with a to-do worklist', () => {
    expect(source).toContain('<RecentActivityCard')
  })
})
