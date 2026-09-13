import { ChevronRight } from 'lucide-react'
import type * as React from 'react'

import { cn } from '@/lib/utils'

interface DisclosureProps extends React.ComponentProps<'details'> {
  summary: React.ReactNode
}

/** Plain native <details>/<summary> — no JS state, no new dependency.
 * Used to tuck archived classrooms/subjects out of the everyday list
 * without hiding them entirely (see classrooms-page-real.tsx,
 * subjects-page-real.tsx). */
export function Disclosure({ summary, className, children, ...props }: DisclosureProps) {
  return (
    <details className={cn('group', className)} {...props}>
      <summary className="flex cursor-pointer select-none items-center gap-1.5 text-sm font-medium text-muted-foreground marker:content-[''] hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" />
        {summary}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  )
}
