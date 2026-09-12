import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./overview-tab.tsx', import.meta.url), 'utf-8')
}

describe('OverviewTab — "การเชื่อมต่อและสื่อการสอน" section', () => {
  const source = readSource()

  it('renders the shared GoogleDriveConnectionCard rather than a duplicate connect/disconnect implementation', () => {
    expect(source).toContain('<GoogleDriveConnectionCard')
    expect(source).toContain("from '@/features/google-drive/google-drive-connection-card'")
  })

  it('points teachers to the existing Lessons/Assignments resource pickers instead of duplicating them here', () => {
    expect(source).toContain('บทเรียน')
    expect(source).toContain('งาน')
  })
})
