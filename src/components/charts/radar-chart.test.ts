import { describe, expect, it } from 'vitest'

import { computeRadarAxisLabel, radarAxisAngle, radarPoint, radarPolygonPoints } from '@/components/charts/radar-chart'

describe('radarAxisAngle', () => {
  it('the first of 4 axes points straight up (-90 degrees)', () => {
    expect(radarAxisAngle(0, 4)).toBeCloseTo(-Math.PI / 2, 10)
  })

  it('axes are evenly spaced around the full circle', () => {
    const total = 4
    const angles = Array.from({ length: total }, (_, i) => radarAxisAngle(i, total))
    for (let i = 1; i < angles.length; i++) {
      expect(angles[i] - angles[i - 1]).toBeCloseTo((2 * Math.PI) / total, 10)
    }
  })
})

describe('radarPoint', () => {
  it('a value of 0 collapses to the exact center', () => {
    const p = radarPoint(0, 0, 4)
    expect(p.x).toBeCloseTo(110, 5)
    expect(p.y).toBeCloseTo(110, 5)
  })

  it('a null value ALSO collapses to the exact center — never a fabricated non-zero radius', () => {
    const zero = radarPoint(0, 1, 4)
    const nullPoint = radarPoint(null, 1, 4)
    expect(nullPoint).toEqual(zero)
  })

  it('a value of 100 reaches the maximum radius', () => {
    const p = radarPoint(100, 0, 4)
    // straight up from center (110,110) by MAX_RADIUS (85)
    expect(p.x).toBeCloseTo(110, 5)
    expect(p.y).toBeCloseTo(110 - 85, 5)
  })

  it('clamps an out-of-range value rather than overshooting the chart', () => {
    const over = radarPoint(150, 0, 4)
    const at100 = radarPoint(100, 0, 4)
    expect(over).toEqual(at100)

    const under = radarPoint(-20, 0, 4)
    const at0 = radarPoint(0, 0, 4)
    expect(under).toEqual(at0)
  })
})

describe('radarPolygonPoints', () => {
  it('produces one "x,y" pair per axis value, in order', () => {
    const points = radarPolygonPoints([50, 100, 0, 25])
    expect(points.split(' ')).toHaveLength(4)
  })
})

describe('computeRadarAxisLabel', () => {
  it('leaves the label unchanged when the student has data', () => {
    expect(computeRadarAxisLabel({ label: 'ผลการเรียน', studentValue: 80, classroomAverage: 70 })).toBe('ผลการเรียน')
  })

  it('suffixes "(ไม่มีข้อมูล)" when the student has no data for this axis — never lets a collapsed vertex look like a real 0', () => {
    expect(computeRadarAxisLabel({ label: 'ผลการเรียน', studentValue: null, classroomAverage: null })).toBe('ผลการเรียน (ไม่มีข้อมูล)')
  })
})
