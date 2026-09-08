import { ChevronRight, Pencil, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EditSubjectDialog } from '@/features/subjects-real/edit-subject-dialog'
import {
  buildSubjectClassroomPath,
  resolveAutoRedirectClassroomId,
  summarizeSubjectClassrooms,
} from '@/features/subjects-shared/subject-classroom-nav'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { getSubjectById, getSubjectClassroomsWithCounts } from '@/services/subject-service'
import type { Subject, SubjectClassroomWithCount } from '@/types/subject'

/**
 * Subject root page — overview + "choose which classroom" screen (see
 * subject-classroom-workspace-page-real.tsx for the classroom-scoped
 * workspace this leads into). A subject linked to exactly one classroom
 * has no real choice to make, so it redirects straight into that
 * classroom's workspace instead of showing a one-card picker; a subject
 * linked to several classrooms shows one card per classroom with its own
 * student count, matching each classroom's own Students tab exactly
 * (see getSubjectClassroomsWithCounts).
 */
export function SubjectDetailPageReal() {
  const { subjectId } = useParams<{ subjectId: string }>()
  const navigate = useNavigate()
  const [subject, setSubject] = useState<Subject | null | undefined>(undefined)
  const [links, setLinks] = useState<SubjectClassroomWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)

  const refresh = useCallback(() => {
    if (!subjectId) return undefined
    setLoading(true)
    setError(null)
    return getSubjectById(subjectId)
      .then(async (row) => {
        setSubject(row)
        if (!row) return
        const linkRows = await getSubjectClassroomsWithCounts(row.id)
        setLinks(linkRows)
      })
      .catch((err: unknown) => setError(toFriendlyErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [subjectId])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (!subjectId) {
    return <Navigate to="/teacher/subjects" replace />
  }

  if (subject === undefined) {
    return error ? (
      <Navigate to="/teacher/subjects" replace />
    ) : (
      <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
    )
  }

  if (subject === null) {
    return <Navigate to="/teacher/subjects" replace />
  }

  const autoRedirectClassroomId = resolveAutoRedirectClassroomId(links)
  if (!loading && autoRedirectClassroomId) {
    return <Navigate to={buildSubjectClassroomPath(subject.id, autoRedirectClassroomId)} replace />
  }

  const summary = summarizeSubjectClassrooms(links)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{subject.name}</h1>
            {subject.subjectCode && <Badge variant="outline">{subject.subjectCode}</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading
              ? 'กำลังโหลด...'
              : `${summary.totalClassrooms} ห้องเรียน · ${summary.totalStudents} นักเรียน`}
            {subject.academicYear ? ` · ปีการศึกษา ${subject.academicYear}` : ''}
            {subject.semester ? ` ภาคเรียนที่ ${subject.semester}` : ''}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <Pencil className="size-4" />
          แก้ไขรายวิชา
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
      ) : links.length === 0 ? (
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
              key={link.id}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => navigate(buildSubjectClassroomPath(subject.id, link.classroomId))}
            >
              <CardContent className="flex items-center justify-between pt-5">
                <div>
                  <p className="text-base font-semibold">{link.classroomName ?? '-'}</p>
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

      <EditSubjectDialog open={editOpen} onOpenChange={setEditOpen} subject={subject} onSaved={refresh} />
    </div>
  )
}
