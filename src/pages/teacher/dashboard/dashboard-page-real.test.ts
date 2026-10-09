import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(file: string): string {
  return readFileSync(new URL(file, import.meta.url), 'utf-8')
}

describe('ภาพรวม — unified teacher dashboard', () => {
  const real = readSource('./dashboard-page-real.tsx')
  const demo = readSource('./dashboard-page-demo.tsx')

  it('both modes render the same ClassroomAnalyticsDashboard (one set of calculations)', () => {
    expect(real).toContain('<ClassroomAnalyticsDashboard')
    expect(demo).toContain('<ClassroomAnalyticsDashboard')
  })

  it('both modes read the shared semester (the header selector) — no page-local semester state', () => {
    for (const source of [real, demo]) {
      expect(source).toContain('useSemester()')
      expect(source).toContain('scope={semester.scope}')
      expect(source).not.toMatch(/useState|pickDefaultSemester|onSemesterChange/)
    }
  })

  it('real mode loads the semester\'s data through the RLS-scoped analytics hook; demo mode never touches Supabase', () => {
    expect(real).toContain('useSemesterAnalyticsData(semester.scope?.classroomIds ?? null)')
    expect(demo).toContain('buildDemoAnalyticsDataset(')
    expect(demo).not.toMatch(/supabase|classroom-analytics-service|useSemesterAnalyticsData/)
  })

  it('classroom changes refresh the shared classroom list and the semester data; demo is read-only', () => {
    expect(real).toContain('classroomsEditable')
    expect(real).toMatch(/refreshContext\(\)\s+reloadAll\(\)/)
    expect(demo).toContain('classroomsEditable={false}')
  })

  it('old /teacher/classrooms bookmarks land on the classroom section', () => {
    for (const source of [real, demo]) expect(source).toContain('useScrollToHashSection(')
  })

  it('the long worklist / recent-activity lists are no longer on the overview page', () => {
    for (const source of [real, demo]) {
      expect(source).not.toContain('<WorklistCard')
      expect(source).not.toContain('<RecentActivityCard')
      expect(source).not.toContain('<QuickActions')
    }
  })

  it('no hardcoded semester label or example statistics', () => {
    for (const source of [real, demo]) {
      expect(source).not.toContain('1 / 2569')
      expect(source).not.toMatch(/262|241 คน/)
    }
  })

  it('links ranked students to the existing Student Analytics route in real mode only', () => {
    expect(real).toContain('buildStudentAnalyticsPath(stat.analyticsSubjectId, stat.classroomId, stat.studentId)')
    expect(demo).not.toContain('studentLink=')
  })
})
