import { useEffect, useState } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { computeMyGrades, getMyAssignments } from '@/services/student-portal-service'
import type { MyAssignment } from '@/types/student-portal'

/**
 * /student/grades — derived entirely from assignments +
 * assignment_submissions.score (0011's assignment_submissions_select_own_student
 * policy: own rows only), never a separate grades table, matching this
 * schema's standing "grades are a derived view" design (0006/0007).
 * Deliberately never shows class average, highest, or lowest — those
 * would require reading other students' scores, which this page's data
 * source (getMyAssignments) cannot return in the first place.
 */
export function StudentGradesPage() {
  const [assignments, setAssignments] = useState<MyAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    getMyAssignments()
      .then((rows) => {
        if (active) setAssignments(rows)
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

  const grades = computeMyGrades(assignments)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">คะแนน</h1>
        <p className="mt-1 text-sm text-muted-foreground">คะแนนของฉันแยกตามรายวิชา</p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-5">
          <div>
            <p className="text-sm text-muted-foreground">คะแนนรวมทั้งหมด</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight">
              {grades.totalEarned} / {grades.totalPossible}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">เปอร์เซ็นต์</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight">
              {grades.totalPercentage !== null ? `${grades.totalPercentage.toFixed(1)}%` : '-'}
            </p>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
      ) : grades.bySubject.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">ยังไม่มีคะแนน</CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {grades.bySubject.map((subject) => (
            <Card key={`${subject.subjectId}:${subject.classroomId}`}>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">{subject.subjectName}</CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">{subject.classroomName}</p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-semibold">
                    {subject.earned} / {subject.possible}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {subject.percentage !== null ? `${subject.percentage.toFixed(1)}%` : '-'}
                  </p>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border border-t border-border">
                  {subject.assignments.map((row) => (
                    <div key={row.assignmentId} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                      <span className="truncate">{row.title}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {row.score !== null ? `${row.score}/${row.maxScore}` : `-/${row.maxScore}`}
                        {row.percentage !== null && ` (${row.percentage.toFixed(0)}%)`}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
