import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: LucideIcon
  message: string
  className?: string
}

/** One honest "nothing here yet" message, reused everywhere a real data
 * source is empty (never a zero-filled chart or an invented row) — see
 * the dashboard redesign's "do not fabricate information" constraint. */
export function EmptyState({ icon: Icon, message, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-5 py-10 text-center', className)}>
      {Icon && <Icon className="size-6 text-muted-foreground" />}
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}
