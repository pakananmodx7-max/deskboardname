import type { AttendanceBand } from './attendance-report-model'

export const PAGE_SIZES = [10, 20, 50, 100] as const

/** Band colors (green / yellow / red / grey) — mid-tone tints readable in
 * both themes (the theme switches via data-theme, not Tailwind dark:). */
export const BAND_STYLE: Record<AttendanceBand, { bar: string; badge: string }> = {
  excellent: { bar: 'bg-success', badge: 'bg-success/12 text-success' },
  good: { bar: 'bg-warning', badge: 'bg-warning/20 text-orange-600' },
  attention: { bar: 'bg-destructive', badge: 'bg-destructive/12 text-destructive' },
  no_data: { bar: 'bg-muted-foreground/40', badge: 'bg-muted text-muted-foreground' },
}
