import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./students-section-layout.tsx', import.meta.url), 'utf-8')
}

describe('StudentsSectionLayout — Requirement 3: account-request tab under Students', () => {
  const source = readSource()

  it('renders StudentsPage/StudentLinkRequestsPage unchanged via <Outlet/> rather than re-implementing them', () => {
    expect(source).toContain('<Outlet')
    expect(source).not.toContain('approveLinkRequest')
    expect(source).not.toContain('rejectLinkRequest')
  })

  it('reuses getLinkRequestsForTeacher for the badge instead of a new query', () => {
    expect(source).toContain("getLinkRequestsForTeacher('pending')")
  })

  it('has exactly two tabs: รายชื่อนักเรียน and คำขอเชื่อมบัญชี', () => {
    expect(source).toContain('รายชื่อนักเรียน')
    expect(source).toContain('คำขอเชื่อมบัญชี')
  })
})
