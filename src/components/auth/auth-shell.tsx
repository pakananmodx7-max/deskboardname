import { GraduationCap } from 'lucide-react'
import type { ReactNode } from 'react'

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
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <GraduationCap className="size-5" />
          </div>
          <div className="leading-tight">
            <h1 className="text-lg font-bold tracking-tight">KrunameClass</h1>
            <p className="text-xs text-muted-foreground">ระบบจัดการห้องเรียน</p>
          </div>
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
