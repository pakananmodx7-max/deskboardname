import { Plus, School, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Disclosure } from '@/components/ui/disclosure'
import { CreateClassroomDialog } from '@/features/classroom-management/create-classroom-dialog'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { getClassrooms } from '@/services/classroom-service'
import { getStudentsByClassroom } from '@/services/student-service'
import { getClassroomSubjects } from '@/services/subject-service'
import type { Classroom } from '@/types/classroom'

interface ClassroomSummary {
  classroom: Classroom
  studentCount: number
  subjectNames: string[]
}

/**
 * subjectNames closes the classroom↔subject cross-reference gap (see the
 * matching chip row on the Subjects list, subjects-page-real.tsx) —
 * answering "what does this classroom study" without leaving this page.
 */
function ClassroomCard({ classroom, studentCount, subjectNames, onOpen }: ClassroomSummary & { onOpen: () => void }) {
  return (
    <Card className="cursor-pointer transition-shadow hover:shadow-md" onClick={onOpen}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{classroom.name}</CardTitle>
          {!classroom.isActive && <Badge variant="outline">เก็บถาวร</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>
          {[classroom.gradeLevel, classroom.academicYear && `ปีการศึกษา ${classroom.academicYear}`]
            .filter(Boolean)
            .join(' · ') || '-'}
        </p>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <Users className="size-3.5" />
            {studentCount} คน
          </span>
        </div>
        {subjectNames.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {subjectNames.map((name) => (
              <Badge key={name} variant="secondary">
                {name}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function ClassroomsPageReal() {
  const [summaries, setSummaries] = useState<ClassroomSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const navigate = useNavigate()

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    return getClassrooms()
      .then(async (classrooms) => {
        const rows = await Promise.all(
          classrooms.map(async (classroom) => {
            const [students, subjects] = await Promise.all([
              getStudentsByClassroom(classroom.id),
              getClassroomSubjects(classroom.id),
            ])
            return {
              classroom,
              studentCount: students.length,
              subjectNames: subjects.map((s) => s.name),
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

  function handleCreated(classroom: Classroom) {
    setSummaries((prev) => [...prev, { classroom, studentCount: 0, subjectNames: [] }])
  }

  const activeSummaries = summaries.filter((s) => s.classroom.isActive)
  const archivedSummaries = summaries.filter((s) => !s.classroom.isActive)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">ห้องเรียน</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading ? 'กำลังโหลด...' : `${activeSummaries.length} ห้องเรียน`}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          สร้างห้องเรียน
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && summaries.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <School className="size-6" />
            </div>
            <p className="text-sm font-medium">ยังไม่มีห้องเรียน</p>
            <Button onClick={() => setCreateOpen(true)}>สร้างห้องเรียน</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {activeSummaries.length === 0 ? (
            <p className="text-sm text-muted-foreground">ไม่มีห้องเรียนที่ใช้งานอยู่</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {activeSummaries.map(({ classroom, studentCount, subjectNames }) => (
                <ClassroomCard
                  key={classroom.id}
                  classroom={classroom}
                  studentCount={studentCount}
                  subjectNames={subjectNames}
                  onOpen={() => navigate(`/teacher/classrooms/${classroom.id}`)}
                />
              ))}
            </div>
          )}

          {archivedSummaries.length > 0 && (
            <Disclosure summary={`เก็บถาวร (${archivedSummaries.length})`}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {archivedSummaries.map(({ classroom, studentCount, subjectNames }) => (
                  <ClassroomCard
                    key={classroom.id}
                    classroom={classroom}
                    studentCount={studentCount}
                    subjectNames={subjectNames}
                    onOpen={() => navigate(`/teacher/classrooms/${classroom.id}`)}
                  />
                ))}
              </div>
            </Disclosure>
          )}
        </>
      )}

      <CreateClassroomDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={handleCreated} />
    </div>
  )
}
