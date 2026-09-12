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
})
