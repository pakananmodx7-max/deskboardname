import { describe, expect, it } from 'vitest'

import { computeBarWidthPercent } from '@/components/dashboard/bar-chart'

describe('computeBarWidthPercent', () => {
  it('scales a value against the data set\'s own max — the largest bar always reaches 100%', () => {
    expect(computeBarWidthPercent(30, 30)).toBe(100)
    expect(computeBarWidthPercent(15, 30)).toBe(50)
    expect(computeBarWidthPercent(0, 30)).toBe(0)
  })

  it('never divides by zero when every value (and so max) is 0', () => {
    expect(computeBarWidthPercent(0, 0)).toBe(0)
    expect(Number.isFinite(computeBarWidthPercent(0, 0))).toBe(true)
  })
})
