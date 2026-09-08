import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { useDemoClassroom } from '@/demo/demo-context'
import { computeAssignmentSummary } from '@/demo/subject-selectors'
import { SUBJECT_ASSIGNMENT_TYPE_LABEL, type DemoSubject } from '@/demo/types'
import { AssignmentDialog } from '@/features/demo-subjects/assignment-dialog'

interface AssignmentsTabProps {
  subject: DemoSubject
  /**
   * Accepted (not yet used to filter) so this tab already receives
   * exactly what it will need once assignments support classroom
   * scoping (see the future-design note in
   * subject-classroom-workspace-page-real.tsx) — an assignment card's
   * submitted/total count would then be computed against only the
   * selected classroom's students, the same way GradesTab already scopes
   * its displayed rows, instead of every assignment always summarizing
   * the whole subject roster as it does today.
   */
  classroomId: string
}

export function AssignmentsTab({ subject }: AssignmentsTabProps) {
  const { topics, subjectAssignments } = useDemoClassroom()
  const [createOpen, setCreateOpen] = useState(false)
  const navigate = useNavigate()

  const subjectTopics = topics.filter((t) => t.subjectId === subject.id)
  const assignments = subjectAssignments.filter((a) => a.subjectId === subject.id)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{assignments.length} งาน</p>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          เพิ่มงาน
        </Button>
      </div>

      {assignments.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">ยังไม่มีงานในรายวิชานี้</CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {assignments.map((assignment) => {
            const summary = computeAssignmentSummary(assignment)
            const percent = summary.total > 0 ? Math.round((summary.submitted / summary.total) * 100) : 0
            const topic = subjectTopics.find((t) => t.id === assignment.topicId)

            return (
              <Card
                key={assignment.id}
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => navigate(`/teacher/subjects/${subject.id}/assignments/${assignment.id}`)}
              >
                <CardContent className="space-y-3 pt-5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold">{assignment.title}</p>
                    <Badge variant="outline">{SUBJECT_ASSIGNMENT_TYPE_LABEL[assignment.type]}</Badge>
                  </div>
                  {topic && <p className="text-xs text-muted-foreground">Topic: {topic.title}</p>}
                  <Progress value={percent} />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {summary.submitted}/{summary.total} submitted
                    </span>
                    <span>Due {assignment.dueDate}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{assignment.maxScore} คะแนน</p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <AssignmentDialog open={createOpen} onOpenChange={setCreateOpen} subjectId={subject.id} topics={subjectTopics} />
    </div>
  )
}
