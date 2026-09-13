import type { LucideIcon } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export interface StatStripItem {
  label: string
  value: string
  icon: LucideIcon
  tone?: 'default' | 'warning'
}

const toneStyles: Record<NonNullable<StatStripItem['tone']>, string> = {
  default: 'bg-primary/10 text-primary',
  warning: 'bg-warning/20 text-warning-foreground',
}

/** One compact row of stats in a single Card — replaces N separate
 * StatCards (see dashboard-page-real.tsx) so a summary of several
 * numbers doesn't cost several cards' worth of vertical space. */
export function StatStrip({ items }: { items: StatStripItem[] }) {
  return (
    <Card>
      <CardContent className="grid grid-cols-2 gap-4 pt-5 sm:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-3">
            <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', toneStyles[item.tone ?? 'default'])}>
              <item.icon className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold tracking-tight">{item.value}</p>
              <p className="truncate text-xs text-muted-foreground">{item.label}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
