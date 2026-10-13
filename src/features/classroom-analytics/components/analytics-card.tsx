import { AlertCircle, RotateCw } from 'lucide-react'
import type * as React from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { ICON_TONE, type IconTone, type Resource } from '../resource'

interface AnalyticsCardProps {
  title: string
  icon: React.ComponentType<{ className?: string }>
  tone?: IconTone
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}

export function AnalyticsCard({ title, icon: Icon, tone = 'blue', action, className, children }: AnalyticsCardProps) {
  return (
    <section className={cn('flex flex-col rounded-3xl border border-border/80 bg-card p-4 text-card-foreground shadow-soft sm:p-6', className)} aria-label={title}>
      <header className="mb-5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-full', ICON_TONE[tone])}>
            <Icon className="size-5" />
          </span>
          <h2 className="truncate text-base font-bold text-foreground">{title}</h2>
        </div>
        {action}
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
    </section>
  )
}

/** Renders loading / error+retry for a resource, or its content. */
export function SectionBody<T>({
  resource,
  onRetry,
  skeleton = 'block',
  children,
}: {
  resource: Resource<T>
  onRetry?: () => void
  skeleton?: 'block' | 'list' | 'chart'
  children: (data: T) => React.ReactNode
}) {
  if (resource.status === 'loading') return <SectionSkeleton variant={skeleton} />
  if (resource.status === 'error') return <SectionError message={resource.error} onRetry={onRetry} />
  return <>{children(resource.data)}</>
}

export function SectionSkeleton({ variant = 'block' }: { variant?: 'block' | 'list' | 'chart' }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-1 flex-col gap-3" data-testid="section-loading">
      <span className="sr-only">กำลังโหลดข้อมูล...</span>
      {variant === 'list' ? (
        Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 animate-pulse rounded-lg bg-muted" />)
      ) : variant === 'chart' ? (
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      ) : (
        <>
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        </>
      )}
    </div>
  )
}

export function SectionError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-center">
      <AlertCircle className="size-5 text-destructive" />
      <p className="text-sm text-foreground">{message}</p>
      {onRetry && (
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          <RotateCw className="size-3.5" />
          ลองใหม่
        </Button>
      )}
    </div>
  )
}

export function SectionEmpty({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-xl bg-muted/50 p-6 text-center">
      <p className="text-sm font-medium text-foreground">{message}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** Empty state with lightweight artwork, used where a panel would
 * otherwise be a large blank area. `action` is an optional next step. */
export function SectionIllustratedEmpty({ art, message, hint, action }: { art: React.ReactNode; message: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="@container flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-2xl bg-[color-mix(in_oklab,var(--tone-blue)_7%,var(--card))] p-5 text-center @md:flex-row @md:gap-6 @md:text-left">
        {art}
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm font-semibold text-foreground sm:text-base">{message}</p>
          {hint && <p className="text-xs text-muted-foreground sm:text-sm">{hint}</p>}
          {action && <div className="pt-2">{action}</div>}
        </div>
      </div>
    </div>
  )
}
