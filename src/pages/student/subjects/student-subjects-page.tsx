import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Card, CardContent } from '@/components/ui/card'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { getMySubjects } from '@/services/student-portal-service'
import type { MySubject } from '@/types/student-portal'

/**
 * /student/subjects — only subjects actually linked (via
 * subject_classrooms) to a classroom the signed-in student currently
 * belongs to (0011's subjects_select_via_membership policy). No demo
 * fallback, no roster/classmate data — just each subject's own name,
 * code, and classroom.
 */
export function StudentSubjectsPage() {
  const [subjects, setSubjects] = useState<MySubject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    getMySubjects()
      .then((rows) => {
        if (active) setSubjects(rows)
      })
      .catch((err: unknown) => {
        if (active) setError(toFriendlyErrorMessage(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">รายวิชาของฉัน</h1>
        <p className="mt-1 text-sm text-muted-foreground">รายวิชาที่เปิดสอนในห้องเรียนของฉัน</p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
      ) : subjects.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">ยังไม่มีรายวิชา</CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subjects.map((subject) => (
            <Link key={`${subject.id}:${subject.classroomId}`} to={`/student/subjects/${subject.id}`}>
              <Card className="h-full transition-colors hover:border-primary hover:bg-accent/40">
                <CardContent className="space-y-1.5 pt-5">
                  <p className="text-sm font-medium">{subject.name}</p>
                  {subject.subjectCode && <p className="text-xs text-muted-foreground">{subject.subjectCode}</p>}
                  <p className="text-xs text-muted-foreground">{subject.classroomName}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
