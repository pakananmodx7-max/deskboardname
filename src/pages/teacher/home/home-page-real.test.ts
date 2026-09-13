import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./home-page-real.tsx', import.meta.url), 'utf-8')
}

describe('HomePageReal — personal command center (Requirement 6)', () => {
  const source = readSource()

  it('greets using the real teacher profile, never a hardcoded name', () => {
    expect(source).toContain('profile?.displayName')
    expect(source).not.toMatch(/สวัสดี, [ก-๙A-Za-z]+"/)
  })

  it('reuses the existing dashboard-service data instead of a new/duplicate fetch', () => {
    expect(source).toContain('getDashboardOverview')
    expect(source).toContain('getDashboardFollowUpSummary')
  })

  it('never hardcodes classroom/student/subject counts — every stat comes from `overview`', () => {
    expect(source).not.toMatch(/value:\s*['"`]\d+['"`]/)
  })

  it('shows ระบบเอกสาร and งานและเตือนความจำ as coming-soon placeholders', () => {
    expect(source).toContain('ระบบเอกสาร')
    expect(source).toContain('งานและเตือนความจำ')
    expect(source.match(/badge="เร็ว ๆ นี้"/g)?.length).toBe(2)
  })

  it('includes the Hermes summary card', () => {
    expect(source).toContain('<HermesSummaryCard')
  })

  it('leads with the unified worklist (same component Classroom Management ภาพรวม uses) — same data, one shared shape', () => {
    expect(source).toContain('<WorklistCard')
    expect(source).toContain('attendanceToWorklistItems(attendanceItems)')
    expect(source).toContain('assignmentsToWorklistItems(assignmentItems)')
    expect(source).toContain('followUpToWorklistItems(followUpRows)')
  })
})

describe('HomePageReal — visual redesign (welcome hero, stat cards, charts, activity, classroom list)', () => {
  const source = readSource()

  it('shows the exact requested hero title/subtitle text', () => {
    expect(source).toContain('ยินดีต้อนรับ ครูผู้สอน')
    expect(source).toContain('ภาพรวมการจัดการชั้นเรียนของคุณในวันนี้')
  })

  it('renders 4 StatCards, every value templated from real state — never a literal number', () => {
    expect((source.match(/<StatCard/g) ?? []).length).toBe(4)
    expect(source).not.toMatch(/value=\{?['"`]\d+['"`]/)
  })

  it('feeds the bar chart from getClassroomsWithStudentCounts, the donut chart from getTodayAttendanceSummary', () => {
    expect(source).toContain('getClassroomsWithStudentCounts')
    expect(source).toContain('<BarChart')
    expect(source).toContain('getTodayAttendanceSummary')
    expect(source).toContain('<DonutChart')
  })

  it('shows a truthful empty state instead of a zero-filled chart when a chart has no real data yet', () => {
    expect(source).toContain('classroomsWithCounts.length === 0')
    expect(source).toContain('attendanceSummary.total === 0')
  })

  it('reuses RecentActivityCard and ClassroomListCard rather than reimplementing them', () => {
    expect(source).toContain('<RecentActivityCard')
    expect(source).toContain('<ClassroomListCard')
    expect(source).toContain('getRecentActivity')
    expect(source).toContain('getClassroomListItems')
  })

  it('feeds the upcoming assignments rail from the same assignmentItems the worklist already loaded', () => {
    expect(source).toContain('selectUpcomingAssignments(assignmentItems)')
    expect(source).toContain('<UpcomingAssignmentsCard')
  })
})
