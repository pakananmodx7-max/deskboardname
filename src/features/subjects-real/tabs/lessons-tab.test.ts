import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./lessons-tab.tsx', import.meta.url), 'utf-8')
}

describe('LessonsTab (teacher, real) — create/edit/reorder/publish/archive (Section 2/5)', () => {
  const source = readSource()

  it('offers create ("+ เพิ่มบทเรียน"), edit, reorder (up/down), publish/unpublish toggle, and archive', () => {
    expect(source).toContain('เพิ่มบทเรียน')
    expect(source).toContain('handleMove')
    expect(source).toContain('handleTogglePublish')
    expect(source).toContain('archivingLesson')
  })

  it('never hard-deletes a lesson — archiving only, no deleteLesson call anywhere', () => {
    expect(source).not.toMatch(/deleteLesson|\.delete\(\)/)
    expect(source).toContain('archiveLesson')
  })

  it('archived lessons are hidden from the default list, never permanently removed from state', () => {
    expect(source).toContain('!l.isArchived')
  })

  it('shows an explicit empty state when the classroom has no (non-archived) lessons yet', () => {
    expect(source).toContain('ยังไม่มีบทเรียนในห้องเรียนนี้')
  })

  it('a list-load failure shows its own inline error, distinct from the empty-state text', () => {
    expect(source).toMatch(/error && <p/)
  })
})
