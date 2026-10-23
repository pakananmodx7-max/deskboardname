import { describe, expect, it } from 'vitest'

import {
  canDelete,
  deletedRows,
  deletedToast,
  fileRows,
  hasFiles,
  isConfirmationNameMatch,
  parseDeletionPreview,
  preservedRows,
  totalDeletedRecords,
  type DeletionCounts,
} from './classroom-deletion-model'

const zero: DeletionCounts = {
  enrollments: 0, subject_links: 0, assignments: 0, assignment_resources: 0, submissions: 0, graded_submissions: 0,
  submission_resources: 0, submission_events: 0, attendance_sessions: 0, attendance_records: 0, lessons: 0, lesson_resources: 0,
  sgs_columns: 0, sgs_scores: 0, followup_notes: 0, notifications: 0, storage_files: 0, drive_files: 0, files_referenced_elsewhere: 0,
  students: 0, students_only_in_this_classroom: 0, students_in_other_classrooms: 0, linked_student_accounts: 0, qr_identities: 0,
  subjects_linked: 0, other_classroom_submissions: 0, other_classroom_attendance_records: 0, foreign_subject_records: 0,
}
const full: DeletionCounts = { ...zero, enrollments: 30, subject_links: 2, assignments: 10, submissions: 300, graded_submissions: 250, attendance_sessions: 40, attendance_records: 1200, sgs_scores: 60, students: 30, students_only_in_this_classroom: 28, students_in_other_classrooms: 2, qr_identities: 30, drive_files: 1 }
const raw = (over: Record<string, unknown> = {}) => ({
  classroom: { id: 'c1', name: 'ม.5/1', teacher_id: 't1', is_active: false, academic_year: '2569', semester: '2' },
  counts: full,
  blockers: [],
  fingerprint: 'f',
  ...over,
})

describe('parseDeletionPreview', () => {
  it('accepts the server payload (numbers may arrive as strings)', () => {
    const p = parseDeletionPreview(raw({ counts: { ...full, attendance_records: '1200' } }))
    expect(p.counts.attendance_records).toBe(1200)
    expect(p.classroom).toMatchObject({ id: 'c1', name: 'ม.5/1', isActive: false })
  })
  it.each([
    ['missing count', raw({ counts: { ...full, sgs_scores: undefined } })],
    ['negative count', raw({ counts: { ...full, sgs_scores: -1 } })],
    ['fractional count', raw({ counts: { ...full, sgs_scores: 1.5 } })],
    ['no fingerprint', raw({ fingerprint: null })],
    ['no classroom', raw({ classroom: null })],
    ['bad blocker', raw({ blockers: [{ code: 1 }] })],
    ['null', null],
  ])('rejects %s', (_label, payload) => {
    expect(() => parseDeletionPreview(payload)).toThrow()
  })
})

describe('rows shown in the dialog', () => {
  it('an empty classroom has nothing listed for deletion', () => {
    expect(deletedRows(zero)).toEqual([])
    expect(totalDeletedRecords(zero)).toBe(0)
    expect(hasFiles(zero)).toBe(false)
  })
  it('lists only non-zero deleted records, grades as a breakdown of submissions', () => {
    const rows = deletedRows(full)
    expect(rows.map((r) => r.key)).toEqual(['enrollments', 'subject_links', 'assignments', 'submissions', 'graded_submissions', 'attendance_sessions', 'attendance_records', 'sgs_scores'])
    expect(rows.find((r) => r.key === 'graded_submissions')?.nested).toBe(true)
  })
  it('the total does not double-count graded submissions', () => {
    expect(totalDeletedRecords(full)).toBe(30 + 2 + 10 + 300 + 40 + 1200 + 60)
  })
  it('always shows that students and QR codes are kept', () => {
    const rows = preservedRows(full)
    expect(rows.find((r) => r.key === 'students')?.value).toBe(30)
    expect(rows.find((r) => r.key === 'qr_identities')?.label).toContain('QR')
    expect(preservedRows(zero).some((r) => r.nested)).toBe(false)
  })
  it('files are always listed', () => {
    expect(fileRows(full).map((r) => r.key)).toEqual(['storage_files', 'drive_files', 'files_referenced_elsewhere'])
    expect(hasFiles(full)).toBe(true)
  })
})

describe('confirmation rules', () => {
  it('the typed name must match exactly', () => {
    expect(isConfirmationNameMatch('ม.5/1', 'ม.5/1')).toBe(true)
    expect(isConfirmationNameMatch('ม.5/1 ', 'ม.5/1')).toBe(false)
    expect(isConfirmationNameMatch('ม.5/2', 'ม.5/1')).toBe(false)
    expect(isConfirmationNameMatch('', 'ม.5/1')).toBe(false)
  })
  it('only an archived classroom without blockers can be deleted', () => {
    expect(canDelete(parseDeletionPreview(raw()))).toBe(true)
    expect(canDelete(parseDeletionPreview(raw({ classroom: { ...raw().classroom, is_active: true } })))).toBe(false)
    expect(canDelete(parseDeletionPreview(raw({ blockers: [{ code: 'KC004', message: 'x' }] })))).toBe(false)
  })
  it('the success toast says files were queued, not deleted', () => {
    expect(deletedToast('ม.5/1', 3)).toContain('ยังไม่ได้ลบไฟล์')
    expect(deletedToast('ม.5/1', 0)).toBe('ลบห้อง "ม.5/1" ถาวรแล้ว')
  })
})
