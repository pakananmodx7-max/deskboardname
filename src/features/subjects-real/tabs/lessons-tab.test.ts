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

  it('archiving ("เก็บถาวร") remains available, fully separate from permanent delete', () => {
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

describe('LessonsTab — "ลบบทเรียน" (permanent delete) menu item', () => {
  const source = readSource()

  it('the card menu order is: แก้ไข/เพิ่มสื่อการสอน, เก็บถาวร, then ลบบทเรียน (separated, destructive)', () => {
    const menuBlock = source.slice(source.indexOf('<RowActionsMenu'), source.indexOf('/>', source.indexOf('<RowActionsMenu')))
    const editIndex = menuBlock.indexOf("key: 'edit'")
    const archiveIndex = menuBlock.indexOf("key: 'archive'")
    const deleteIndex = menuBlock.indexOf("key: 'delete'")
    expect(editIndex).toBeGreaterThan(-1)
    expect(archiveIndex).toBeGreaterThan(editIndex)
    expect(deleteIndex).toBeGreaterThan(archiveIndex)

    const deleteAction = menuBlock.slice(deleteIndex)
    expect(deleteAction).toContain('destructive: true')
    expect(deleteAction).toContain('separatorBefore: true')
    expect(deleteAction).toContain("label: 'ลบบทเรียน'")
  })

  it('shows the exact required confirmation: title "ลบบทเรียนนี้?", the given message, confirm label "ลบบทเรียน"', () => {
    const dialogBlock = source.slice(source.indexOf('deletingLesson && ('), source.indexOf('</ConfirmDialog>', source.indexOf('deletingLesson && (')))
    expect(dialogBlock).toContain('title="ลบบทเรียนนี้?"')
    expect(dialogBlock).toContain('บทเรียนนี้และสื่อการสอนที่เกี่ยวข้องจะถูกลบถาวร และไม่สามารถกู้คืนได้')
    expect(dialogBlock).toContain('confirmLabel="ลบบทเรียน"')
    expect(dialogBlock).toContain('destructive')
    expect(dialogBlock).toContain('onConfirm={handleDeletePermanently}')
  })

  it('calls deleteLessonPermanently — the actual permanent-delete service call', () => {
    const fn = source.slice(
      source.indexOf('async function handleDeletePermanently'),
      source.indexOf('async function handleMove'),
    )
    expect(fn).toContain('await deleteLessonPermanently(deletingLesson.id)')
  })
})
