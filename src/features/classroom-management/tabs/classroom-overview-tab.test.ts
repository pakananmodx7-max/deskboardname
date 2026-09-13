import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./classroom-overview-tab.tsx', import.meta.url), 'utf-8')
}

describe('ClassroomOverviewTab — scoped worklist (C1, third altitude)', () => {
  const source = readSource()

  it('scopes all 3 dashboard-service calls to this classroom via the optional classroomId param', () => {
    expect(source).toContain('getTodaySubjectAttendanceStatus(classroom.id)')
    expect(source).toContain('getAssignmentActionItems(classroom.id)')
    expect(source).toContain('getDashboardFollowUpSummary(classroom.id)')
  })

  it('renders the same shared WorklistCard used on Home and Classroom Management ภาพรวม', () => {
    expect(source).toContain('<WorklistCard')
  })

  it('keeps the existing student-count stat and classroom metadata card unchanged', () => {
    expect(source).toContain('นักเรียนทั้งหมด')
    expect(source).toContain('ระดับชั้น')
  })
})
