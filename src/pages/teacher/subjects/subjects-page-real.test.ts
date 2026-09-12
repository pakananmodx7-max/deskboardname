import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./subjects-page-real.tsx', import.meta.url), 'utf-8')
}

describe('SubjectsPageReal — "ลบรายวิชา" (permanent delete) menu item', () => {
  const source = readSource()

  it('the card menu order is: เปิดรายวิชา, แก้ไขรายวิชา, เก็บถาวร, then ลบรายวิชา (separated, destructive)', () => {
    const menuBlock = source.slice(source.indexOf('<RowActionsMenu'), source.indexOf('/>', source.indexOf('<RowActionsMenu')))
    const openIndex = menuBlock.indexOf("key: 'open'")
    const editIndex = menuBlock.indexOf("key: 'edit'")
    const archiveIndex = menuBlock.indexOf("key: 'archive'")
    const deleteIndex = menuBlock.indexOf("key: 'delete'")
    expect(openIndex).toBeGreaterThan(-1)
    expect(editIndex).toBeGreaterThan(openIndex)
    expect(archiveIndex).toBeGreaterThan(editIndex)
    expect(deleteIndex).toBeGreaterThan(archiveIndex)

    const deleteAction = menuBlock.slice(deleteIndex)
    expect(deleteAction).toContain('destructive: true')
    expect(deleteAction).toContain('separatorBefore: true')
    expect(deleteAction).toContain("label: 'ลบรายวิชา'")
  })

  it('shows the confirmation: title "ลบรายวิชาและข้อมูลทั้งหมด?", a message that names attendance history (ประวัติการเช็คชื่อ) as deleted too, confirm label "ลบรายวิชาและข้อมูลทั้งหมด"', () => {
    const dialogBlock = source.slice(
      source.indexOf('deletingSubject && ('),
      source.indexOf('</ConfirmDialog>', source.indexOf('deletingSubject && (')),
    )
    expect(dialogBlock).toContain('title="ลบรายวิชาและข้อมูลทั้งหมด?"')
    expect(dialogBlock).toContain(
      'การลบรายวิชาจะลบบทเรียน งาน คะแนน การส่งงาน ประวัติการเช็คชื่อของรายวิชานี้ และข้อมูลที่เกี่ยวข้องออกจากระบบอย่างถาวร และไม่สามารถกู้คืนได้',
    )
    expect(dialogBlock).toContain('confirmLabel="ลบรายวิชาและข้อมูลทั้งหมด"')
    expect(dialogBlock).toContain('destructive')
    expect(dialogBlock).toContain('onConfirm={handleDeletePermanently}')
  })

  it('when the subject has recorded attendance, the message states the exact session count and that students/classrooms/other subjects\' attendance are NOT deleted', () => {
    const dialogBlock = source.slice(
      source.indexOf('deletingSubject && ('),
      source.indexOf('</ConfirmDialog>', source.indexOf('deletingSubject && (')),
    )
    expect(dialogBlock).toContain('deletingSubject.attendanceSessionCount > 0')
    expect(dialogBlock).toContain('${deletingSubject.attendanceSessionCount} ครั้ง')
    expect(dialogBlock).toContain('ข้อมูลนักเรียน ห้องเรียน และการเช็คชื่อของรายวิชาอื่นจะไม่ถูกลบ')
  })

  it('the menu item counts this subject\'s attendance sessions FIRST (countSubjectAttendanceSessions) so the right copy shows — the count is never the authorization check and never blocks deletion', () => {
    const fn = source.slice(
      source.indexOf('async function handleDeleteMenuClick'),
      source.indexOf('async function handleDeletePermanently'),
    )
    expect(fn).toContain('await countSubjectAttendanceSessions(subject.id)')
    expect(fn).toContain('setDeletingSubject({ subject, attendanceSessionCount })')
    expect(fn).not.toContain('throw')
    expect(source).toContain('onSelect: () => handleDeleteMenuClick(subject)')
  })

  it('calls deleteSubjectPermanently — the actual permanent-delete service call', () => {
    const fn = source.slice(
      source.indexOf('async function handleDeletePermanently'),
      source.indexOf('\n\n  return ('),
    )
    expect(fn).toContain('await deleteSubjectPermanently(subject.id)')
  })

  it('"เก็บถาวร" (archive) remains a fully separate action — the delete menu item never redirects into it', () => {
    expect(source).toContain('setArchivingSubject(subject)')
    const deleteFn = source.slice(
      source.indexOf('async function handleDeletePermanently'),
      source.indexOf('\n\n  return ('),
    )
    expect(deleteFn).not.toContain('setArchivingSubject')
  })
})
