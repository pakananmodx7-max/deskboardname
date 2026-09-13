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

  it('includes the Hermes summary card', () => {
    expect(source).toContain('<HermesSummaryCard')
  })
})

describe('HomePageReal — KrunameClass visual redesign no longer dominated by the old worklist', () => {
  const source = readSource()
  const jsxOnly = source.slice(source.indexOf('return ('))

  it('does not render the long "สิ่งที่ต้องจัดการ" WorklistCard here — it stays on Classroom Management → ภาพรวม instead', () => {
    expect(jsxOnly).not.toContain('<WorklistCard')
    expect(jsxOnly).not.toContain('สิ่งที่ต้องจัดการวันนี้')
  })

  it('does not render the "coming soon" module teaser cards (no real data behind them)', () => {
    expect(jsxOnly).not.toContain('<ModuleSummaryCard')
    expect(jsxOnly).not.toContain('ระบบเอกสาร')
    expect(jsxOnly).not.toContain('งานและเตือนความจำ')
  })

  it('the 4 stat cards are the first thing in the main column, right after the hero — never behind a long list', () => {
    const mainColumnStart = source.indexOf('xl:col-span-2')
    const firstStatCard = source.indexOf('<StatCard')
    const firstDashboardSection = source.indexOf('<DashboardSection')
    expect(firstStatCard).toBeGreaterThan(mainColumnStart)
    expect(firstStatCard).toBeLessThan(firstDashboardSection)
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

  it('feeds the upcoming assignments rail from the same assignmentItems already loaded for the follow-up stat', () => {
    expect(source).toContain('selectUpcomingAssignments(assignmentItems)')
    expect(source).toContain('<UpcomingAssignmentsCard')
  })
})
