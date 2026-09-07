import type { LucideIcon } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: string
  helperText?: string
  icon: LucideIcon
  tone?: 'default' | 'success' | 'warning' | 'destructive'
}

const toneStyles: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'bg-primary/10 text-primary',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/20 text-warning-foreground',
  destructive: 'bg-destructive/10 text-destructive',
}

export function StatCard({ label, value, helperText, icon: Icon, tone = 'default' }: StatCardProps) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 pt-5">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</p>
          {helperText && <p className="mt-1 text-xs text-muted-foreground">{helperText}</p>}
        </div>
        <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', toneStyles[tone])}>
          <Icon className="size-5" />
        </div>
      </CardContent>
    </Card>
  )
}
