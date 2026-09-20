import { describe, expect, it } from 'vitest'

import {
  buildSingleCellTestPlan,
  canEnableSingleCellTestWrite,
  evaluateSingleCellTestPreconditions,
  formatSingleCellTestSummary,
  revalidateSingleCellTestContext,
  singleCellTestWriteCount,
} from '../src/lib/single-cell-test.js'

describe('buildSingleCellTestPlan / singleCellTestWriteCount — item 5: exactly ONE cell, never more', () => {
  it('builds a plan whose writesByOffset contains EXACTLY the one requested offset', () => {
    const plan = buildSingleCellTestPlan({ sgsRowOffset: 4, columnIndex: 6, columnKey: 'real-11-6', currentValue: 7, newValue: 9 })
    expect(plan.valid).toBe(true)
    expect(plan.writesByOffset).toEqual({ 4: 9 })
    expect(singleCellTestWriteCount(plan)).toBe(1)
  })

  it('never touches any offset other than the one requested, whatever the offset value', () => {
    const plan = buildSingleCellTestPlan({ sgsRowOffset: 0, columnIndex: 0, columnKey: 'k', currentValue: null, newValue: 5 })
    expect(Object.keys(plan.writesByOffset)).toEqual(['0'])
    expect(plan.writesByOffset[1]).toBeUndefined()
    expect(plan.writesByOffset[2]).toBeUndefined()
  })

  it('is invalid (and writes nothing) for a negative or non-integer row offset', () => {
    const negative = buildSingleCellTestPlan({ sgsRowOffset: -1, columnIndex: 0, columnKey: 'k', currentValue: null, newValue: 5 })
    expect(negative.valid).toBe(false)
    expect(singleCellTestWriteCount(negative)).toBe(0)

    const fractional = buildSingleCellTestPlan({ sgsRowOffset: 1.5, columnIndex: 0, columnKey: 'k', currentValue: null, newValue: 5 })
    expect(fractional.valid).toBe(false)
    expect(singleCellTestWriteCount(fractional)).toBe(0)
  })

  it('is invalid for a negative or non-integer column index', () => {
    expect(buildSingleCellTestPlan({ sgsRowOffset: 0, columnIndex: -1, columnKey: 'k', currentValue: null, newValue: 5 }).valid).toBe(
      false,
    )
  })

  it('is invalid when the new value is null, undefined, or not a finite number — never writes a garbage value', () => {
    expect(buildSingleCellTestPlan({ sgsRowOffset: 0, columnIndex: 0, columnKey: 'k', currentValue: null, newValue: null }).valid).toBe(
      false,
    )
    expect(
      buildSingleCellTestPlan({ sgsRowOffset: 0, columnIndex: 0, columnKey: 'k', currentValue: null, newValue: undefined }).valid,
    ).toBe(false)
    expect(buildSingleCellTestPlan({ sgsRowOffset: 0, columnIndex: 0, columnKey: 'k', currentValue: null, newValue: NaN }).valid).toBe(
      false,
    )
  })

  it('formatSingleCellTestSummary shows current -> new for a valid plan, and a failure message for an invalid one', () => {
    const valid = buildSingleCellTestPlan({ sgsRowOffset: 0, columnIndex: 0, columnKey: 'k', currentValue: 7, newValue: 9 })
    expect(formatSingleCellTestSummary(valid)).toContain('7')
    expect(formatSingleCellTestSummary(valid)).toContain('9')

    const invalid = buildSingleCellTestPlan({ sgsRowOffset: 0, columnIndex: 0, columnKey: 'k', currentValue: null, newValue: null })
    expect(formatSingleCellTestSummary(invalid)).not.toContain('undefined')
  })
})

function validPreconditionsInput(overrides = {}) {
  return {
    studentGridFound: true,
    confidence: 'high',
    selectedStudentCount: 1,
    selectedColumnCount: 1,
    columnIsWritable: true,
    headerCheckboxOk: true,
    cellInputState: { visible: true, enabled: true, visibleInputCount: 1 },
    proposedScore: 8,
    maxScore: 10,
    studentVisibleOnCurrentPage: true,
    subjectClassroomOk: true,
    ...overrides,
  }
}

describe('evaluateSingleCellTestPreconditions — CONTROLLED LIVE TEST: every gate the enable button must pass', () => {
  it('passes when every condition holds', () => {
    expect(evaluateSingleCellTestPreconditions(validPreconditionsInput())).toEqual({ ok: true, reason: null })
  })

  it('fails when the student grid was not found', () => {
    const result = evaluateSingleCellTestPreconditions(validPreconditionsInput({ studentGridFound: false }))
    expect(result.ok).toBe(false)
    expect(result.reason).toBeTruthy()
  })

  it('fails when confidence is anything other than "high" — medium/low/none are all rejected', () => {
    for (const confidence of ['medium', 'low', 'none']) {
      const result = evaluateSingleCellTestPreconditions(validPreconditionsInput({ confidence }))
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('high')
    }
  })

  it('fails when zero or more than one student is selected', () => {
    expect(evaluateSingleCellTestPreconditions(validPreconditionsInput({ selectedStudentCount: 0 })).ok).toBe(false)
    expect(evaluateSingleCellTestPreconditions(validPreconditionsInput({ selectedStudentCount: 2 })).ok).toBe(false)
  })

  it('fails when zero or more than one column is selected', () => {
    expect(evaluateSingleCellTestPreconditions(validPreconditionsInput({ selectedColumnCount: 0 })).ok).toBe(false)
    expect(evaluateSingleCellTestPreconditions(validPreconditionsInput({ selectedColumnCount: 2 })).ok).toBe(false)
  })

  it('fails when the selected column is not a writableScoreColumn', () => {
    expect(evaluateSingleCellTestPreconditions(validPreconditionsInput({ columnIsWritable: false })).ok).toBe(false)
  })

  it('fails when the SGS header checkbox has not been checked by the teacher', () => {
    expect(evaluateSingleCellTestPreconditions(validPreconditionsInput({ headerCheckboxOk: false })).ok).toBe(false)
  })

  it('fails when the selected row has no visible/enabled input at all', () => {
    expect(
      evaluateSingleCellTestPreconditions(validPreconditionsInput({ cellInputState: { visible: false, enabled: true, visibleInputCount: 1 } }))
        .ok,
    ).toBe(false)
    expect(
      evaluateSingleCellTestPreconditions(validPreconditionsInput({ cellInputState: { visible: true, enabled: false, visibleInputCount: 1 } }))
        .ok,
    ).toBe(false)
    expect(evaluateSingleCellTestPreconditions(validPreconditionsInput({ cellInputState: null })).ok).toBe(false)
  })

  it('fails when the selected row has MORE than one visible input — never treated as safe just because one of them is the "right" one', () => {
    expect(
      evaluateSingleCellTestPreconditions(validPreconditionsInput({ cellInputState: { visible: true, enabled: true, visibleInputCount: 2 } }))
        .ok,
    ).toBe(false)
  })

  it('fails when the proposed score is null, undefined, NaN, or negative', () => {
    expect(evaluateSingleCellTestPreconditions(validPreconditionsInput({ proposedScore: null })).ok).toBe(false)
    expect(evaluateSingleCellTestPreconditions(validPreconditionsInput({ proposedScore: undefined })).ok).toBe(false)
    expect(evaluateSingleCellTestPreconditions(validPreconditionsInput({ proposedScore: NaN })).ok).toBe(false)
    expect(evaluateSingleCellTestPreconditions(validPreconditionsInput({ proposedScore: -1 })).ok).toBe(false)
  })

  it('REGRESSION — score 0 is explicitly valid, never rejected as if it were "no score"', () => {
    expect(evaluateSingleCellTestPreconditions(validPreconditionsInput({ proposedScore: 0 })).ok).toBe(true)
  })

  it('fails when the proposed score exceeds the column\'s known max score', () => {
    expect(evaluateSingleCellTestPreconditions(validPreconditionsInput({ proposedScore: 11, maxScore: 10 })).ok).toBe(false)
  })

  it('never rejects for exceeding max when max score is unknown (null) — nothing to compare against', () => {
    expect(evaluateSingleCellTestPreconditions(validPreconditionsInput({ proposedScore: 999, maxScore: null })).ok).toBe(true)
  })

  it('a score exactly equal to max score is valid, never rejected as "exceeding"', () => {
    expect(evaluateSingleCellTestPreconditions(validPreconditionsInput({ proposedScore: 10, maxScore: 10 })).ok).toBe(true)
  })

  it('LIVE DISCOVERY item 5: fails when the target student is not visible on the current SGS page, with the exact required message', () => {
    const result = evaluateSingleCellTestPreconditions(validPreconditionsInput({ studentVisibleOnCurrentPage: false }))
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('นักเรียนอยู่หน้าอื่นของ SGS กรุณาเปิดหน้าที่มีนักเรียนคนนี้ก่อน')
  })

  it('LIVE DISCOVERY item 5: fails when the SGS page\'s subject/classroom no longer matches the loaded payload', () => {
    const result = evaluateSingleCellTestPreconditions(validPreconditionsInput({ subjectClassroomOk: false }))
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('รายวิชา/ห้องเรียน')
  })
})

describe('canEnableSingleCellTestWrite — the write button\'s own gate: preconditions AND explicit consent, never either alone', () => {
  it('is false when preconditions fail, even if the checkbox is checked', () => {
    expect(canEnableSingleCellTestWrite(false, true)).toBe(false)
  })

  it('is false when preconditions pass but the checkbox is unchecked', () => {
    expect(canEnableSingleCellTestWrite(true, false)).toBe(false)
  })

  it('is true only when both hold', () => {
    expect(canEnableSingleCellTestWrite(true, true)).toBe(true)
  })

  it('never coerces a truthy-but-not-true consent value (e.g. a string) into enabling the write', () => {
    // @ts-expect-error deliberately passing a non-boolean to prove strict equality is used
    expect(canEnableSingleCellTestWrite(true, 'yes')).toBe(false)
  })
})

function matchingRevalidationPair(overrides = {}) {
  const confirmed = {
    subjectFilterText: 'คณิตศาสตร์',
    classroomFilterText: 'ม.5/2',
    studentNumber: 7,
    studentCode: '12345',
    studentName: 'เด็กชาย ทดสอบ ระบบ',
    columnKey: 'real-11-6',
  }
  const fresh = {
    ...confirmed,
    cellVisible: true,
    cellEnabled: true,
    visibleInputCount: 1,
  }
  return { confirmed, fresh: { ...fresh, ...overrides } }
}

describe('revalidateSingleCellTestContext — GUARD AGAINST STALE DOM: any drift between preview and write-time aborts', () => {
  it('passes when nothing has changed', () => {
    const { confirmed, fresh } = matchingRevalidationPair()
    expect(revalidateSingleCellTestContext(confirmed, fresh)).toEqual({ ok: true, reason: null })
  })

  it('aborts when the subject filter changed', () => {
    const { confirmed, fresh } = matchingRevalidationPair({ subjectFilterText: 'ภาษาไทย' })
    expect(revalidateSingleCellTestContext(confirmed, fresh).ok).toBe(false)
  })

  it('aborts when the classroom filter changed', () => {
    const { confirmed, fresh } = matchingRevalidationPair({ classroomFilterText: 'ม.5/3' })
    expect(revalidateSingleCellTestContext(confirmed, fresh).ok).toBe(false)
  })

  it('aborts when a different student now sits at the same row offset (number, code, or name changed)', () => {
    expect(revalidateSingleCellTestContext(...Object.values(matchingRevalidationPair({ studentNumber: 8 }))).ok).toBe(false)
    expect(revalidateSingleCellTestContext(...Object.values(matchingRevalidationPair({ studentCode: '99999' }))).ok).toBe(false)
    expect(revalidateSingleCellTestContext(...Object.values(matchingRevalidationPair({ studentName: 'คนอื่น' }))).ok).toBe(false)
  })

  it('aborts when the cell is no longer visible, no longer enabled, or now has more than one visible input', () => {
    expect(revalidateSingleCellTestContext(...Object.values(matchingRevalidationPair({ cellVisible: false }))).ok).toBe(false)
    expect(revalidateSingleCellTestContext(...Object.values(matchingRevalidationPair({ cellEnabled: false }))).ok).toBe(false)
    expect(revalidateSingleCellTestContext(...Object.values(matchingRevalidationPair({ visibleInputCount: 2 }))).ok).toBe(false)
  })

  it('every failure reason is a non-empty, human-readable string — never a blank abort', () => {
    const { confirmed, fresh } = matchingRevalidationPair({ subjectFilterText: 'อื่น' })
    const result = revalidateSingleCellTestContext(confirmed, fresh)
    expect(result.reason).toBeTruthy()
    expect(typeof result.reason).toBe('string')
  })
})
