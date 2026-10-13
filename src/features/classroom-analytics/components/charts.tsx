import { useEffect, useId, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

import { formatThaiShortDate, type WeeklyAttendancePoint } from '../analytics'
import { donutArcs, layoutWeeklyChart, WEEKLY_CHART, weeklyAreaSegments, weeklyChartY, weeklyLabelStep, weeklyLineSegments, weeklyShowValues } from '../chart-geometry'
import { formatCount, formatPercent } from '../resource'

export interface DonutSlice {
  key: string
  label: string
  value: number
  /** Tailwind stroke class for the ring and bg class for the legend dot. */
  stroke: string
  dot: string
}

/**
 * Donut with a legend that always states each slice's count and share as
 * text (never color alone). `total` is the denominator shown in the
 * center, labelled by `unitLabel`.
 */
export function AnalyticsDonut({
  slices,
  centerValue,
  centerLabel,
  centerHint,
  unit,
}: {
  slices: DonutSlice[]
  centerValue: string
  centerLabel: string
  centerHint?: string
  unit: string
}) {
  const total = slices.reduce((s, x) => s + x.value, 0)
  const arcs = donutArcs(slices.map((s) => s.value))
  return (
    <div className="@container">
      <div className="flex flex-col items-center gap-5 @[24rem]:flex-row">
      <div className="relative size-40 shrink-0">
        <svg viewBox="0 0 100 100" className="size-40 -rotate-90" aria-hidden="true">
          <circle cx="50" cy="50" r="40" fill="none" strokeWidth="13" className="stroke-muted" />
          {total > 0 &&
            slices.map((slice, i) =>
              slice.value > 0 ? (
                <circle
                  key={slice.key}
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  strokeWidth="13"
                  strokeDasharray={arcs[i].dasharray}
                  strokeDashoffset={arcs[i].offset}
                  className={slice.stroke}
                />
              ) : null,
            )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-2xl font-bold tabular-nums text-foreground">{centerValue}</span>
          <span className="text-xs text-muted-foreground">{centerLabel}</span>
          {centerHint && <span className="mt-0.5 max-w-24 text-[10px] leading-tight text-muted-foreground">{centerHint}</span>}
        </div>
      </div>
      <ul className="w-full min-w-0 max-w-md flex-1 space-y-1.5 text-sm">
        {slices.map((slice) => (
          <li key={slice.key} className="flex items-center gap-2.5 rounded-xl bg-muted/45 px-3 py-2">
            <span className={cn('size-3 shrink-0 rounded-full ring-2 ring-card', slice.dot)} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-foreground">{slice.label}</span>
            <span className="shrink-0 font-semibold tabular-nums text-foreground">
              {formatCount(slice.value)} {unit}
            </span>
            <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">{formatPercent(total > 0 ? (slice.value / total) * 100 : null)}</span>
          </li>
        ))}
      </ul>
      </div>
    </div>
  )
}

function weekRange(point: WeeklyAttendancePoint): string {
  return `${formatThaiShortDate(point.weekStart)} – ${formatThaiShortDate(point.weekEnd)}`
}

/**
 * Weekly attendance-rate line chart. Each recorded week is a focusable
 * point with a tooltip (rate, present/recorded, dates); weeks without
 * records are gaps. The same data is available as a visually-hidden
 * table for screen readers.
 */
export function WeeklyAttendanceChart({ points }: { points: WeeklyAttendancePoint[] }) {
  const [active, setActive] = useState<number | null>(null)
  const gradientId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number>(WEEKLY_CHART.width)
  useEffect(() => {
    const element = containerRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0)
      if (next > 0) setWidth(Math.max(260, next))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const laid = layoutWeeklyChart(points, width)
  const step = weeklyLabelStep(points.length, width)
  const showValues = weeklyShowValues(points.length, width)
  const activePoint = active !== null ? laid[active] : null
  const { height, padLeft, padRight } = WEEKLY_CHART

  return (
    <div className="relative" ref={containerRef}>
       <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block max-w-full" role="img" aria-label="กราฟอัตรามาเรียนรายสัปดาห์" onMouseLeave={() => setActive(null)}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 20, 40, 60, 80, 100].map((v) => (
          <g key={v}>
            <line x1={padLeft} x2={width - padRight} y1={weeklyChartY(v)} y2={weeklyChartY(v)} className="stroke-border" strokeWidth={1} strokeDasharray={v === 0 ? undefined : '4 5'} />
            <text x={padLeft - 8} y={weeklyChartY(v) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
              {v}%
            </text>
          </g>
        ))}
        {weeklyAreaSegments(laid).map((d, i) => (
          <path key={`area-${i}`} d={d} fill={`url(#${gradientId})`} />
        ))}
        {weeklyLineSegments(laid).map((d, i) => (
          <path key={`line-${i}`} d={d} fill="none" className="stroke-primary" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {laid.map((p, i) => (
          <g key={p.point.weekStart}>
            {i % step === 0 && (
              <text x={p.x} y={height - 10} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                สัปดาห์ที่ {p.point.index}
              </text>
            )}
            {p.y !== null && (
              <>
                {showValues && (
                  <text x={p.x} y={p.y - 10} textAnchor="middle" className="fill-foreground text-[11px] font-semibold">
                    {formatPercent(p.point.rate)}
                  </text>
                )}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={active === i ? 7 : 5}
                  className="cursor-pointer fill-primary stroke-card outline-none focus-visible:stroke-foreground"
                  strokeWidth={2.5}
                  tabIndex={0}
                  role="button"
                  aria-label={`สัปดาห์ที่ ${p.point.index} (${weekRange(p.point)}) มาเรียน ${formatPercent(p.point.rate, 1)} — มา ${p.point.present} จาก ${p.point.total} รายการ`}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                />
              </>
            )}
          </g>
        ))}
      </svg>
      {activePoint && activePoint.y !== null && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 w-max max-w-[220px] -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-soft"
          style={{ left: `${(activePoint.x / width) * 100}%`, top: `${((activePoint.y - 12) / height) * 100}%` }}
        >
          <p className="font-semibold">สัปดาห์ที่ {activePoint.point.index}</p>
          <p className="text-muted-foreground">{weekRange(activePoint.point)}</p>
          <p className="mt-1">
            มาเรียน <span className="font-semibold">{formatPercent(activePoint.point.rate, 1)}</span>
          </p>
          <p className="text-muted-foreground">
            มา {formatCount(activePoint.point.present)} จาก {formatCount(activePoint.point.total)} รายการ
          </p>
        </div>
      )}
      {/* .sr-only on a <table> itself does not shrink it (tables ignore the
          1px width) and caused horizontal scroll on phones — clip a wrapper. */}
      <div className="sr-only">
        <table>
          <caption>อัตรามาเรียนรายสัปดาห์</caption>
          <thead>
            <tr>
              <th>สัปดาห์</th>
              <th>ช่วงวันที่</th>
              <th>อัตรามาเรียน</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.weekStart}>
                <td>{p.index}</td>
                <td>{weekRange(p)}</td>
                <td>{p.rate === null ? 'ไม่มีการเช็คชื่อ' : `${formatPercent(p.rate, 1)} (มา ${p.present}/${p.total})`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
