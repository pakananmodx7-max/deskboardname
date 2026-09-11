import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./assignments-tab.tsx', import.meta.url), 'utf-8')
}

describe('AssignmentsTab — card menu order (คัดลอกไปห้องอื่น / ลบงาน feature)', () => {
  const source = readSource()

  it('has exactly the required actions, in order: แก้ไขงาน, คัดลอกไปห้องอื่น, เก็บถาวร, ลบงาน (separated)', () => {
    const menuBlock = source.slice(source.indexOf('<RowActionsMenu'), source.indexOf('/>', source.indexOf('<RowActionsMenu')))
    const editIndex = menuBlock.indexOf("key: 'edit'")
    const copyIndex = menuBlock.indexOf("key: 'copy'")
    const archiveIndex = menuBlock.indexOf("key: 'archive'")
    const deleteIndex = menuBlock.indexOf("key: 'delete'")
    expect(editIndex).toBeGreaterThan(-1)
    expect(copyIndex).toBeGreaterThan(editIndex)
    expect(archiveIndex).toBeGreaterThan(copyIndex)
    expect(deleteIndex).toBeGreaterThan(archiveIndex)
  })

  it('"ลบงาน" is destructive and visually separated from the rest of the menu', () => {
    const menuBlock = source.slice(source.indexOf('<RowActionsMenu'), source.indexOf('/>', source.indexOf('<RowActionsMenu')))
    const deleteAction = menuBlock.slice(menuBlock.indexOf("key: 'delete'"))
    expect(deleteAction).toContain('destructive: true')
    expect(deleteAction).toContain('separatorBefore: true')
  })

  it('"คัดลอกไปห้องอื่น" opens CopyAssignmentDialog, never deletes/archives directly from the menu click itself', () => {
    const menuBlock = source.slice(source.indexOf('<RowActionsMenu'), source.indexOf('/>', source.indexOf('<RowActionsMenu')))
    const copyAction = menuBlock.slice(menuBlock.indexOf("key: 'copy'"), menuBlock.indexOf("key: 'archive'"))
    expect(copyAction).toContain('setCopyingAssignment(assignment)')
  })

  it('"เก็บถาวร" stays enabled/available regardless of whether the assignment has submissions — never removed or hidden by the delete feature', () => {
    const menuBlock = source.slice(source.indexOf('<RowActionsMenu'), source.indexOf('/>', source.indexOf('<RowActionsMenu')))
    const archiveAction = menuBlock.slice(menuBlock.indexOf("key: 'archive'"), menuBlock.indexOf("key: 'delete'"))
    expect(archiveAction).toContain('setArchivingAssignment(assignment)')
    // disabled only when it's already archived, never based on submissions.
    expect(archiveAction).toContain('disabled: assignment.isArchived')
  })
})

describe('AssignmentsTab — delete is never blocked by submissions, only its confirmation copy changes', () => {
  const source = readSource()
  // Both handlers are nested inside the component function (2-space
  // indent), so their own closing brace is "  }", not "}" at column 0 —
  // slicing to the next '\n}' would run all the way to the component's
  // OWN closing brace at the end of the file. Bound each slice by the
  // next sibling declaration instead.
  const menuClickFn = source.slice(
    source.indexOf('async function handleDeleteMenuClick'),
    source.indexOf('async function handleDeletePermanently'),
  )
  const deleteFn = source.slice(
    source.indexOf('async function handleDeletePermanently'),
    source.indexOf('\n\n  return ('),
  )

  it('always calls hasAssignmentSubmissions, purely to pick which dialog copy to show', () => {
    expect(menuClickFn).toContain('await hasAssignmentSubmissions(assignment.id)')
  })

  it('every outcome of the check leads to the SAME deletingAssignment confirm flow — never a separate blocked dialog', () => {
    expect(menuClickFn).toContain('setDeletingAssignment({ assignment, hasSubmissions })')
    expect(source).not.toContain('deleteBlockedAssignment')
    expect(source).not.toContain('เก็บถาวรแทน') // the old blocked-dialog's "archive instead" CTA
  })

  it('handleDeletePermanently is the ONLY place deleteAssignmentPermanently is called — always reachable, never conditioned on hasSubmissions', () => {
    expect(deleteFn).toContain('await deleteAssignmentPermanently(assignment.id)')
    expect(deleteFn).not.toContain('hasSubmissions')
  })
})

describe('AssignmentsTab — delete confirmation dialog: exact copy per the two required variants', () => {
  const source = readSource()
  const dialogBlock = source.slice(source.indexOf('deletingAssignment && ('), source.indexOf('</ConfirmDialog>', source.indexOf('deletingAssignment && (')))

  it('zero-submissions variant: title "ลบงานนี้?", message "เมื่อลบแล้วจะไม่สามารถกู้คืนได้", confirm label "ลบงาน"', () => {
    expect(dialogBlock).toContain("'ลบงานนี้?'")
    expect(dialogBlock).toContain('เมื่อลบแล้วจะไม่สามารถกู้คืนได้')
    expect(dialogBlock).toContain("'ลบงาน'")
  })

  it('has-submissions variant: title "ลบงานและข้อมูลนักเรียน?", message names submissions/scores/status/files, confirm label "ลบงานและข้อมูลทั้งหมด"', () => {
    expect(dialogBlock).toContain("'ลบงานและข้อมูลนักเรียน?'")
    expect(dialogBlock).toContain('งานนี้มีข้อมูลการส่งงานหรือคะแนนของนักเรียน')
    expect(dialogBlock).toContain('ข้อมูลการส่งงาน คะแนน สถานะ และไฟล์งานที่เกี่ยวข้องจะถูกลบด้วย')
    expect(dialogBlock).toContain("'ลบงานและข้อมูลทั้งหมด'")
  })

  it('the confirm button is destructive in BOTH variants', () => {
    expect(dialogBlock).toContain('destructive')
  })

  it('both variants call the SAME onConfirm handler — one delete path, not two', () => {
    expect(dialogBlock).toContain('onConfirm={handleDeletePermanently}')
  })
})
