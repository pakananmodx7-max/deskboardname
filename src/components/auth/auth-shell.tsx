import type { ReactNode } from 'react'

import { ClassNMark } from '@/components/brand/class-n-mark'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface AuthShellProps {
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  /** Optional decoration behind the content, pinned to the bottom of the
   * page (teacher and student login). Space is reserved below the content so the
   * form never sits on top of it. Omitted → the shell is unchanged. */
  background?: ReactNode
}

/** Shared centered-card shell for /login, /signup, /forgot-password, /reset-password. */
export function AuthShell({ title, description, children, footer, background }: AuthShellProps) {
  return (
    <div
      className={cn(
        'flex min-h-screen items-center justify-center bg-background p-4',
        background &&
          'relative isolate overflow-x-clip pb-[clamp(112px,24vh,272px)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1rem,env(safe-area-inset-top))] supports-[height:1svh]:min-h-[100svh] supports-[height:1svh]:pb-[clamp(112px,24svh,272px)]',
      )}
    >
      {background}
      <div className="w-full max-w-sm space-y-6">
        {/* The brand: the interactive "Class N" mark (its accessible name
            is "Class N"), announced as the page heading. Taller than the
            text with a negative top margin, so the letter labels above the
            selection frame are not cut off. */}
        <div role="heading" aria-level={1} className="mx-auto -mt-4 h-32 w-full max-w-[18rem] text-[var(--class-n-ink)]">
          <ClassNMark />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-4">{children}</CardContent>
        </Card>

        {footer && <div className="text-center text-sm text-muted-foreground">{footer}</div>}
      </div>
    </div>
  )
}
