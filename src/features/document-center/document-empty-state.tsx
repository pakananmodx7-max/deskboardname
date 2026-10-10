import type { LucideIcon } from 'lucide-react'
import type * as React from 'react'

import { cn } from '@/lib/utils'

export interface DocumentEmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
  /** Compact variant for small panels. */
  compact?: boolean
}

/** One empty / unavailable state used by every section of the page. */
export function DocumentEmptyState({ icon: Icon, title, description, action, className, compact = false }: DocumentEmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 text-center', compact ? 'px-4 py-6' : 'px-6 py-12', className)} data-testid="document-empty-state">
      <span className={cn('flex items-center justify-center rounded-full bg-muted text-muted-foreground', compact ? 'size-10' : 'size-12')}>
        <Icon className={compact ? 'size-5' : 'size-6'} aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && <p className="max-w-md text-xs leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
