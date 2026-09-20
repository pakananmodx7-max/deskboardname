import { describe, expect, it } from 'vitest'

import {
  SGS_BRIDGE_PAYLOAD_VERSION,
  SGS_SCORE_WORKSPACE_PAYLOAD_KIND,
  SGS_SCORE_WORKSPACE_PAYLOAD_VERSION,
  validateAnySgsBridgePayload,
  validateSgsBridgePayload,
  validateSgsScoreWorkspacePayload,
} from '../src/lib/payload-validation.js'

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

// ==================================================
// LIVE-DISCOVERY FOLLOW-UP — the SGS Score Workspace payload family
// (kind: 'sgs_score_workspace'), a completely separate, independent
// payload family from the assignment-scoped one above. See
// src/types/sgs-score-workspace.ts's own doc comment for why the two
// are never unified.
// ==================================================

function validWorkspacePayload(overrides: Record<string, unknown> = {}) {
  return {
    kind: SGS_SCORE_WORKSPACE_PAYLOAD_KIND,
    version: SGS_SCORE_WORKSPACE_PAYLOAD_VERSION,
    generatedAt: new Date().toISOString(),
    subject: { id: 'sub-1', name: 'ประวัติศาสตร์ไทย' },
    classroom: { id: 'cls-1', name: 'ม.5/1' },
    targetColumn: { key: 'col-10', label: 'ช่อง 10', maxScore: 15 },
    students: [{ studentId: 's1', studentNumber: 1, studentCode: '00001', fullName: 'สมชาย ใจดี', score: 10 }],
    skippedStudentIds: [],
    ...overrides,
  }
}

describe('validateSgsScoreWorkspacePayload — the independent "คะแนน SGS" workspace payload', () => {
  it('accepts a well-formed payload, including an explicit score of 0', () => {
    expect(validateSgsScoreWorkspacePayload(validWorkspacePayload()).ok).toBe(true)
    const withZero = validWorkspacePayload({
      students: [{ studentId: 's2', studentNumber: 2, studentCode: null, fullName: 'ข', score: 0 }],
    })
    expect(validateSgsScoreWorkspacePayload(withZero).ok).toBe(true)
  })

  it('rejects a mismatched kind or version', () => {
    expect(validateSgsScoreWorkspacePayload(validWorkspacePayload({ kind: 'assignment' })).ok).toBe(false)
    expect(validateSgsScoreWorkspacePayload(validWorkspacePayload({ version: 999 })).ok).toBe(false)
  })

  it('rejects a score above targetColumn.maxScore — never silently accepted', () => {
    const payload = validWorkspacePayload({
      students: [{ studentId: 's1', studentNumber: 1, studentCode: null, fullName: 'ก', score: 999 }],
    })
    const result = validateSgsScoreWorkspacePayload(payload)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('เกินคะแนนเต็มของช่อง SGS'))).toBe(true)
  })

  it('rejects a null score inside students — a skipped student must never appear there', () => {
    const payload = validWorkspacePayload({
      students: [{ studentId: 's1', studentNumber: 1, studentCode: null, fullName: 'ก', score: null }],
    })
    expect(validateSgsScoreWorkspacePayload(payload).ok).toBe(false)
  })

  it('rejects a payload missing subject/classroom', () => {
    expect(validateSgsScoreWorkspacePayload(validWorkspacePayload({ subject: undefined })).ok).toBe(false)
    expect(validateSgsScoreWorkspacePayload(validWorkspacePayload({ classroom: undefined })).ok).toBe(false)
  })

  it('never trusts a payload carrying a credential-like key at any depth', () => {
    const payload = validWorkspacePayload({ classroom: { id: 'cls-1', name: 'ม.5/1', sgsCookie: 'abc' } })
    const result = validateSgsScoreWorkspacePayload(payload)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('ต้องสงสัย'))).toBe(true)
  })
})

describe('validateAnySgsBridgePayload — dispatches by `kind`, never guesses from shape', () => {
  it('dispatches a workspace-kind payload to validateSgsScoreWorkspacePayload', () => {
    const result = validateAnySgsBridgePayload(validWorkspacePayload())
    expect(result.kind).toBe(SGS_SCORE_WORKSPACE_PAYLOAD_KIND)
    expect(result.validation.ok).toBe(true)
  })

  it('a workspace-kind payload that fails ITS OWN rules (e.g. over-max score) is reported invalid, never silently accepted by the wrong validator', () => {
    const payload = validWorkspacePayload({
      students: [{ studentId: 's1', studentNumber: 1, studentCode: null, fullName: 'ก', score: 999 }],
    })
    const result = validateAnySgsBridgePayload(payload)
    expect(result.kind).toBe(SGS_SCORE_WORKSPACE_PAYLOAD_KIND)
    expect(result.validation.ok).toBe(false)
  })

  it('a payload with no `kind` field at all (the legacy v2 file shape) is treated as assignment-kind by default', () => {
    const legacyPayload = validPayload()
    expect('kind' in legacyPayload).toBe(false)
    const result = validateAnySgsBridgePayload(legacyPayload)
    expect(result.kind).toBe('assignment')
    expect(result.validation.ok).toBe(true)
  })

  it('an assignment-kind payload is validated by validateSgsBridgePayload, unaffected by the new workspace validator', () => {
    const result = validateAnySgsBridgePayload(validPayload({ subjectName: '' }))
    expect(result.kind).toBe('assignment')
    expect(result.validation.ok).toBe(false)
  })
})
