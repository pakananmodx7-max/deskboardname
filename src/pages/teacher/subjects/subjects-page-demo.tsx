import { BookOpen, Plus, Users } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useDemoClassroom } from '@/demo/demo-context'
import { getStudentIdsForClassrooms } from '@/demo/subject-selectors'
import { CreateSubjectDialog } from '@/features/demo-subjects/create-subject-dialog'

export function SubjectsPageDemo() {
  const { subjects, classrooms, subjectAssignments } = useDemoClassroom()
  const [createOpen, setCreateOpen] = useState(false)
  const navigate = useNavigate()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">รายวิชา</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subjects.length} รายวิชา</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          สร้างรายวิชา
        </Button>
      </div>

      {subjects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <BookOpen className="size-6" />
            </div>
            <p className="text-sm font-medium">ยังไม่มีรายวิชา</p>
            <Button onClick={() => setCreateOpen(true)}>สร้างรายวิชา</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {subjects.map((subject) => {
            const studentCount = getStudentIdsForClassrooms(subject.classroomIds, classrooms).length
            const assignmentCount = subjectAssignments.filter((a) => a.subjectId === subject.id).length
            const classroomNames = subject.classroomIds
              .map((id) => classrooms.find((c) => c.id === id)?.name)
              .filter(Boolean)
              .join(', ')

            return (
              <Card
                key={subject.id}
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => navigate(`/teacher/subjects/${subject.id}`)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{subject.name}</CardTitle>
                    <Badge variant="outline">{subject.code}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p>{classroomNames}</p>
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1.5">
                      <Users className="size-3.5" />
                      {studentCount} students
                    </span>
                    <span className="flex items-center gap-1.5">
                      <BookOpen className="size-3.5" />
                      {assignmentCount} assignments
                    </span>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <CreateSubjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
