import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./classroom-overview-page.tsx', import.meta.url), 'utf-8')
}

describe('ClassroomOverviewPage — ภาพรวม inside ระบบจัดการชั้นเรียน', () => {
  const source = readSource()

  it('reuses the existing DashboardPage (and thus DashboardPageReal/Demo\'s data fetching) instead of duplicating it', () => {
    expect(source).toContain('<DashboardPage')
    expect(source).toContain("from '@/pages/teacher/dashboard/dashboard-page'")
  })

  it('contains no data-fetching or Supabase calls of its own — it is a thin wrapper only', () => {
    expect(source).not.toMatch(/supabase|getDashboardOverview|useState|useEffect/)
  })
})
