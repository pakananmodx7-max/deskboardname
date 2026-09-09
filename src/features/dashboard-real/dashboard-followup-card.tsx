import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { buildClassroomTabPath } from '@/features/subjects-shared/subject-classroom-nav'
import type { FollowUpRow } from '@/types/report'

interface DashboardFollowUpCardProps {
  loading: boolean
  error: string | null
  rows: FollowUpRow[]
}

/**
 * Section 5 — "นักเรียนที่ควรติดตาม". `rows` come from
 * dashboard-service.ts's getDashboardFollowUpSummary(), which calls the
 * exact same report-service.ts + followup-report-service.ts functions
 * the Reports page's Student Follow-up tab uses — see that function's
 * doc comment. [ดูนักเรียน] reuses the existing classroom Students tab
 * (ClassroomStudentsTab) via buildClassroomTabPath, never a new student
 * view built for the dashboard.
 */
export function DashboardFollowUpCard({ loading, error, rows }: DashboardFollowUpCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">นักเรียนที่ควรติดตาม</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <p className="px-5 py-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
        ) : error ? (
          <p className="px-5 py-6 text-center text-sm text-destructive">{error}</p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-muted-foreground">ไม่มีนักเรียนที่เข้าเกณฑ์ต้องติดตามในตอนนี้</p>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((row) => (
              <div key={`${row.studentId}:${row.classroomId}`} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {row.firstName} {row.lastName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{row.classroomName}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {row.reasons.map((reason) => (
                      <Badge key={reason.rule} variant="warning">
                        {reason.shortLabel}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button variant="outline" size="sm" asChild className="shrink-0">
                  <Link to={buildClassroomTabPath(row.classroomId, 'students')}>ดูนักเรียน</Link>
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
