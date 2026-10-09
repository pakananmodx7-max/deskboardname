import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(file: string): string {
  return readFileSync(new URL(file, import.meta.url), 'utf-8')
}

describe('ระบบจัดการห้องเรียน → ภาพรวม — Classroom Analytics Dashboard', () => {
  const real = readSource('./dashboard-page-real.tsx')
  const demo = readSource('./dashboard-page-demo.tsx')

  it('both modes render the same ClassroomAnalyticsDashboard (one set of calculations)', () => {
    expect(real).toContain('<ClassroomAnalyticsDashboard')
    expect(demo).toContain('<ClassroomAnalyticsDashboard')
  })

  it('real mode loads through the RLS-scoped analytics service hook; demo mode never touches Supabase', () => {
    expect(real).toContain('useClassroomAnalyticsData()')
    expect(demo).toContain('buildDemoAnalyticsDataset(')
    expect(demo).not.toMatch(/supabase|classroom-analytics-service|useClassroomAnalyticsData/)
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
