import { describe, expect, it } from 'vitest'

import {
  SGS_COLUMNS,
  buildSgsBridgePayload,
  buildSgsColumnFillCsvTable,
  buildSgsColumnWriteInstructions,
  buildSgsExportRows,
  computeSgsColumnFillPlan,
  computeSgsExportSummary,
  formatSgsExistingScoreDisplay,
  formatSgsNewValueDisplay,
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

const midterm = SGS_COLUMNS.find((c) => c.key === 'midterm')!

describe('buildSgsExportRows — null vs explicit zero', () => {
  it('a student with no submission row at all is null, not 0, and willSend is false', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], {})
    expect(rows[0].krunameScore).toBeNull()
    expect(rows[0].willSend).toBe(false)
  })

  it('an explicit score of 0 is preserved and WILL be sent — never treated as "no score"', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], { s1: submission(0) })
    expect(rows[0].krunameScore).toBe(0)
    expect(rows[0].willSend).toBe(true)
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

describe('computeSgsColumnFillPlan — the three actions', () => {
  it('a blank KrunameClass score is always skip_no_score, regardless of overwrite mode', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], {})
    const skip = computeSgsColumnFillPlan(rows, { s1: 5 }, 'skip_existing')
    const overwrite = computeSgsColumnFillPlan(rows, { s1: 5 }, 'overwrite_selected_column')
    expect(skip[0].action).toBe('skip_no_score')
    expect(overwrite[0].action).toBe('skip_no_score')
  })

  it('an explicit zero KrunameClass score still gets a write action', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], { s1: submission(0) })
    const plan = computeSgsColumnFillPlan(rows, {}, 'skip_existing')
    expect(plan[0].action).toBe('write')
    expect(plan[0].krunameScore).toBe(0)
  })

  it('an existing SGS value is skipped by DEFAULT mode (skip_existing)', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], { s1: submission(7) })
    const plan = computeSgsColumnFillPlan(rows, { s1: 6 }, 'skip_existing')
    expect(plan[0].action).toBe('skip_existing')
    expect(plan[0].sgsExistingScore).toBe(6)
  })

  it('overwriting requires the teacher explicitly choosing overwrite_selected_column', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], { s1: submission(7) })
    const plan = computeSgsColumnFillPlan(rows, { s1: 6 }, 'overwrite_selected_column')
    expect(plan[0].action).toBe('write')
    expect(plan[0].krunameScore).toBe(7)
  })

  it('an empty (null) existing SGS value is never treated as "already has a value" — always writes', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], { s1: submission(8) })
    const plan = computeSgsColumnFillPlan(rows, { s1: null }, 'skip_existing')
    expect(plan[0].action).toBe('write')
  })

  it('matches the spec example rows exactly', () => {
    const rows = buildSgsExportRows(
      [student('s1', 1, 'A'), student('s2', 2, 'B'), student('s3', 3, 'C')],
      { s1: submission(8), s2: submission(7), s3: submission(null) },
    )
    const plan = computeSgsColumnFillPlan(rows, { s2: 6, s3: 5 }, 'overwrite_selected_column')
    expect(formatSgsExistingScoreDisplay(plan[0].sgsExistingScore)).toBe('ว่าง')
    expect(formatSgsNewValueDisplay(plan[0])).toBe('8')
    expect(formatSgsExistingScoreDisplay(plan[1].sgsExistingScore)).toBe('6')
    expect(formatSgsNewValueDisplay(plan[1])).toBe('7')
    expect(formatSgsExistingScoreDisplay(plan[2].sgsExistingScore)).toBe('5')
    expect(formatSgsNewValueDisplay(plan[2])).toBe('ไม่เปลี่ยน')
  })
})

describe('buildSgsColumnWriteInstructions — column isolation', () => {
  it('produces an instruction only for rows whose action is write', () => {
    const rows = buildSgsExportRows(
      [student('s1', 1, 'A'), student('s2', 2, 'B')],
      { s1: submission(8), s2: submission(null) },
    )
    const plan = computeSgsColumnFillPlan(rows, {}, 'skip_existing')
    const instructions = buildSgsColumnWriteInstructions(plan, 'col1')
    expect(instructions).toEqual([{ studentId: 's1', columnKey: 'col1', value: 8 }])
  })

  it('skip_existing rows never produce a write instruction — existing value in that column is left as-is', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'A')], { s1: submission(9) })
    const plan = computeSgsColumnFillPlan(rows, { s1: 4 }, 'skip_existing')
    expect(buildSgsColumnWriteInstructions(plan, 'midterm')).toEqual([])
  })

  it('every instruction carries EXACTLY the requested columnKey — selecting column 1 can never emit a "col2"/"midterm" instruction', () => {
    const rows = buildSgsExportRows(
      [student('s1', 1, 'A'), student('s2', 2, 'B'), student('s3', 3, 'C')],
      { s1: submission(1), s2: submission(2), s3: submission(3) },
    )
    const plan = computeSgsColumnFillPlan(rows, {}, 'skip_existing')
    for (const requestedKey of ['col1', 'col2', 'midterm', 'final']) {
      const instructions = buildSgsColumnWriteInstructions(plan, requestedKey)
      expect(instructions.length).toBeGreaterThan(0)
      expect(instructions.every((i) => i.columnKey === requestedKey)).toBe(true)
      expect(new Set(instructions.map((i) => i.columnKey)).size).toBe(1)
    }
  })

  it('an explicit zero produces a write instruction with value 0, never omitted', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'A')], { s1: submission(0) })
    const plan = computeSgsColumnFillPlan(rows, {}, 'skip_existing')
    expect(buildSgsColumnWriteInstructions(plan, 'col1')).toEqual([{ studentId: 's1', columnKey: 'col1', value: 0 }])
  })
})

describe('buildSgsColumnFillCsvTable', () => {
  it('includes the target column label/max and the full 5-column shape', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], { s1: submission(8) })
    const plan = computeSgsColumnFillPlan(rows, {}, 'skip_existing')
    const table = buildSgsColumnFillCsvTable('ประวัติศาสตร์ไทย', 'ม.5/1', 'แบบทดสอบบทที่ 4', midterm, plan)
    expect(table.subtitle).toContain('กลางภาค')
    expect(table.headers).toEqual(['เลขที่', 'นักเรียน', 'คะแนน KrunameClass', 'คะแนนเดิม SGS', 'คะแนนใหม่'])
    expect(table.rows[0]).toEqual([1, 'เอ สกุล', 8, 'ว่าง', '8'])
  })
})

const baseArgs = {
  subjectId: 'sub-1',
  subjectName: 'ประวัติศาสตร์ไทย',
  classroomId: 'cls-1',
  classroomName: 'ม.5/1',
  assignmentId: 'asg-1',
  assignmentTitle: 'แบบทดสอบบทที่ 4',
  assignmentMaxScore: 10,
  targetColumn: midterm,
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
    expect(payload.targetColumn).toEqual(midterm)
    expect(payload.overwriteMode).toBe('skip_existing')
  })

  it('defaults overwriteMode to skip_existing when not passed', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], { s1: submission(8) })
    const payload = buildSgsBridgePayload(baseArgs, rows)
    expect(payload.overwriteMode).toBe('skip_existing')
  })

  it('carries an explicit overwrite_selected_column choice through', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], { s1: submission(8) })
    const payload = buildSgsBridgePayload({ ...baseArgs, overwriteMode: 'overwrite_selected_column' }, rows)
    expect(payload.overwriteMode).toBe('overwrite_selected_column')
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
    const result = validateSgsBridgePayload({ ...payload, version: 1 })
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('version'))).toBe(true)
  })

  it('rejects a score above the assignment max', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], { s1: submission(8) })
    const payload = buildSgsBridgePayload(baseArgs, rows)
    const tampered = { ...payload, students: [{ ...payload.students[0], score: 999 }] }
    const result = validateSgsBridgePayload(tampered)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('เกินคะแนนเต็มของงาน'))).toBe(true)
  })

  it('rejects a score above the target column max even if within the assignment max', () => {
    const smallColumn = { key: 'tiny', label: 'ช่องเล็ก', maxScore: 5 }
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], { s1: submission(8) })
    const payload = buildSgsBridgePayload({ ...baseArgs, targetColumn: smallColumn, assignmentMaxScore: 10 }, rows)
    const result = validateSgsBridgePayload(payload)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('เกินคะแนนเต็มของช่อง SGS'))).toBe(true)
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

  it('rejects a missing targetColumn', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], { s1: submission(8) })
    const payload = buildSgsBridgePayload(baseArgs, rows)
    const { targetColumn: _omit, ...tampered } = payload
    expect(validateSgsBridgePayload(tampered).ok).toBe(false)
  })

  it('rejects an invalid overwriteMode', () => {
    const rows = buildSgsExportRows([student('s1', 1, 'เอ')], { s1: submission(8) })
    const payload = buildSgsBridgePayload(baseArgs, rows)
    const tampered = { ...payload, overwriteMode: 'always_overwrite_everything' }
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
