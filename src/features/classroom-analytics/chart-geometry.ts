import type { WeeklyAttendancePoint } from './analytics'

/** Weekly attendance line chart geometry. The chart is drawn at the
 * card's real pixel width (`width`), so text never shrinks with the card. */
export const WEEKLY_CHART = { width: 640, height: 240, padLeft: 44, padRight: 36, padTop: 28, padBottom: 34 } as const

export interface WeeklyChartPoint {
  point: WeeklyAttendancePoint
  x: number
  /** null for a week without records (the line breaks there). */
  y: number | null
}

export function weeklyChartX(index: number, count: number, width: number = WEEKLY_CHART.width): number {
  const { padLeft, padRight } = WEEKLY_CHART
  if (count <= 1) return padLeft + (width - padLeft - padRight) / 2
  return padLeft + (index / (count - 1)) * (width - padLeft - padRight)
}

export function weeklyChartY(rate: number): number {
  const { height, padTop, padBottom } = WEEKLY_CHART
  const clamped = Math.max(0, Math.min(100, rate))
  return padTop + (1 - clamped / 100) * (height - padTop - padBottom)
}

export function layoutWeeklyChart(points: WeeklyAttendancePoint[], width: number = WEEKLY_CHART.width): WeeklyChartPoint[] {
  return points.map((point, i) => ({ point, x: weeklyChartX(i, points.length, width), y: point.rate === null ? null : weeklyChartY(point.rate) }))
}

/** One SVG path per unbroken run of recorded weeks — a week without
 * records is a gap, never a dip to 0%. */
export function weeklyLineSegments(laid: WeeklyChartPoint[]): string[] {
  const segments: string[] = []
  let current: string[] = []
  for (const p of laid) {
    if (p.y === null) {
      if (current.length > 0) segments.push(current.join(' '))
      current = []
      continue
    }
    current.push(`${current.length === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
  }
  if (current.length > 0) segments.push(current.join(' '))
  return segments
}

/** Closed area under each segment, down to the 0% baseline. */
export function weeklyAreaSegments(laid: WeeklyChartPoint[]): string[] {
  const baseline = weeklyChartY(0)
  const areas: string[] = []
  let run: WeeklyChartPoint[] = []
  const flush = () => {
    if (run.length > 0) {
      const first = run[0]
      const last = run[run.length - 1]
      areas.push(
        `M${first.x.toFixed(1)},${baseline} ` + run.map((p) => `L${p.x.toFixed(1)},${p.y!.toFixed(1)}`).join(' ') + ` L${last.x.toFixed(1)},${baseline} Z`,
      )
    }
    run = []
  }
  for (const p of laid) {
    if (p.y === null) flush()
    else run.push(p)
  }
  flush()
  return areas
}

/** Show as many x labels as fit (~72px each), thinning them evenly. */
export function weeklyLabelStep(count: number, width: number = WEEKLY_CHART.width): number {
  const fit = Math.max(1, Math.floor((width - WEEKLY_CHART.padLeft - WEEKLY_CHART.padRight) / 72))
  return count <= fit ? 1 : Math.ceil(count / fit)
}

/** Per-point value labels only when there is room for them. */
export function weeklyShowValues(count: number, width: number = WEEKLY_CHART.width): boolean {
  return count <= Math.floor((width - WEEKLY_CHART.padLeft - WEEKLY_CHART.padRight) / 40)
}

// --------------------------------------------------
// Donut
// --------------------------------------------------

export const DONUT_RADIUS = 40
export const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS

export interface DonutArcGeometry {
  dasharray: string
  offset: number
}

/** stroke-dasharray/offset per slice; slices sum to one full ring. */
export function donutArcs(values: number[]): DonutArcGeometry[] {
  const total = values.reduce((s, v) => s + v, 0)
  let cumulative = 0
  return values.map((value) => {
    const fraction = total > 0 ? value / total : 0
    const dash = fraction * DONUT_CIRCUMFERENCE
    const arc = { dasharray: `${dash} ${DONUT_CIRCUMFERENCE - dash}`, offset: -cumulative * DONUT_CIRCUMFERENCE }
    cumulative += fraction
    return arc
  })
}
