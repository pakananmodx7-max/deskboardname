import { describe, expect, it } from 'vitest'

import {
  buildSgsBridgePayload,
  buildSgsExportCsvTable,
  buildSgsExportRows,
  computeSgsExportSummary,
  validateSgsBridgePayload,
} from '@/services/sgs-export-service'
import type { AssignmentSubmission } from '@/types/assignment'
import { SGS_BRIDGE_PAYLOAD_VERSION } from '@/types/sgs-bridge'
import type { ClassroomStudent } from '@/types/student'

function student(id: string, number: number, firstName: string, lastName = 'สกุล'): ClassroomStudent {
  return {
    id,
    number,
    firstName,
    lastName,
    studentCode: null,
    nickname: null,
    email: null,
    phone: null,
    status: 'active',
    createdAt: '',
    updatedAt: '',
    classroomStudentId: `cs-${id}`,
    joinedAt: '',
  }
}

function submission(score: number | null): AssignmentSubmission {
  return { studentId: '', status: score !== null ? 'submitted' : 'not_submitted', score, note: null }
}

describe('buildSgsExportRows — null vs explicit zero', () => {
  it('a student with no submission row at all is null, not 0, and willSend is false', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], {})
    expect(rows[0].krunameScore).toBeNull()
    expect(rows[0].willSend).toBe(false)
  })

  it('a student with a null score (submitted, not yet graded) is skipped', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], { s1: submission(null) })
    expect(rows[0].krunameScore).toBeNull()
    expect(rows[0].willSend).toBe(false)
  })

  it('an explicit score of 0 is preserved and WILL be sent — never treated as "no score"', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], { s1: submission(0) })
    expect(rows[0].krunameScore).toBe(0)
    expect(rows[0].willSend).toBe(true)
  })

  it('a normal positive score is preserved', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], { s1: submission(8) })
    expect(rows[0].krunameScore).toBe(8)
    expect(rows[0].willSend).toBe(true)
  })

  it('full name joins firstName and lastName with a space', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'สมชาย', 'ใจดี')], {})
    expect(rows[0].fullName).toBe('สมชาย ใจดี')
  })
})

describe('computeSgsExportSummary', () => {
  it('counts total/withScore/skipped correctly, including a 0 as "with score"', () => {
    const rows = buildSgsExportRows(
      [student('s1', 1, 'เอ'), student('s2', 2, 'บี'), student('s3', 3, 'ซี')],
      { s1: submission(8), s2: submission(0), s3: submission(null) },
    )
    const summary = computeSgsExportSummary(rows, 10)
    expect(summary).toEqual({ totalStudents: 3, withScore: 2, skipped: 1, maxScore: 10 })
  })
})

describe('buildSgsExportCsvTable', () => {
  it('shows "ไม่ส่ง" for a skipped row and the numeric score otherwise, including 0', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ'), student('s2', 2, 'บี')], {
      s1: submission(0),
      s2: submission(null),
    })
    const table = buildSgsExportCsvTable('ประวัติศาสตร์ไทย', 'ม.5/1', 'แบบทดสอบบทที่ 4', 10, rows)
    expect(table.rows[0]).toEqual([1, 'เอ สกุล', 0, 0])
    expect(table.rows[1]).toEqual([2, 'บี สกุล', '—', 'ไม่ส่ง'])
  })
})

const baseArgs = {
  subjectId: 'sub-1',
  subjectName: 'ประวัติศาสตร์ไทย',
  classroomId: 'cls-1',
  classroomName: 'ม.5/1',
  assignmentId: 'asg-1',
  assignmentTitle: 'แบบทดสอบบทที่ 4',
  maxScore: 10,
}

describe('buildSgsBridgePayload', () => {
  it('includes only students with a non-null score, and records the rest as skipped', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ'), student('s2', 2, 'บี')], {
      s1: submission(8),
      s2: submission(null),
    })
    const payload = buildSgsBridgePayload(baseArgs, rows)
    expect(payload.students).toEqual([{ studentId: 's1', studentNumber: 1, fullName: 'เอ สกุล', score: 8 }])
    expect(payload.skippedStudentIds).toEqual([
      { studentId: 's2', studentNumber: 2, fullName: 'บี สกุล', reason: 'no_score' },
    ])
    expect(payload.version).toBe(SGS_BRIDGE_PAYLOAD_VERSION)
  })

  it('preserves an explicit 0 in the payload rather than dropping it', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], { s1: submission(0) })
    const payload = buildSgsBridgePayload(baseArgs, rows)
    expect(payload.students).toEqual([{ studentId: 's1', studentNumber: 1, fullName: 'เอ สกุล', score: 0 }])
  })

  it('never contains a credential-like key', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], { s1: submission(8) })
    const payload = buildSgsBridgePayload(baseArgs, rows)
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toMatch(/password|token|cookie|secret|service_?role|credential|session/i)
  })
})

describe('validateSgsBridgePayload', () => {
  it('accepts a payload built by buildSgsBridgePayload', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], { s1: submission(8) })
    const payload = buildSgsBridgePayload(baseArgs, rows)
    expect(validateSgsBridgePayload(payload)).toEqual({ ok: true, errors: [] })
  })

  it('rejects a wrong version', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], { s1: submission(8) })
    const payload = buildSgsBridgePayload(baseArgs, rows)
    const result = validateSgsBridgePayload({ ...payload, version: 2 })
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('version'))).toBe(true)
  })

  it('rejects a score above maxScore', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], { s1: submission(8) })
    const payload = buildSgsBridgePayload(baseArgs, rows)
    const tampered = { ...payload, students: [{ ...payload.students[0], score: 999 }] }
    const result = validateSgsBridgePayload(tampered)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('เกินคะแนนเต็ม'))).toBe(true)
  })

  it('rejects a negative score', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], { s1: submission(8) })
    const payload = buildSgsBridgePayload(baseArgs, rows)
    const tampered = { ...payload, students: [{ ...payload.students[0], score: -1 }] }
    expect(validateSgsBridgePayload(tampered).ok).toBe(false)
  })

  it('rejects a null score inside students (should have been skipped, not included with null)', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], { s1: submission(8) })
    const payload = buildSgsBridgePayload(baseArgs, rows)
    const tampered = { ...payload, students: [{ ...payload.students[0], score: null }] }
    expect(validateSgsBridgePayload(tampered).ok).toBe(false)
  })

  it('rejects a payload carrying a credential-like key at any depth', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], { s1: submission(8) })
    const payload = buildSgsBridgePayload(baseArgs, rows)
    const tampered = { ...payload, auth: { sgsPassword: 'x' } }
    const result = validateSgsBridgePayload(tampered)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('ต้องสงสัย'))).toBe(true)
  })

  it('rejects a non-object payload', () => {
    expect(validateSgsBridgePayload(null).ok).toBe(false)
    expect(validateSgsBridgePayload('a string').ok).toBe(false)
  })

  it('rejects missing required string fields', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], { s1: submission(8) })
    const payload = buildSgsBridgePayload(baseArgs, rows)
    const tampered = { ...payload, subjectName: '' }
    expect(validateSgsBridgePayload(tampered).ok).toBe(false)
  })
})
