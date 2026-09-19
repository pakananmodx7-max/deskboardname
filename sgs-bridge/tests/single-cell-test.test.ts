import { describe, expect, it } from 'vitest'

import { buildSingleCellTestPlan, formatSingleCellTestSummary, singleCellTestWriteCount } from '../src/lib/single-cell-test.js'

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
