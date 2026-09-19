import { describe, expect, it } from 'vitest'

import {
  buildSgsColumnWriteInstructions,
  computeSgsColumnFillPlan,
  formatSgsExistingScoreDisplay,
  formatSgsNewValueDisplay,
} from '../src/lib/column-fill.js'

// Mirrors src/services/sgs-export-service.test.ts's column-fill cases
// one-for-one, since column-fill.js duplicates that module's rules (see
// its own doc comment) — required by the task: selecting one column
// must never touch any other, blank scores are always skipped, an
// explicit zero is always preserved, and overwriting an existing value
// requires an explicit teacher choice.

function row(studentId: string, studentNumber: number, fullName: string, krunameScore: number | null) {
  return { studentId, studentNumber, fullName, krunameScore }
}

describe('computeSgsColumnFillPlan — blank score is always skipped', () => {
  it('a null KrunameClass score is skip_no_score regardless of overwrite mode', () => {
    const plan1 = computeSgsColumnFillPlan([row('s1', 1, 'A', null)], { s1: 5 }, 'skip_existing')
    const plan2 = computeSgsColumnFillPlan([row('s1', 1, 'A', null)], { s1: 5 }, 'overwrite_selected_column')
    expect(plan1[0].action).toBe('skip_no_score')
    expect(plan2[0].action).toBe('skip_no_score')
    expect(formatSgsNewValueDisplay(plan1[0])).toBe('ไม่เปลี่ยน')
  })
})

describe('computeSgsColumnFillPlan — explicit zero is preserved', () => {
  it('a KrunameClass score of exactly 0 still produces a write action with value 0', () => {
    const plan = computeSgsColumnFillPlan([row('s1', 1, 'A', 0)], {}, 'skip_existing')
    expect(plan[0].action).toBe('write')
    expect(plan[0].krunameScore).toBe(0)
    expect(formatSgsNewValueDisplay(plan[0])).toBe('0')
  })
})

describe('computeSgsColumnFillPlan — existing value in the target column is skipped by DEFAULT', () => {
  it('skip_existing leaves an already-filled cell alone', () => {
    const plan = computeSgsColumnFillPlan([row('s1', 1, 'A', 7)], { s1: 6 }, 'skip_existing')
    expect(plan[0].action).toBe('skip_existing')
    expect(formatSgsExistingScoreDisplay(plan[0].sgsExistingScore)).toBe('6')
    expect(formatSgsNewValueDisplay(plan[0])).toBe('ไม่เปลี่ยน')
  })

  it('an empty (null) existing value is never treated as "already filled"', () => {
    const plan = computeSgsColumnFillPlan([row('s1', 1, 'A', 8)], { s1: null }, 'skip_existing')
    expect(plan[0].action).toBe('write')
  })
})

describe('computeSgsColumnFillPlan — overwrite requires the explicit teacher choice', () => {
  it('overwrite_selected_column is required to replace an existing value', () => {
    const plan = computeSgsColumnFillPlan([row('s1', 1, 'A', 7)], { s1: 6 }, 'overwrite_selected_column')
    expect(plan[0].action).toBe('write')
    expect(plan[0].krunameScore).toBe(7)
  })
})

describe('buildSgsColumnWriteInstructions — selecting one column never modifies another', () => {
  const rows = [row('s1', 1, 'A', 1), row('s2', 2, 'B', 2), row('s3', 3, 'C', 3)]

  it('selecting column 1 produces instructions tagged ONLY "col1"', () => {
    const plan = computeSgsColumnFillPlan(rows, {}, 'skip_existing')
    const instructions = buildSgsColumnWriteInstructions(plan, 'col1')
    expect(instructions.length).toBe(3)
    expect(instructions.every((i) => i.columnKey === 'col1')).toBe(true)
  })

  it('selecting midterm produces instructions tagged ONLY "midterm" — never col1/col2/final', () => {
    const plan = computeSgsColumnFillPlan(rows, {}, 'skip_existing')
    const instructions = buildSgsColumnWriteInstructions(plan, 'midterm')
    expect(instructions.every((i) => i.columnKey === 'midterm')).toBe(true)
    expect(instructions.some((i) => i.columnKey !== 'midterm')).toBe(false)
  })

  it('the SAME plan produces disjoint instruction sets for different requested columns — never a shared/leaked column key', () => {
    const plan = computeSgsColumnFillPlan(rows, {}, 'skip_existing')
    const col1 = buildSgsColumnWriteInstructions(plan, 'col1')
    const midterm = buildSgsColumnWriteInstructions(plan, 'midterm')
    expect(col1.map((i) => i.columnKey)).not.toEqual(midterm.map((i) => i.columnKey))
    expect(new Set([...col1, ...midterm].map((i) => i.columnKey)).size).toBe(2)
  })

  it('a skip_existing row contributes no instruction to the selected column — the existing value there stays untouched', () => {
    const plan = computeSgsColumnFillPlan([row('s1', 1, 'A', 9)], { s1: 4 }, 'skip_existing')
    expect(buildSgsColumnWriteInstructions(plan, 'midterm')).toEqual([])
  })

  it('a blank-score row never produces an instruction for any column', () => {
    const plan = computeSgsColumnFillPlan([row('s1', 1, 'A', null)], {}, 'overwrite_selected_column')
    expect(buildSgsColumnWriteInstructions(plan, 'col1')).toEqual([])
    expect(buildSgsColumnWriteInstructions(plan, 'final')).toEqual([])
  })
})
