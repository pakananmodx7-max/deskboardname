export interface BarChartDatum {
  label: string
  value: number
}

interface BarChartProps {
  data: BarChartDatum[]
  /** Appended after each numeric value, e.g. "คน". */
  unit?: string
}

/** Pure — the bar-fill percentage for one value against the data set's
 * own max (never a fixed/assumed ceiling), floored at a max of 1 so an
 * all-zero data set never divides by zero. */
export function computeBarWidthPercent(value: number, max: number): number {
  return (value / Math.max(1, max)) * 100
}

/**
 * A plain, dependency-free horizontal bar chart — real text for every
 * label/value (never rendered as only pixels), a native `title` tooltip
 * per row, and a relative-width bar that reflows at any screen size
 * with no JS resize logic needed. Chosen over adding a charting library
 * for one bar chart with a handful of rows (see the dashboard
 * redesign's "avoid unnecessary dependency bloat" constraint).
 */
export function BarChart({ data, unit = '' }: BarChartProps) {
  const max = Math.max(1, ...data.map((d) => d.value))

  return (
    <div className="space-y-3">
      {data.map((d) => (
        <div key={d.label} title={`${d.label}: ${d.value}${unit}`}>
          <div className="mb-1 flex items-center justify-between gap-2 text-xs">
            <span className="truncate font-medium text-foreground">{d.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {d.value}
              {unit}
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${computeBarWidthPercent(d.value, max)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
