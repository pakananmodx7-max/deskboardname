import { BookOpen, Plus, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CreateSubjectDialog } from '@/features/subjects-real/create-subject-dialog'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { getSubjectClassrooms, getSubjectStudents, getSubjects } from '@/services/subject-service'
import type { Subject } from '@/types/subject'

interface SubjectSummary {
  subject: Subject
  classroomNames: string
  studentCount: number
}

export function SubjectsPageReal() {
  const [summaries, setSummaries] = useState<SubjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const navigate = useNavigate()

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    return getSubjects()
      .then(async (subjects) => {
        const rows = await Promise.all(
          subjects.map(async (subject) => {
            const [links, students] = await Promise.all([
              getSubjectClassrooms(subject.id),
              getSubjectStudents(subject.id),
            ])
            return {
              subject,
              classroomNames: links.map((l) => l.classroomName).filter(Boolean).join(', '),
              studentCount: students.length,
            }
          }),
        )
        setSummaries(rows)
      })
      .catch((err: unknown) => setError(toFriendlyErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">รายวิชา</h1>
          <p className="mt-1 text-sm text-muted-foreground">{loading ? 'กำลังโหลด...' : `${summaries.length} รายวิชา`}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          สร้างรายวิชา
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && summaries.length === 0 ? (
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
          {summaries.map(({ subject, classroomNames, studentCount }) => (
            <Card
              key={subject.id}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => navigate(`/teacher/subjects/${subject.id}`)}
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{subject.name}</CardTitle>
                  {subject.subjectCode && <Badge variant="outline">{subject.subjectCode}</Badge>}
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>{classroomNames || '-'}</p>
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1.5">
                    <Users className="size-3.5" />
                    {studentCount} students
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreateSubjectDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => refresh()} />
    </div>
  )
}
