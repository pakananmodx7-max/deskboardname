import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { WorklistItem } from '@/features/dashboard-shared/worklist'

interface WorklistCardProps {
  title: string
  loading: boolean
  error: string | null
  items: WorklistItem[]
  emptyMessage: string
}

/**
 * One merged list of "things needing a decision" — replaces the 3
 * separate cards (TodayAttendanceCard, AssignmentActionCard,
 * DashboardFollowUpCard) previously stacked on Classroom Management's
 * ภาพรวม, and is reused as-is on Home (every classroom) and each
 * classroom's own ภาพรวม tab (one classroom, via the items already
 * scoped by the caller — see worklist.ts). Each row's icon distinguishes
 * what kind of task it is; the single button always deep-links to the
 * exact real screen the old, separate cards already linked to — nothing
 * about where a click lands changed, only that the lists are now one.
 */
export function WorklistCard({ title, loading, error, items, emptyMessage }: WorklistCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <p className="px-5 py-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
        ) : error ? (
          <p className="px-5 py-6 text-center text-sm text-destructive">{error}</p>
        ) : items.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <div className="divide-y divide-border">
            {items.map((item) => (
              <div key={item.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-warning/20 text-warning-foreground">
                  <item.icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge variant="warning">{item.badgeLabel}</Badge>
                    <span className="truncate text-xs text-muted-foreground">{item.meta}</span>
                  </div>
                </div>
                <Button variant="outline" size="sm" asChild className="shrink-0">
                  <Link to={item.actionTo}>{item.actionLabel}</Link>
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
