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
})

describe('AssignmentsTab — delete safety: checks dependents before ever showing a destructive confirm', () => {
  const source = readSource()
  const fn = source.slice(
    source.indexOf('async function handleDeleteMenuClick'),
    source.indexOf('\n}', source.indexOf('async function handleDeleteMenuClick')),
  )

  it('always calls hasAssignmentSubmissions BEFORE deciding which dialog to show', () => {
    expect(fn).toContain('await hasAssignmentSubmissions(assignment.id)')
  })

  it('routes to the destructive delete confirm ONLY when there are no submissions', () => {
    expect(fn).toMatch(/if \(hasSubmissions\) setDeleteBlockedAssignment\(assignment\)\s*\n\s*else setDeletingAssignment\(assignment\)/)
  })
})

describe('AssignmentsTab — blocked-delete dialog recommends the existing "เก็บถาวร" flow instead of any new destructive path', () => {
  const source = readSource()

  it('the blocked dialog\'s confirm action opens the SAME archive dialog/state the "เก็บถาวร" menu item uses — no separate cascade-delete path', () => {
    const blockedDialog = source.slice(source.indexOf('deleteBlockedAssignment && ('), source.indexOf('</ConfirmDialog>', source.indexOf('deleteBlockedAssignment && (')))
    expect(blockedDialog).toContain('setArchivingAssignment(deleteBlockedAssignment)')
    expect(blockedDialog).not.toContain('deleteAssignmentPermanently')
  })

  it('the destructive "ลบงานนี้?" confirm dialog is the ONLY caller of deleteAssignmentPermanently in this file', () => {
    // The only call site (the import statement lists the name but never
    // calls it with parens) — inside handleDeletePermanently.
    const occurrences = source.split('deleteAssignmentPermanently(').length - 1
    expect(occurrences).toBe(1)
    const destructiveDialog = source.slice(source.indexOf('deletingAssignment && ('), source.indexOf('</ConfirmDialog>', source.indexOf('deletingAssignment && (')))
    expect(destructiveDialog).toContain('destructive')
    expect(destructiveDialog).toContain('onConfirm={handleDeletePermanently}')
  })
})
