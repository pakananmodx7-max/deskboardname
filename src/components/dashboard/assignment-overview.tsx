import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { AssignmentSummary } from '@/types/dashboard'

interface AssignmentOverviewProps {
  assignments: AssignmentSummary[]
}

export function AssignmentOverview({ assignments }: AssignmentOverviewProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">งานที่มอบหมายล่าสุด</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {assignments.map((assignment) => {
          const percent =
            assignment.totalCount > 0
              ? Math.round((assignment.submittedCount / assignment.totalCount) * 100)
              : 0
          return (
            <div key={assignment.id} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium">{assignment.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  Due {assignment.dueDate}
                </span>
              </div>
              <Progress value={percent} />
              <p className="text-xs text-muted-foreground">
                {assignment.submittedCount} / {assignment.totalCount} submitted
              </p>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
