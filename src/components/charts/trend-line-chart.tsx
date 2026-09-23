export interface TrendLinePoint {
  label: string
  /** 0-100. Null means no classroom-average comparison point exists for
   * this position (e.g. only this student has been graded so far) —
   * never fabricated as 0. */
  studentValue: number
  classroomAverageValue: number | null
}

interface TrendLineChartProps {
  points: TrendLinePoint[]
  studentLabel: string
  classroomLabel: string
}

const WIDTH = 320
const HEIGHT = 140
const PAD_X = 12
const PAD_Y = 12

/** Pure — x position for point `index` of `total` evenly-spaced points.
 * A single point is placed at the left edge rather than dividing by zero. */
export function trendPointX(index: number, total: number): number {
  if (total <= 1) return PAD_X
  return PAD_X + (index / (total - 1)) * (WIDTH - PAD_X * 2)
}

/** Pure — y position for a 0-100 value (clamped), higher value = higher
 * on screen (smaller y). */
export function trendPointY(value: number): number {
  const clamped = Math.max(0, Math.min(100, value))
  return PAD_Y + (1 - clamped / 100) * (HEIGHT - PAD_Y * 2)
}

/** Pure — SVG polyline `points` for a full series, skipping null values
 * (the line breaks rather than dipping to a fabricated 0). Returns one
 * string per unbroken run of non-null values. */
export function trendLineSegments(values: (number | null)[]): string[] {
  const segments: string[] = []
  let current: string[] = []

  values.forEach((value, i) => {
    if (value === null) {
      if (current.length > 0) segments.push(current.join(' '))
      current = []
      return
    }
    current.push(`${trendPointX(i, values.length)},${trendPointY(value)}`)
  })
  if (current.length > 0) segments.push(current.join(' '))
  return segments
}

/**
 * A plain, dependency-free SVG line chart comparing this student's score
 * per graded assignment (chronological) against the classroom average on
 * the same assignments — same "no charting library" precedent as
 * BarChart/DonutChart/RadarChart. Every point's exact value is also
 * available as a native `<title>` tooltip and the assignment titles are
 * real text below the chart, never carried by geometry alone.
 */
export function TrendLineChart({ points, studentLabel, classroomLabel }: TrendLineChartProps) {
  if (points.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">ยังไม่มีคะแนนงานที่ให้คะแนนแล้วสำหรับแสดงแนวโน้ม</p>
  }

  const studentSegments = trendLineSegments(points.map((p) => p.studentValue))
  const averageSegments = trendLineSegments(points.map((p) => p.classroomAverageValue))

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full">
        {[0, 25, 50, 75, 100].map((gridValue) => (
          <line
            key={gridValue}
            x1={PAD_X}
            y1={trendPointY(gridValue)}
            x2={WIDTH - PAD_X}
            y2={trendPointY(gridValue)}
            stroke="var(--color-border)"
            strokeWidth={1}
          />
        ))}

        {averageSegments.map((segment, i) => (
          <polyline key={`avg-${i}`} points={segment} fill="none" stroke="var(--color-muted-foreground)" strokeWidth={1.5} strokeDasharray="4 3" />
        ))}
        {studentSegments.map((segment, i) => (
          <polyline key={`student-${i}`} points={segment} fill="none" stroke="var(--color-primary)" strokeWidth={2} />
        ))}

        {points.map((p, i) => (
          <circle key={p.label} cx={trendPointX(i, points.length)} cy={trendPointY(p.studentValue)} r={2.5} fill="var(--color-primary)">
            <title>
              {p.label}: {p.studentValue.toFixed(0)}%
            </title>
          </circle>
        ))}
      </svg>

      <div className="flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-primary" />
          <span className="text-muted-foreground">{studentLabel}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full border-t border-dashed border-muted-foreground" />
          <span className="text-muted-foreground">{classroomLabel}</span>
        </span>
      </div>
    </div>
  )
}
