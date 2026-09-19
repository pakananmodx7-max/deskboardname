import type * as React from 'react'

import { cn } from '@/lib/utils'

function NativeSelect({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'flex h-9 items-center rounded-xl border border-input bg-background px-3.5 py-1 text-sm shadow-sm outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export { NativeSelect }
