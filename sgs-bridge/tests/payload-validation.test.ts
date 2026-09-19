import { describe, expect, it } from 'vitest'

import { SGS_BRIDGE_PAYLOAD_VERSION, validateSgsBridgePayload } from '../src/lib/payload-validation.js'

const midterm = { key: 'midterm', label: 'กลางภาค', maxScore: 10 }

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
    assignmentMaxScore: 10,
    targetColumn: midterm,
    overwriteMode: 'skip_existing',
    students: [{ studentId: 's1', studentNumber: 1, fullName: 'สมชาย ใจดี', score: 8 }],
    skippedStudentIds: [],
    ...overrides,
  }
}

describe('validateSgsBridgePayload — accepts a well-formed v2 payload', () => {
  it('accepts the canonical shape', () => {
    expect(validateSgsBridgePayload(validPayload())).toEqual({ ok: true, errors: [] })
  })

  it('accepts an explicit score of 0', () => {
    const payload = validPayload({ students: [{ studentId: 's1', studentNumber: 1, fullName: 'ก', score: 0 }] })
    expect(validateSgsBridgePayload(payload).ok).toBe(true)
  })

  it('accepts the overwrite_selected_column mode', () => {
    expect(validateSgsBridgePayload(validPayload({ overwriteMode: 'overwrite_selected_column' })).ok).toBe(true)
  })
})

describe('validateSgsBridgePayload — rejects malformed data', () => {
  it('rejects a non-object', () => {
    expect(validateSgsBridgePayload(null).ok).toBe(false)
    expect(validateSgsBridgePayload('x').ok).toBe(false)
  })

  it('rejects the wrong version (e.g. a v1 file from before column-fill support)', () => {
    const result = validateSgsBridgePayload(validPayload({ version: 1 }))
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('version'))).toBe(true)
  })

  it('rejects a score above the assignment max', () => {
    const payload = validPayload({ students: [{ studentId: 's1', studentNumber: 1, fullName: 'ก', score: 999 }] })
    expect(validateSgsBridgePayload(payload).ok).toBe(false)
  })

  it('rejects a score above the target column max even within the assignment max', () => {
    const payload = validPayload({
      targetColumn: { key: 'tiny', label: 'ช่องเล็ก', maxScore: 5 },
      students: [{ studentId: 's1', studentNumber: 1, fullName: 'ก', score: 8 }],
    })
    const result = validateSgsBridgePayload(payload)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('เกินคะแนนเต็มของช่อง SGS'))).toBe(true)
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

  it('rejects a missing targetColumn', () => {
    const payload = validPayload({ targetColumn: undefined })
    expect(validateSgsBridgePayload(payload).ok).toBe(false)
  })

  it('rejects a targetColumn missing a key/label/maxScore', () => {
    expect(validateSgsBridgePayload(validPayload({ targetColumn: { label: 'x', maxScore: 10 } })).ok).toBe(false)
    expect(validateSgsBridgePayload(validPayload({ targetColumn: { key: 'k', maxScore: 10 } })).ok).toBe(false)
    expect(validateSgsBridgePayload(validPayload({ targetColumn: { key: 'k', label: 'x' } })).ok).toBe(false)
  })

  it('rejects an invalid overwriteMode — never silently defaults it', () => {
    expect(validateSgsBridgePayload(validPayload({ overwriteMode: 'always_overwrite' })).ok).toBe(false)
    expect(validateSgsBridgePayload(validPayload({ overwriteMode: undefined })).ok).toBe(false)
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
