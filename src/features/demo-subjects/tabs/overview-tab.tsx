import { BookOpen, ClipboardList, GraduationCap, Users } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { useDemoClassroom } from '@/demo/demo-context'
import { computeSubjectAverageScore, getAssignmentsForClassroom, getStudentIdsForClassrooms } from '@/demo/subject-selectors'
import type { DemoSubject } from '@/demo/types'

interface OverviewTabProps {
  subject: DemoSubject
  classroomId: string
}

/** Student count and assignments/grades summaries are all scoped to the
 * workspace's selected classroom, matching that classroom's own
 * Students/Assignments tabs. Topics stay subject-wide and unfiltered —
 * topics are subject-level by design, shared identically across every
 * linked classroom (see docs/DATABASE.md). */
export function OverviewTab({ subject, classroomId }: OverviewTabProps) {
  const { classrooms, topics, subjectAssignments } = useDemoClassroom()

  const studentIds = getStudentIdsForClassrooms([classroomId], classrooms)
  const subjectTopics = topics.filter((t) => t.subjectId === subject.id).sort((a, b) => a.order - b.order)
  const assignments = getAssignmentsForClassroom(subjectAssignments, subject.id, classroomId)
  const averageScore = computeSubjectAverageScore(assignments)

  return (
    <div className="space-y-4">
      {subject.description && <p className="text-sm text-muted-foreground">{subject.description}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="flex items-center justify-between pt-5">
            <div>
              <p className="text-sm text-muted-foreground">นักเรียนทั้งหมด</p>
              <p className="mt-1.5 text-2xl font-semibold tracking-tight">{studentIds.length} คน</p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Users className="size-5" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between pt-5">
            <div>
              <p className="text-sm text-muted-foreground">หัวข้อ</p>
              <p className="mt-1.5 text-2xl font-semibold tracking-tight">{subjectTopics.length}</p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <BookOpen className="size-5" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between pt-5">
            <div>
              <p className="text-sm text-muted-foreground">งานทั้งหมด</p>
              <p className="mt-1.5 text-2xl font-semibold tracking-tight">{assignments.length}</p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-lg bg-warning/20 text-warning-foreground">
              <ClipboardList className="size-5" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between pt-5">
            <div>
              <p className="text-sm text-muted-foreground">คะแนนเฉลี่ยรวม</p>
              <p className="mt-1.5 text-2xl font-semibold tracking-tight">
                {averageScore !== null ? `${averageScore.toFixed(1)}%` : '-'}
              </p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-lg bg-success/15 text-success">
              <GraduationCap className="size-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-5">
          <p className="mb-3 text-sm font-semibold">หัวข้อล่าสุด</p>
          {subjectTopics.length === 0 ? (
            <p className="text-sm text-muted-foreground">ยังไม่มีหัวข้อในรายวิชานี้</p>
          ) : (
            <ol className="space-y-2">
              {subjectTopics.slice(0, 5).map((topic) => (
                <li key={topic.id} className="flex items-center justify-between text-sm">
                  <span>{topic.title}</span>
                  <span className="text-xs text-muted-foreground">{topic.taughtDate}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <p className="mb-3 text-sm font-semibold">งานล่าสุด</p>
          {assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">ยังไม่มีงานในรายวิชานี้</p>
          ) : (
            <ol className="space-y-2">
              {assignments.slice(0, 5).map((assignment) => (
                <li key={assignment.id} className="flex items-center justify-between text-sm">
                  <span>{assignment.title}</span>
                  <span className="text-xs text-muted-foreground">Due {assignment.dueDate}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
