import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { buildAssignmentDetailPath } from '@/features/subjects-shared/subject-classroom-nav'
import type { AssignmentActionItem } from '@/services/dashboard-service'

interface AssignmentActionCardProps {
  loading: boolean
  error: string | null
  items: AssignmentActionItem[]
}

function formatDueDate(dueDate: string | null): string {
  if (!dueDate) return 'ไม่มีกำหนดส่ง'
  return new Date(dueDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Section 4 — "งานที่ต้องจัดการ". [ดูงาน]/[ให้คะแนน] both deep-link to
 * the exact same real assignment detail page (buildAssignmentDetailPath)
 * — that page already contains both the submission checklist AND score
 * entry, so there is no separate "grade only" route to send the second
 * button to; two labeled buttons matching the spec's wording, one real
 * destination.
 */
export function AssignmentActionCard({ loading, error, items }: AssignmentActionCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">งานที่ต้องจัดการ</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <p className="px-5 py-6 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
        ) : error ? (
          <p className="px-5 py-6 text-center text-sm text-destructive">{error}</p>
        ) : items.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-muted-foreground">ไม่มีงานที่ต้องจัดการในตอนนี้</p>
        ) : (
          <div className="divide-y divide-border">
            {items.map((item) => (
              <div key={item.assignmentId} className="space-y-2 px-5 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.subjectName} · {item.classroomName} · กำหนดส่ง {formatDueDate(item.dueDate)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <Link to={buildAssignmentDetailPath(item.subjectId, item.classroomId, item.assignmentId)}>
                        ดูงาน
                      </Link>
                    </Button>
                    <Button size="sm" asChild>
                      <Link to={buildAssignmentDetailPath(item.subjectId, item.classroomId, item.assignmentId)}>
                        ให้คะแนน
                      </Link>
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline">
                    ส่งแล้ว {item.submittedCount}/{item.totalCount}
                  </Badge>
                  {item.missingCount > 0 && <Badge variant="warning">ค้าง {item.missingCount} คน</Badge>}
                  {item.ungradedCount > 0 && <Badge variant="secondary">ยังไม่ให้คะแนน {item.ungradedCount} คน</Badge>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
