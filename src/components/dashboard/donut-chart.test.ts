import { describe, expect, it } from 'vitest'

import { computeDonutArcs } from '@/components/dashboard/donut-chart'

const CIRCUMFERENCE = 2 * Math.PI * 40

describe('computeDonutArcs', () => {
  it('splits the ring proportionally — two equal segments each get half the circumference', () => {
    const [a, b] = computeDonutArcs([
      { label: 'มาเรียน', value: 5 },
      { label: 'ขาดเรียน', value: 5 },
    ])
    const [aDash] = a.dasharray.split(' ').map(Number)
    const [bDash] = b.dasharray.split(' ').map(Number)
    expect(aDash).toBeCloseTo(CIRCUMFERENCE / 2, 5)
    expect(bDash).toBeCloseTo(CIRCUMFERENCE / 2, 5)
  })

  it('each slice starts exactly where the previous one ended, so the ring has no gap or overlap', () => {
    const arcs = computeDonutArcs([
      { label: 'a', value: 1 },
      { label: 'b', value: 3 },
      { label: 'c', value: 4 },
    ])
    expect(arcs[0].offset).toBe(-0)
    expect(arcs[1].offset).toBeCloseTo(-(1 / 8) * CIRCUMFERENCE, 5)
    expect(arcs[2].offset).toBeCloseTo(-(4 / 8) * CIRCUMFERENCE, 5)
  })

  it('returns a zero-length arc for every segment, never throws, when the total is 0', () => {
    const arcs = computeDonutArcs([
      { label: 'a', value: 0 },
      { label: 'b', value: 0 },
    ])
    for (const arc of arcs) {
      const [dash] = arc.dasharray.split(' ').map(Number)
      expect(dash).toBe(0)
    }
  })
})
