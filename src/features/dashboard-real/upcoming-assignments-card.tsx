import { Link } from 'react-router-dom'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
 * Section 6 — a compact upcoming list ("10 Sep — Project 2 due"),
 * derived entirely from assignment due dates already loaded for the
 * action center (Section 4) — no new calendar table/query. Clicking a
 * date opens that exact assignment.
 */
export function UpcomingAssignmentsCard({ loading, error, items }: UpcomingAssignmentsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">กำหนดส่งที่จะถึง</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <p className="px-5 py-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
        ) : error ? (
          <p className="px-5 py-6 text-center text-sm text-destructive">{error}</p>
        ) : items.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-muted-foreground">ไม่มีกำหนดส่งในช่วง 30 วันข้างหน้า</p>
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
                <div className="min-w-0">
                  <p className="truncate text-sm">{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.subjectName} · {item.classroomName}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
