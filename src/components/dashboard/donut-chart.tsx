import { cn } from '@/lib/utils'

export interface DonutSegment {
  label: string
  value: number
  /** Tailwind stroke/background color pair for this segment — e.g.
   * `{ stroke: 'stroke-success', dot: 'bg-success' }`. */
  stroke: string
  dot: string
}

interface DonutChartProps {
  segments: DonutSegment[]
  centerLabel: string
}

const RADIUS = 40
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export interface DonutArc {
  label: string
  /** SVG strokeDasharray "dash gap" string for this segment's slice. */
  dasharray: string
  /** SVG strokeDashoffset — where this slice starts around the ring. */
  offset: number
}

/** Pure — turns segment values into SVG stroke-dasharray/offset pairs,
 * each slice picking up where the previous one ended (`cumulative`), so
 * the ring always sums to exactly one full circle with no gaps or
 * overlaps. A value of 0 still produces a (zero-length) arc rather than
 * being skipped, keeping the returned array's order/length matched to
 * `segments` for any caller that wants to zip them back together. */
export function computeDonutArcs(segments: { label: string; value: number }[]): DonutArc[] {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  let cumulative = 0
  return segments.map((s) => {
    const fraction = total > 0 ? s.value / total : 0
    const dash = fraction * CIRCUMFERENCE
    const gap = CIRCUMFERENCE - dash
    const offset = -cumulative * CIRCUMFERENCE
    cumulative += fraction
    return { label: s.label, dasharray: `${dash} ${gap}`, offset }
  })
}

/**
 * A plain, dependency-free donut chart (SVG stroke-dasharray rings) with
 * a real, always-visible legend listing every label and its number as
 * text — the numbers are never carried by color/arc-length alone. Chosen
 * over a charting library for one small summary chart (see the
 * dashboard redesign's "avoid unnecessary dependency bloat" constraint).
 */
export function DonutChart({ segments, centerLabel }: DonutChartProps) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  const arcs = computeDonutArcs(segments)

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row">
      <div className="relative flex size-32 shrink-0 items-center justify-center">
        <svg viewBox="0 0 100 100" className="size-32 -rotate-90">
          <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="var(--color-muted)" strokeWidth="14" />
          {total > 0 &&
            segments.map((s, i) => {
              if (s.value === 0) return null
              const arc = arcs[i]
              return (
                <circle
                  key={s.label}
                  cx="50"
                  cy="50"
                  r={RADIUS}
                  fill="none"
                  strokeWidth="14"
                  strokeDasharray={arc.dasharray}
                  strokeDashoffset={arc.offset}
                  className={s.stroke}
                >
                  <title>
                    {s.label}: {s.value}
                  </title>
                </circle>
              )
            })}
        </svg>
        <div className="absolute flex flex-col items-center">
          <span className="text-xl font-semibold tracking-tight tabular-nums">{total}</span>
          <span className="text-[11px] text-muted-foreground">{centerLabel}</span>
        </div>
      </div>

      <ul className="w-full space-y-2 text-sm">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className={cn('size-2.5 shrink-0 rounded-full', s.dot)} />
            <span className="truncate text-muted-foreground">{s.label}</span>
            <span className="ml-auto shrink-0 font-medium tabular-nums">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
