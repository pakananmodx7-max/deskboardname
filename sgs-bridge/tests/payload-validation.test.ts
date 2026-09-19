import { describe, expect, it } from 'vitest'

import { SGS_BRIDGE_PAYLOAD_VERSION, validateSgsBridgePayload } from '../src/lib/payload-validation.js'

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    version: SGS_BRIDGE_PAYLOAD_VERSION,
    generatedAt: new Date().toISOString(),
    subjectId: 'sub-1',
    subjectName: 'ประวัติศาสตร์ไทย',
    classroomId: 'cls-1',
    classroomName: 'ม.5/1',
    assignmentId: 'asg-1',
    assignmentTitle: 'แบบทดสอบบทที่ 4',
    maxScore: 10,
    students: [{ studentId: 's1', studentNumber: 1, fullName: 'สมชาย ใจดี', score: 8 }],
    skippedStudentIds: [],
    ...overrides,
  }
}

describe('validateSgsBridgePayload — accepts a well-formed payload', () => {
  it('accepts the canonical shape', () => {
    expect(validateSgsBridgePayload(validPayload())).toEqual({ ok: true, errors: [] })
  })

  it('accepts an explicit score of 0', () => {
    const payload = validPayload({ students: [{ studentId: 's1', studentNumber: 1, fullName: 'ก', score: 0 }] })
    expect(validateSgsBridgePayload(payload).ok).toBe(true)
  })
})

describe('validateSgsBridgePayload — rejects malformed data', () => {
  it('rejects a non-object', () => {
    expect(validateSgsBridgePayload(null).ok).toBe(false)
    expect(validateSgsBridgePayload('x').ok).toBe(false)
  })

  it('rejects the wrong version', () => {
    const result = validateSgsBridgePayload(validPayload({ version: 2 }))
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('version'))).toBe(true)
  })

  it('rejects a score above maxScore', () => {
    const payload = validPayload({ students: [{ studentId: 's1', studentNumber: 1, fullName: 'ก', score: 999 }] })
    expect(validateSgsBridgePayload(payload).ok).toBe(false)
  })

  it('rejects a negative score', () => {
    const payload = validPayload({ students: [{ studentId: 's1', studentNumber: 1, fullName: 'ก', score: -1 }] })
    expect(validateSgsBridgePayload(payload).ok).toBe(false)
  })

  it('rejects a null score inside students', () => {
    const payload = validPayload({ students: [{ studentId: 's1', studentNumber: 1, fullName: 'ก', score: null }] })
    expect(validateSgsBridgePayload(payload).ok).toBe(false)
  })

  it('rejects a missing required string field', () => {
    expect(validateSgsBridgePayload(validPayload({ subjectName: '' })).ok).toBe(false)
  })
})

describe('validateSgsBridgePayload — never trusts a payload carrying credential-like keys', () => {
  it('rejects a top-level credential-like key', () => {
    const payload = { ...validPayload(), sgsPassword: 'hunter2' }
    const result = validateSgsBridgePayload(payload)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('ต้องสงสัย'))).toBe(true)
  })

  it('rejects a nested credential-like key (e.g. a stray auth/cookie object)', () => {
    const payload = { ...validPayload(), auth: { sessionToken: 'abc' } }
    expect(validateSgsBridgePayload(payload).ok).toBe(false)
  })

  it('accepts a payload with no credential-like keys anywhere', () => {
    expect(validateSgsBridgePayload(validPayload()).ok).toBe(true)
  })
})
