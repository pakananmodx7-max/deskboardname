import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./classroom-students-tab.tsx', import.meta.url), 'utf-8')
}

describe('ClassroomStudentsTab — account-link-request review stays reachable', () => {
  const source = readSource()

  it('links to the existing /teacher/students/requests page rather than re-implementing request review here', () => {
    expect(source).toContain('to="/teacher/students/requests"')
  })

  it('still offers Import/Add — the link doesn\'t replace existing roster actions', () => {
    expect(source).toContain('Import Students')
    expect(source).toContain('เพิ่มนักเรียน')
  })
})
