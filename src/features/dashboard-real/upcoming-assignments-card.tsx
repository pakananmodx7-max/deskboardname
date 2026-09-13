import { Link } from 'react-router-dom'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/dashboard/empty-state'
import { buildAssignmentDetailPath } from '@/features/subjects-shared/subject-classroom-nav'
import type { AssignmentActionItem } from '@/services/dashboard-service'

interface UpcomingAssignmentsCardProps {
  loading: boolean
  error: string | null
  items: AssignmentActionItem[]
}

function formatUpcomingDate(dueDate: string): string {
  return new Date(dueDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
}

/**
 * "งานที่ใกล้ครบกำหนด" — a compact upcoming list with each item's real
 * submitted/total counts, derived entirely from assignment due dates and
 * submissions already loaded for the action center — no new calendar
 * table/query. Clicking a row opens that exact assignment.
 */
export function UpcomingAssignmentsCard({ loading, error, items }: UpcomingAssignmentsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">งานที่ใกล้ครบกำหนด</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <p className="px-5 py-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
        ) : error ? (
          <p className="px-5 py-6 text-center text-sm text-destructive">{error}</p>
        ) : items.length === 0 ? (
          <EmptyState message="ไม่มีงานที่ใกล้ครบกำหนด" />
        ) : (
          <div className="divide-y divide-border">
            {items.map((item) => (
              <Link
                key={item.assignmentId}
                to={buildAssignmentDetailPath(item.subjectId, item.classroomId, item.assignmentId)}
                className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-accent"
              >
                <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">
                  {formatUpcomingDate(item.dueDate!)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.subjectName} · {item.classroomName}
                  </p>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  ส่งแล้ว {item.submittedCount}/{item.totalCount}
                </span>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
