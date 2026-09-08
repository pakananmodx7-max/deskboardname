import { ChevronRight, Pencil, Users } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useDemoClassroom } from '@/demo/demo-context'
import { EditSubjectDialog } from '@/features/demo-subjects/edit-subject-dialog'
import {
  buildSubjectClassroomPath,
  resolveAutoRedirectClassroomId,
  summarizeSubjectClassrooms,
} from '@/features/subjects-shared/subject-classroom-nav'

/**
 * Demo mirror of subjects-real's root page — same UX: overview +
 * "choose which classroom" screen, auto-redirecting straight into the
 * workspace when there is only one linked classroom to choose from. See
 * subject-classroom-workspace-page-demo.tsx for the classroom-scoped
 * workspace this leads into.
 */
export function SubjectDetailPageDemo() {
  const { subjectId } = useParams<{ subjectId: string }>()
  const { subjects, classrooms } = useDemoClassroom()
  const navigate = useNavigate()
  const [editOpen, setEditOpen] = useState(false)

  const subject = subjects.find((s) => s.id === subjectId)

  if (!subject) {
    return <Navigate to="/teacher/subjects" replace />
  }

  const links = subject.classroomIds.map((classroomId) => {
    const classroom = classrooms.find((c) => c.id === classroomId)
    return {
      classroomId,
      classroomName: classroom?.name ?? '-',
      studentCount: classroom?.studentIds.length ?? 0,
    }
  })

  const autoRedirectClassroomId = resolveAutoRedirectClassroomId(links)
  if (autoRedirectClassroomId) {
    return <Navigate to={buildSubjectClassroomPath(subject.id, autoRedirectClassroomId)} replace />
  }

  const summary = summarizeSubjectClassrooms(links)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{subject.name}</h1>
            <Badge variant="outline">{subject.code}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {summary.totalClassrooms} ห้องเรียน · {summary.totalStudents} นักเรียน · ปีการศึกษา {subject.academicYear}{' '}
            ภาคเรียนที่ {subject.semester}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="size-4" />
          แก้ไขรายวิชา
        </Button>
      </div>

      {links.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm font-medium">รายวิชานี้ยังไม่ได้เชื่อมกับห้องเรียนใด</p>
            <Button type="button" onClick={() => setEditOpen(true)}>
              เชื่อมห้องเรียน
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {links.map((link) => (
            <Card
              key={link.classroomId}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => navigate(buildSubjectClassroomPath(subject.id, link.classroomId))}
            >
              <CardContent className="flex items-center justify-between pt-5">
                <div>
                  <p className="text-base font-semibold">{link.classroomName}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Users className="size-3.5" />
                    {link.studentCount} คน
                  </p>
                </div>
                <span className="flex items-center gap-1 text-sm font-medium text-primary">
                  เปิดห้อง
                  <ChevronRight className="size-4" />
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <EditSubjectDialog open={editOpen} onOpenChange={setEditOpen} subject={subject} />
    </div>
  )
}
