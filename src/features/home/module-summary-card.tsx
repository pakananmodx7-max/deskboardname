import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export interface ModuleStat {
  label: string
  value: string
}

interface ModuleSummaryCardProps {
  icon: LucideIcon
  title: string
  /** English subtitle, e.g. "Classroom Management System" — shown only
   * for modules that have one; a coming-soon placeholder has none. */
  subtitle?: string
  to: string
  /** Real counts pulled from an existing data source — NEVER a
   * hardcoded number (see home-page-real.tsx/home-page-demo.tsx, the
   * only two callers that pass this). */
  stats?: ModuleStat[]
  badge?: string
  description?: string
}

/** One module card on the Home command center. Purely presentational —
 * every number it renders is passed in by the caller, already computed
 * from real data (or omitted while loading), never invented here. */
export function ModuleSummaryCard({ icon: Icon, title, subtitle, to, stats, badge, description }: ModuleSummaryCardProps) {
  return (
    <Link to={to} className="block h-full">
      <Card className="h-full transition-shadow hover:shadow-md">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-base">{title}</CardTitle>
                {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
              </div>
            </div>
            {badge && (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {badge}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
          {stats && stats.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {stats.map((stat) => (
                <div key={stat.label}>
                  <p className="text-lg font-semibold tracking-tight">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}
