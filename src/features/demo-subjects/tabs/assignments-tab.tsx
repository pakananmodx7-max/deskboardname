import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Progress } from '@/components/ui/progress'
import { RowActionsMenu } from '@/components/ui/row-actions-menu'
import { useToast } from '@/components/ui/toast'
import { useDemoClassroom } from '@/demo/demo-context'
import { computeAssignmentSummary, getAssignmentsForClassroom } from '@/demo/subject-selectors'
import { SUBJECT_ASSIGNMENT_TYPE_LABEL, type DemoSubject, type DemoSubjectAssignment } from '@/demo/types'
import { AssignmentDialog } from '@/features/demo-subjects/assignment-dialog'

interface AssignmentsTabProps {
  subject: DemoSubject
  classroomId: string
}

/** Scoped to exactly one of the subject's linked classrooms — never
 * merges assignments from the subject's other linked classrooms, even
 * ones with a matching title. Mirrors subjects-real's AssignmentsTab,
 * which is scoped the same way against real data. */
export function AssignmentsTab({ subject, classroomId }: AssignmentsTabProps) {
  const { toast } = useToast()
  const { topics, subjectAssignments, archiveSubjectAssignment } = useDemoClassroom()
  const [createOpen, setCreateOpen] = useState(false)
  const [editingAssignment, setEditingAssignment] = useState<DemoSubjectAssignment | null>(null)
  const [archivingAssignment, setArchivingAssignment] = useState<DemoSubjectAssignment | null>(null)
  const navigate = useNavigate()

  const subjectTopics = topics.filter((t) => t.subjectId === subject.id)
  const assignments = getAssignmentsForClassroom(subjectAssignments, subject.id, classroomId)

  function handleArchive() {
    if (!archivingAssignment) return
    archiveSubjectAssignment(archivingAssignment.id)
    toast(`เก็บถาวรงาน "${archivingAssignment.title}" แล้ว`)
    setArchivingAssignment(null)
  }

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
          <CardContent className="py-12 text-center text-sm text-muted-foreground">ยังไม่มีงานในห้องเรียนนี้</CardContent>
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
                onClick={() =>
                  navigate(`/teacher/subjects/${subject.id}/classrooms/${classroomId}/assignments/${assignment.id}`)
                }
              >
                <CardContent className="space-y-3 pt-5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold">{assignment.title}</p>
                    <div className="flex items-center gap-1">
                      <Badge variant="outline">{SUBJECT_ASSIGNMENT_TYPE_LABEL[assignment.type]}</Badge>
                      {assignment.isArchived && <Badge variant="outline">เก็บถาวร</Badge>}
                      <RowActionsMenu
                        actions={[
                          { key: 'edit', label: 'แก้ไขงาน', onSelect: () => setEditingAssignment(assignment) },
                          {
                            key: 'archive',
                            label: 'เก็บถาวร',
                            onSelect: () => setArchivingAssignment(assignment),
                            disabled: assignment.isArchived,
                          },
                        ]}
                      />
                    </div>
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

      <AssignmentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        subjectId={subject.id}
        classroomId={classroomId}
        topics={subjectTopics}
      />

      {editingAssignment && (
        <AssignmentDialog
          open={Boolean(editingAssignment)}
          onOpenChange={(open) => !open && setEditingAssignment(null)}
          subjectId={subject.id}
          classroomId={classroomId}
          topics={subjectTopics}
          assignment={editingAssignment}
        />
      )}

      {archivingAssignment && (
        <ConfirmDialog
          open={Boolean(archivingAssignment)}
          onOpenChange={(open) => !open && setArchivingAssignment(null)}
          title="เก็บถาวรงาน"
          description={`เก็บถาวร "${archivingAssignment.title}"?\nงานและคะแนนของนักเรียนจะยังคงอยู่ในระบบ`}
          confirmLabel="เก็บถาวร"
          onConfirm={handleArchive}
        />
      )}
    </div>
  )
}
