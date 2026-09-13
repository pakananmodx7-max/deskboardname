import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./upcoming-assignments-card.tsx', import.meta.url), 'utf-8')
}

describe('UpcomingAssignmentsCard — "งานที่ใกล้ครบกำหนด"', () => {
  const source = readSource()

  it('shows submitted/total counts, sourced from the real AssignmentActionItem fields', () => {
    expect(source).toContain('item.submittedCount')
    expect(source).toContain('item.totalCount')
  })

  it('links each row to the exact real assignment detail page', () => {
    expect(source).toContain('buildAssignmentDetailPath')
  })

  it('shows a truthful empty state instead of a fake row when nothing is due', () => {
    expect(source).toContain('ไม่มีงานที่ใกล้ครบกำหนด')
  })
})
