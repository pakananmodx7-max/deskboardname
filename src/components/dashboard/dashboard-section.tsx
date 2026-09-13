import type { ReactNode } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface DashboardSectionProps {
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}

/** One consistent card-with-heading shell, reused by every new dashboard
 * section (charts, ห้องเรียนของฉัน) so heading size/weight and card
 * chrome never drift between sections — see the design-system
 * standardization goal in the dashboard redesign. */
export function DashboardSection({ title, action, children, className, bodyClassName }: DashboardSectionProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{title}</CardTitle>
          {action}
        </div>
      </CardHeader>
      <CardContent className={bodyClassName}>{children}</CardContent>
    </Card>
  )
}
