import { describe, expect, it } from 'vitest'

import { resolveRowAction } from '@/features/student-import/student-import-resolver'
import type { DraftImportRow } from '@/features/student-import/types'

function makeRow(overrides: Partial<DraftImportRow> = {}): DraftImportRow {
  return {
    rowNumber: 1,
    studentCode: '67001',
    number: 1,
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    nickname: null,
    email: null,
    phone: null,
    classroom: null,
    status: 'ready',
    reason: null,
    fullNameAmbiguous: false,
    ...overrides,
  }
}

describe('resolveRowAction', () => {
  it('creates a new student when there is no matching student_code', () => {
    const decision = resolveRowAction(makeRow(), null)
    expect(decision).toEqual({ action: 'create', status: 'ready', reason: null, existingStudentId: null })
  })

  it('creates a new student when the row has no student_code at all', () => {
    const decision = resolveRowAction(makeRow({ studentCode: null }), {
      id: 'existing-1',
      alreadyInClassroom: false,
    })
    expect(decision.action).toBe('create')
  })

  it('links an existing student who is not yet in the target classroom', () => {
    const decision = resolveRowAction(makeRow(), { id: 'existing-1', alreadyInClassroom: false })
    expect(decision).toEqual({
      action: 'link',
      status: 'ready',
      reason: null,
      existingStudentId: 'existing-1',
    })
  })

  it('marks as duplicate when the existing student is already in the classroom', () => {
    const decision = resolveRowAction(makeRow(), { id: 'existing-1', alreadyInClassroom: true })
    expect(decision).toEqual({
      action: 'skip',
      status: 'duplicate',
      reason: 'นักเรียนอยู่ในห้องนี้แล้ว',
      existingStudentId: 'existing-1',
    })
  })

  it('skips rows that were already invalid or duplicate before DB resolution', () => {
    const invalidDecision = resolveRowAction(makeRow({ status: 'invalid', reason: 'ไม่พบชื่อหรือนามสกุล' }), null)
    expect(invalidDecision).toEqual({
      action: 'skip',
      status: 'invalid',
      reason: 'ไม่พบชื่อหรือนามสกุล',
      existingStudentId: null,
    })
  })
})
