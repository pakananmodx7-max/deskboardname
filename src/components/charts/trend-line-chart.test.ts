import { describe, expect, it } from 'vitest'

import { trendLineSegments, trendPointX, trendPointY } from '@/components/charts/trend-line-chart'

describe('trendPointX', () => {
  it('evenly spaces points across the chart width', () => {
    expect(trendPointX(0, 3)).toBeCloseTo(12, 5)
    expect(trendPointX(2, 3)).toBeCloseTo(308, 5)
  })

  it('a single point never divides by zero — placed at the left edge', () => {
    expect(trendPointX(0, 1)).toBe(12)
  })
})

describe('trendPointY', () => {
  it('a value of 100 is at the top, 0 is at the bottom (higher score = higher on screen)', () => {
    expect(trendPointY(100)).toBeLessThan(trendPointY(0))
  })

  it('clamps out-of-range values rather than drawing off-chart', () => {
    expect(trendPointY(150)).toBe(trendPointY(100))
    expect(trendPointY(-10)).toBe(trendPointY(0))
  })
})

describe('trendLineSegments', () => {
  it('one segment when every value is present', () => {
    expect(trendLineSegments([10, 20, 30])).toHaveLength(1)
  })

  it('a null value BREAKS the line into two segments rather than dipping to a fabricated 0', () => {
    const segments = trendLineSegments([10, null, 30])
    expect(segments).toHaveLength(2)
  })

  it('leading/trailing nulls produce no segment for that end', () => {
    expect(trendLineSegments([null, 10, 20])).toHaveLength(1)
    expect(trendLineSegments([10, 20, null])).toHaveLength(1)
  })

  it('all-null input produces zero segments, never throws', () => {
    expect(trendLineSegments([null, null])).toHaveLength(0)
  })
})
