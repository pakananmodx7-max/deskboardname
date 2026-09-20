import { describe, expect, it } from 'vitest'

import {
  buildSgsScoreWorkspacePayload,
  buildSgsScoreWorkspaceRows,
  computeSgsScoreWorkspaceSendPlan,
  validateSgsScoreWorkspacePayload,
} from './sgs-score-workspace-service'
import { SGS_SCORE_WORKSPACE_PAYLOAD_KIND, SGS_SCORE_WORKSPACE_PAYLOAD_VERSION } from '@/types/sgs-score-workspace'

const roster = [
  { id: 's1', number: 1, studentCode: '00001', firstName: 'สมชาย', lastName: 'ใจดี' },
  { id: 's2', number: 2, studentCode: '00002', firstName: 'สมหญิง', lastName: 'ใจดี' },
  { id: 's3', number: 3, studentCode: '00003', firstName: 'วิชัย', lastName: 'เก่งกล้า' },
]

const columns = [{ id: 'col-10' }, { id: 'col-11' }]

describe('buildSgsScoreWorkspaceRows — one row per roster student, correct identifiers, only requested columns', () => {
  it('maps studentNumber/studentCode/fullName correctly, and each column\'s score by columnId', () => {
    const rows = buildSgsScoreWorkspaceRows(roster, columns, {
      'col-10': { s1: 10, s2: null },
      'col-11': { s1: 5 },
    })
    expect(rows).toEqual([
      { studentId: 's1', studentNumber: 1, studentCode: '00001', fullName: 'สมชาย ใจดี', scoresByColumnId: { 'col-10': 10, 'col-11': 5 } },
      { studentId: 's2', studentNumber: 2, studentCode: '00002', fullName: 'สมหญิง ใจดี', scoresByColumnId: { 'col-10': null, 'col-11': null } },
      { studentId: 's3', studentNumber: 3, studentCode: '00003', fullName: 'วิชัย เก่งกล้า', scoresByColumnId: { 'col-10': null, 'col-11': null } },
    ])
  })

  it('never includes a column that is not in the requested `columns` list, even if stray data for it exists — classroom/column isolation', () => {
    const rows = buildSgsScoreWorkspaceRows(roster, [{ id: 'col-10' }], {
      'col-10': { s1: 10 },
      // A column belonging to a DIFFERENT subject+classroom's workspace
      // (never fetched via getSgsScoreColumns for THIS one) must never
      // leak into a row just because its scores happen to be present in
      // this map.
      'col-99-other-classroom': { s1: 999 },
    })
    expect(rows[0].scoresByColumnId).toEqual({ 'col-10': 10 })
    expect(Object.keys(rows[0].scoresByColumnId)).not.toContain('col-99-other-classroom')
  })

  it('a null score is never coerced to 0', () => {
    const rows = buildSgsScoreWorkspaceRows(roster, columns, { 'col-10': {}, 'col-11': {} })
    expect(rows[0].scoresByColumnId['col-10']).toBeNull()
  })
})

describe('computeSgsScoreWorkspaceSendPlan — blank skipped, explicit 0 preserved, over-max rejected', () => {
  const rows = buildSgsScoreWorkspaceRows(roster, columns, {
    'col-10': { s1: 10, s2: 0, s3: 999 },
    'col-11': {},
  })

  it('a blank/null score is skip_no_score', () => {
    const plan = computeSgsScoreWorkspaceSendPlan(rows, 'col-11', 15)
    expect(plan.every((r) => r.action === 'skip_no_score')).toBe(true)
    expect(plan.every((r) => r.score === null)).toBe(true)
  })

  it('an explicit 0 is sent, never skipped as if it were blank', () => {
    const plan = computeSgsScoreWorkspaceSendPlan(rows, 'col-10', 15)
    const row = plan.find((r) => r.studentId === 's2')!
    expect(row.action).toBe('send')
    expect(row.score).toBe(0)
  })

  it('a score greater than maxScore is REJECTED (skip_over_max), never clamped or sent', () => {
    const plan = computeSgsScoreWorkspaceSendPlan(rows, 'col-10', 15)
    const row = plan.find((r) => r.studentId === 's3')!
    expect(row.action).toBe('skip_over_max')
    expect(row.score).toBe(999)
  })

  it('a score within range is sent', () => {
    const plan = computeSgsScoreWorkspaceSendPlan(rows, 'col-10', 15)
    const row = plan.find((r) => r.studentId === 's1')!
    expect(row.action).toBe('send')
    expect(row.score).toBe(10)
  })

  it('never looks at any OTHER column\'s score for the same student', () => {
    const plan = computeSgsScoreWorkspaceSendPlan(rows, 'col-11', 15)
    // s1 has a real score (10) in col-10, but col-11 is blank for
    // everyone — the plan for col-11 must not borrow col-10's value.
    const row = plan.find((r) => r.studentId === 's1')!
    expect(row.score).toBeNull()
    expect(row.action).toBe('skip_no_score')
  })
})

describe('buildSgsScoreWorkspacePayload — the ONLY selected column, correct identifiers, never a credential', () => {
  const rows = buildSgsScoreWorkspaceRows(roster, columns, {
    'col-10': { s1: 10, s2: 0, s3: 999 },
    'col-11': { s1: 7, s2: 7, s3: 7 },
  })
  const plan = computeSgsScoreWorkspaceSendPlan(rows, 'col-10', 15)
  const payload = buildSgsScoreWorkspacePayload(
    {
      subjectId: 'subj-1',
      subjectName: 'ประวัติศาสตร์ไทย',
      classroomId: 'room-1',
      classroomName: 'ม.5/1',
      targetColumn: { key: 'col-10', label: 'ช่อง 10', maxScore: 15 },
    },
    plan,
  )

  it('carries the exact kind/version discriminator this payload family uses', () => {
    expect(payload.kind).toBe(SGS_SCORE_WORKSPACE_PAYLOAD_KIND)
    expect(payload.version).toBe(SGS_SCORE_WORKSPACE_PAYLOAD_VERSION)
  })

  it('identifies only the ONE selected column — never a different or additional one', () => {
    expect(payload.targetColumn).toEqual({ key: 'col-10', label: 'ช่อง 10', maxScore: 15 })
  })

  it('students[] contains only "send" rows — never a blank or over-max one', () => {
    expect(payload.students.map((s) => s.studentId).sort()).toEqual(['s1', 's2'])
    expect(payload.students.find((s) => s.studentId === 's2')?.score).toBe(0)
  })

  it('skippedStudentIds records s3 as over_max_score', () => {
    const skipped = payload.skippedStudentIds.find((s) => s.studentId === 's3')
    expect(skipped?.reason).toBe('over_max_score')
  })

  it('preserves studentNumber/studentCode/fullName correctly for a sent student', () => {
    const s1 = payload.students.find((s) => s.studentId === 's1')!
    expect(s1.studentNumber).toBe(1)
    expect(s1.studentCode).toBe('00001')
    expect(s1.fullName).toBe('สมชาย ใจดี')
  })

  it('never contains a password/cookie/token/service-role-shaped field', () => {
    expect(JSON.stringify(payload)).not.toMatch(/password|cookie|token|secret|service_?role|credential|session/i)
  })
})

describe('validateSgsScoreWorkspacePayload', () => {
  function validPayload(overrides: Record<string, unknown> = {}) {
    return {
      kind: SGS_SCORE_WORKSPACE_PAYLOAD_KIND,
      version: SGS_SCORE_WORKSPACE_PAYLOAD_VERSION,
      generatedAt: new Date().toISOString(),
      subject: { id: 'subj-1', name: 'ประวัติศาสตร์ไทย' },
      classroom: { id: 'room-1', name: 'ม.5/1' },
      targetColumn: { key: 'col-10', label: 'ช่อง 10', maxScore: 15 },
      students: [{ studentId: 's1', studentNumber: 1, studentCode: '00001', fullName: 'สมชาย ใจดี', score: 10 }],
      skippedStudentIds: [],
      ...overrides,
    }
  }

  it('accepts a well-formed payload, including an explicit score of 0', () => {
    expect(validateSgsScoreWorkspacePayload(validPayload()).ok).toBe(true)
    const withZero = validPayload({ students: [{ studentId: 's2', studentNumber: 2, studentCode: null, fullName: 'B', score: 0 }] })
    expect(validateSgsScoreWorkspacePayload(withZero).ok).toBe(true)
  })

  it('rejects a mismatched kind or version', () => {
    expect(validateSgsScoreWorkspacePayload(validPayload({ kind: 'assignment' })).ok).toBe(false)
    expect(validateSgsScoreWorkspacePayload(validPayload({ version: 999 })).ok).toBe(false)
  })

  it('rejects a score above targetColumn.maxScore — never silently accepted', () => {
    const payload = validPayload({
      students: [{ studentId: 's1', studentNumber: 1, studentCode: null, fullName: 'A', score: 999 }],
    })
    const result = validateSgsScoreWorkspacePayload(payload)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('เกินคะแนนเต็ม'))).toBe(true)
  })

  it('rejects a null score inside students[] — a skipped student must never appear there', () => {
    const payload = validPayload({ students: [{ studentId: 's1', studentNumber: 1, studentCode: null, fullName: 'A', score: null }] })
    expect(validateSgsScoreWorkspacePayload(payload).ok).toBe(false)
  })

  it('rejects a payload missing subject/classroom/targetColumn', () => {
    expect(validateSgsScoreWorkspacePayload(validPayload({ subject: undefined })).ok).toBe(false)
    expect(validateSgsScoreWorkspacePayload(validPayload({ classroom: undefined })).ok).toBe(false)
    expect(validateSgsScoreWorkspacePayload(validPayload({ targetColumn: undefined })).ok).toBe(false)
  })

  it('never trusts a payload carrying a credential-like key at any depth', () => {
    const payload = validPayload({ classroom: { id: 'room-1', name: 'ม.5/1', sgsSessionCookie: 'abc' } })
    const result = validateSgsScoreWorkspacePayload(payload)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('ห้ามมีข้อมูลลับ'))).toBe(true)
  })

  it('rejects non-object input without throwing', () => {
    expect(validateSgsScoreWorkspacePayload(null).ok).toBe(false)
    expect(validateSgsScoreWorkspacePayload('x').ok).toBe(false)
  })
})
