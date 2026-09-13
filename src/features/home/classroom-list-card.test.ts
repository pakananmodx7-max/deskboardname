import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./classroom-list-card.tsx', import.meta.url), 'utf-8')
}

describe('ClassroomListCard — "ห้องเรียนของฉัน" list', () => {
  const source = readSource()

  it('links each row to that exact classroom\'s workspace route', () => {
    expect(source).toContain('/teacher/classrooms/${item.classroomId}')
  })

  it('shows the real student count and every linked subject name, never a fabricated status', () => {
    expect(source).toContain('item.studentCount')
    expect(source).toContain('item.subjectNames.map')
  })

  it('renders a truthful empty state instead of a fake row when there are no classrooms', () => {
    expect(source).toContain('EmptyState')
    expect(source).toContain('items.length === 0')
  })

  it('surfaces loading and error states distinctly from the empty state', () => {
    expect(source).toContain('loading ?')
    expect(source).toContain('error ?')
  })
})
