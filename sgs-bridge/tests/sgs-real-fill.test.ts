import { describe, expect, it } from 'vitest'

import { matchStudentsToSgs } from '../src/lib/mapping.js'
import {
  buildSgsRealWriteInstructions,
  computeSgsRealFillPlan,
  formatSgsExistingScoreDisplay,
  formatSgsNewValueDisplay,
  summarizeSgsRealFillPlan,
} from '../src/lib/sgs-real-fill.js'

function kn(studentId: string, studentNumber: number | null, fullName: string, score: number | null) {
  return { studentId, studentNumber, fullName, score }
}

function sgs(sgsRowKey: string, sgsStudentNumber: number | null, sgsFullNameRaw: string) {
  return { sgsRowKey, sgsStudentNumber, sgsStudentId: null, sgsFullNameRaw }
}

describe('computeSgsRealFillPlan — matched students', () => {
  it('a matched student with no existing SGS value and a KrunameClass score writes', () => {
    const students = [kn('k1', 1, 'สมชาย ใจดี', 8)]
    const mapping = matchStudentsToSgs(students, [sgs('row-0', 1, 'สมชาย ใจดี')])
    const plan = computeSgsRealFillPlan(students, mapping, {}, 'skip_existing')
    expect(plan[0].mappingStatus).toBe('MATCHED')
    expect(plan[0].action).toBe('write')
    expect(plan[0].krunameScore).toBe(8)
  })

  it('a blank KrunameClass score is always skipped, even when matched and no existing value', () => {
    const students = [kn('k1', 1, 'สมชาย ใจดี', null)]
    const mapping = matchStudentsToSgs(students, [sgs('row-0', 1, 'สมชาย ใจดี')])
    const plan = computeSgsRealFillPlan(students, mapping, {}, 'overwrite_selected_column')
    expect(plan[0].action).toBe('skip_no_score')
    expect(formatSgsNewValueDisplay(plan[0])).toBe('ไม่เปลี่ยน')
  })

  it('an explicit zero KrunameClass score still writes', () => {
    const students = [kn('k1', 1, 'สมชาย ใจดี', 0)]
    const mapping = matchStudentsToSgs(students, [sgs('row-0', 1, 'สมชาย ใจดี')])
    const plan = computeSgsRealFillPlan(students, mapping, {}, 'skip_existing')
    expect(plan[0].action).toBe('write')
    expect(plan[0].krunameScore).toBe(0)
    expect(formatSgsNewValueDisplay(plan[0])).toBe('0')
  })

  it('an existing SGS value in the target column is skipped by DEFAULT (skip_existing)', () => {
    const students = [kn('k1', 1, 'สมชาย ใจดี', 7)]
    const mapping = matchStudentsToSgs(students, [sgs('row-0', 1, 'สมชาย ใจดี')])
    const plan = computeSgsRealFillPlan(students, mapping, { 'row-0': 6 }, 'skip_existing')
    expect(plan[0].action).toBe('skip_existing')
    expect(formatSgsExistingScoreDisplay(plan[0])).toBe('6')
  })

  it('overwriting an existing value requires the explicit teacher choice', () => {
    const students = [kn('k1', 1, 'สมชาย ใจดี', 7)]
    const mapping = matchStudentsToSgs(students, [sgs('row-0', 1, 'สมชาย ใจดี')])
    const plan = computeSgsRealFillPlan(students, mapping, { 'row-0': 6 }, 'overwrite_selected_column')
    expect(plan[0].action).toBe('write')
    expect(plan[0].krunameScore).toBe(7)
  })

  it('an empty (null) existing value is never treated as "already has a value"', () => {
    const students = [kn('k1', 1, 'สมชาย ใจดี', 8)]
    const mapping = matchStudentsToSgs(students, [sgs('row-0', 1, 'สมชาย ใจดี')])
    const plan = computeSgsRealFillPlan(students, mapping, { 'row-0': null }, 'skip_existing')
    expect(plan[0].action).toBe('write')
  })
})

describe('computeSgsRealFillPlan — unmatched students are NEVER written', () => {
  it('NOT_FOUND never writes, whatever the KrunameClass score is', () => {
    const students = [kn('k1', 1, 'สมชาย ใจดี', 9)]
    const mapping = matchStudentsToSgs(students, [])
    const plan = computeSgsRealFillPlan(students, mapping, {}, 'overwrite_selected_column')
    expect(plan[0].mappingStatus).toBe('NOT_FOUND')
    expect(plan[0].action).toBe('skip_unmatched')
  })

  it('AMBIGUOUS never writes, even with overwrite_selected_column chosen', () => {
    const students = [kn('k1', 1, 'สมชาย ใจดี', 9)]
    const mapping = matchStudentsToSgs(students, [sgs('row-0', 1, 'A'), sgs('row-1', 1, 'B')])
    const plan = computeSgsRealFillPlan(students, mapping, {}, 'overwrite_selected_column')
    expect(plan[0].mappingStatus).toBe('AMBIGUOUS')
    expect(plan[0].action).toBe('skip_unmatched')
  })

  it('formatSgsExistingScoreDisplay reports "unknown" rather than "empty" for an unmatched row', () => {
    const students = [kn('k1', 1, 'สมชาย ใจดี', 9)]
    const mapping = matchStudentsToSgs(students, [])
    const plan = computeSgsRealFillPlan(students, mapping, {}, 'skip_existing')
    expect(formatSgsExistingScoreDisplay(plan[0])).toContain('ไม่ทราบ')
  })
})

describe('buildSgsRealWriteInstructions — column isolation on the real page', () => {
  it('produces one instruction per write action, tagged with the row it was actually matched to', () => {
    const students = [kn('k1', 1, 'A', 8), kn('k2', 2, 'B', null)]
    const mapping = matchStudentsToSgs(students, [sgs('row-3', 1, 'A'), sgs('row-4', 2, 'B')])
    const plan = computeSgsRealFillPlan(students, mapping, {}, 'skip_existing')
    const instructions = buildSgsRealWriteInstructions(plan, 'real-midterm-5')
    expect(instructions).toEqual([{ studentId: 'k1', sgsRowKey: 'row-3', columnKey: 'real-midterm-5', value: 8 }])
  })

  it('every instruction carries exactly the requested columnKey, never a different one', () => {
    const students = [kn('k1', 1, 'A', 1), kn('k2', 2, 'B', 2)]
    const mapping = matchStudentsToSgs(students, [sgs('row-0', 1, 'A'), sgs('row-1', 2, 'B')])
    const plan = computeSgsRealFillPlan(students, mapping, {}, 'skip_existing')
    for (const key of ['real-col1-2', 'real-midterm-5']) {
      const instructions = buildSgsRealWriteInstructions(plan, key)
      expect(instructions.every((i) => i.columnKey === key)).toBe(true)
    }
  })

  it('an unmatched or skipped row never produces an instruction', () => {
    const students = [kn('k1', 1, 'A', 8), kn('k2', 2, 'B', 9)]
    const mapping = matchStudentsToSgs(students, [sgs('row-0', 1, 'A')])
    const plan = computeSgsRealFillPlan(students, mapping, { 'row-0': 5 }, 'skip_existing')
    expect(buildSgsRealWriteInstructions(plan, 'real-col-0')).toEqual([])
  })
})

describe('summarizeSgsRealFillPlan — the five required buckets', () => {
  it('matches the spec: matched / written / skipped no score / skipped existing / ambiguous-or-not-found', () => {
    const students = [
      kn('k1', 1, 'A', 8), // matched, writes
      kn('k2', 2, 'B', null), // matched, no score
      kn('k3', 3, 'C', 7), // matched, existing value, skip_existing
      kn('k4', 4, 'D', 5), // not found — number 4 doesn't exist in SGS, name "D" doesn't either
      kn('k5', 4, 'E', 6), // not found — same reasoning, independent of k4
    ]
    const mapping = matchStudentsToSgs(students, [
      sgs('row-0', 1, 'A'),
      sgs('row-1', 2, 'B'),
      sgs('row-2', 3, 'C'),
    ])
    const plan = computeSgsRealFillPlan(students, mapping, { 'row-2': 4 }, 'skip_existing')
    const summary = summarizeSgsRealFillPlan(plan)
    expect(summary).toEqual({
      matched: 3,
      written: 1,
      skippedNoScore: 1,
      skippedExisting: 1,
      ambiguousOrNotFound: 2,
    })
  })
})
