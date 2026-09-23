export interface RadarAxis {
  label: string
  /** 0-100, already normalized — null means no data exists for this
   * dimension yet (e.g. no assignments). Never fabricated as 0: a null
   * axis is drawn collapsed to the center AND its label is suffixed with
   * "(ไม่มีข้อมูล)" so a collapsed vertex can never be misread as a real,
   * measured score of 0 — see computeRadarAxisLabel. */
  studentValue: number | null
  classroomAverage: number | null
}

interface RadarChartProps {
  axes: RadarAxis[]
  studentLabel: string
  classroomLabel: string
}

const SIZE = 220
const CENTER = SIZE / 2
const MAX_RADIUS = 85
const RING_COUNT = 4

/** Pure — angle (radians, 0 = straight up, clockwise) for axis `index`
 * of `total` evenly-spaced axes. */
export function radarAxisAngle(index: number, total: number): number {
  return (index / total) * 2 * Math.PI - Math.PI / 2
}

/** Pure — SVG point for one value (0-100, clamped) on one axis. A null
 * value collapses to the exact center (radius 0) rather than being
 * omitted, so the polygon path always has one vertex per axis. */
export function radarPoint(value: number | null, index: number, total: number): { x: number; y: number } {
  const clamped = value === null ? 0 : Math.max(0, Math.min(100, value))
  const angle = radarAxisAngle(index, total)
  const radius = (clamped / 100) * MAX_RADIUS
  return { x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) }
}

/** Pure — the SVG `points` attribute for a closed polygon over every
 * axis's value, in order. */
export function radarPolygonPoints(values: (number | null)[]): string {
  return values.map((v, i) => radarPoint(v, i, values.length)).map((p) => `${p.x},${p.y}`).join(' ')
}

/** Pure — a null value's axis label is suffixed so the chart never lets
 * a collapsed (radius-0) vertex be mistaken for a genuine score of 0. */
export function computeRadarAxisLabel(axis: RadarAxis): string {
  return axis.studentValue === null ? `${axis.label} (ไม่มีข้อมูล)` : axis.label
}

/**
 * A plain, dependency-free SVG radar chart — chosen over adding a
 * charting library, matching this codebase's existing BarChart/DonutChart
 * precedent (src/components/dashboard/). Every axis value is also
 * available as real text via the accompanying comparison table (this
 * component never carries a number by geometry/color alone — see
 * student-radar-section.tsx, which always renders this chart next to a
 * text table of the exact same values).
 */
export function RadarChart({ axes, studentLabel, classroomLabel }: RadarChartProps) {
  const studentPoints = radarPolygonPoints(axes.map((a) => a.studentValue))
  const averagePoints = radarPolygonPoints(axes.map((a) => a.classroomAverage))

  return (
    <div className="flex flex-col items-center gap-3">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full max-w-[260px]">
        {Array.from({ length: RING_COUNT }, (_, ringIndex) => {
          const ringValue = ((ringIndex + 1) / RING_COUNT) * 100
          return (
            <polygon
              key={ringIndex}
              points={radarPolygonPoints(axes.map(() => ringValue))}
              fill="none"
              stroke="var(--color-border)"
              strokeWidth={1}
            />
          )
        })}

        {axes.map((axis, i) => {
          const edge = radarPoint(100, i, axes.length)
          return (
            <line key={axis.label} x1={CENTER} y1={CENTER} x2={edge.x} y2={edge.y} stroke="var(--color-border)" strokeWidth={1} />
          )
        })}

        {axes.every((a) => a.classroomAverage !== null) && (
          <polygon points={averagePoints} fill="var(--color-muted-foreground)" fillOpacity={0.15} stroke="var(--color-muted-foreground)" strokeWidth={1.5} />
        )}

        <polygon points={studentPoints} fill="var(--color-primary)" fillOpacity={0.25} stroke="var(--color-primary)" strokeWidth={2} />

        {axes.map((axis, i) => {
          const labelPoint = radarPoint(118, i, axes.length)
          return (
            <text
              key={axis.label}
              x={labelPoint.x}
              y={labelPoint.y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-muted-foreground text-[9px]"
            >
              {computeRadarAxisLabel(axis)}
            </text>
          )
        })}
      </svg>

      <div className="flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-primary" />
          <span className="text-muted-foreground">{studentLabel}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-muted-foreground" />
          <span className="text-muted-foreground">{classroomLabel}</span>
        </span>
      </div>
    </div>
  )
}
