import { Download } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { buildClassroomGradesExportTable } from '@/features/subjects-real/classroom-export-builders'
import { downloadCsv } from '@/lib/export/csv-export'
import { toFriendlyErrorMessage } from '@/lib/errors'
import {
  computeClassGradeStats,
  computeGradeRows,
  deriveGradeRoster,
  getAssignments,
  getSubmissions,
  nextStatusAfterScore,
  parseScoreInput,
  setSubmissionScore,
} from '@/services/assignment-service'
import { getStudentsByClassroom } from '@/services/student-service'
import type { Assignment, AssignmentSubmission } from '@/types/assignment'
import type { Subject } from '@/types/subject'
import type { ClassroomStudent } from '@/types/student'

interface GradesTabProps {
  subject: Subject
  classroomId: string
  classroomName: string
}

/**
 * Real, Supabase-backed Grades — a derived view over `assignments` +
 * `assignment_submissions.score`, never a separate stored table (see
 * 0006's "Future relationship" note and assignment-service.ts's
 * computeGradeRows). Strictly scoped to this exact subject+classroom:
 * getAssignments never merges another linked classroom's assignments,
 * and every total/percentage/class-average figure here is recomputed
 * live from what's currently loaded — nothing derived is ever persisted.
 *
 * Score entry writes straight to assignment_submissions.score via the
 * same setSubmissionScore used by the assignment detail page, so a score
 * entered here shows up there immediately (and vice versa) — there is no
 * separate, competing grade record.
 */
export function GradesTab({ subject, classroomId, classroomName }: GradesTabProps) {
  const { toast } = useToast()

  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [students, setStudents] = useState<ClassroomStudent[]>([])
  const [submissionsByAssignment, setSubmissionsByAssignment] = useState<
    Record<string, Record<string, AssignmentSubmission>>
  >({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resetTicks, setResetTicks] = useState<Record<string, number>>({})

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    return Promise.all([getAssignments(subject.id, classroomId), getStudentsByClassroom(classroomId)])
      .then(async ([assignmentRows, studentRows]) => {
        setAssignments(assignmentRows)
        setStudents(studentRows)
        const submissionRows = await Promise.all(assignmentRows.map((a) => getSubmissions(a.id)))
        const next: Record<string, Record<string, AssignmentSubmission>> = {}
        assignmentRows.forEach((a, i) => {
          next[a.id] = submissionRows[i]
        })
        setSubmissionsByAssignment(next)
      })
      .catch((err: unknown) => setError(toFriendlyErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [subject.id, classroomId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const roster = deriveGradeRoster(students, submissionsByAssignment).sort(
    (a, b) => (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER),
  )
  const rows = computeGradeRows(
    roster.map((s) => s.id),
    assignments,
    submissionsByAssignment,
  )
  const rowById = Object.fromEntries(rows.map((r) => [r.studentId, r]))
  const stats = computeClassGradeStats(rows)

  async function handleScoreBlur(assignment: Assignment, studentId: string, raw: string) {
    const cellKey = `${assignment.id}:${studentId}`
    const { value: score, error: validationError } = parseScoreInput(raw, assignment.maxScore)
    if (validationError) {
      toast(validationError)
      setResetTicks((prev) => ({ ...prev, [cellKey]: (prev[cellKey] ?? 0) + 1 }))
      return
    }

    const currentStatus = submissionsByAssignment[assignment.id]?.[studentId]?.status ?? 'not_submitted'
    try {
      await setSubmissionScore(assignment.id, studentId, score, currentStatus)
      setSubmissionsByAssignment((prev) => {
        const existing = prev[assignment.id]?.[studentId] ?? {
          studentId,
          status: 'not_submitted' as const,
          score: null,
          note: null,
        }
        return {
          ...prev,
          [assignment.id]: {
            ...prev[assignment.id],
            [studentId]: { ...existing, score, status: nextStatusAfterScore(currentStatus, score) },
          },
        }
      })
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกคะแนนได้'))
      setResetTicks((prev) => ({ ...prev, [cellKey]: (prev[cellKey] ?? 0) + 1 }))
    }
  }

  /**
   * Google Sheets Integration, Section 2: a teacher-readable CSV of every
   * score currently loaded — the exact same `assignments`/`roster`/
   * `submissionsByAssignment` state this screen already renders from, so
   * the export can never drift from what's on screen (same "export only
   * ever sees what's already loaded" discipline as report-export-builders.ts).
   * downloadCsv's buildCsvContent already handles the UTF-8 BOM (Thai
   * text in Excel) and formula-injection escaping — this never
   * re-implements either.
   */
  function handleExport() {
    const table = buildClassroomGradesExportTable(subject.name, classroomName, assignments, roster, submissionsByAssignment)
    downloadCsv(table, `คะแนน-${subject.name}-${classroomName}`)
  }

  if (!loading && assignments.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          ยังไม่มีงานในห้องเรียนนี้ — เพิ่มงานในแท็บ &ldquo;งาน&rdquo; ก่อน เพื่อดูตารางคะแนน
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={handleExport} disabled={loading || roster.length === 0}>
          <Download className="size-3.5" />
          ส่งออกคะแนน (CSV)
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">คะแนนเฉลี่ยห้อง</p>
            <p className="mt-1.5 text-2xl font-semibold tracking-tight">
              {stats.classAverage !== null ? `${stats.classAverage.toFixed(1)}%` : '-'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">คะแนนสูงสุด</p>
            <p className="mt-1.5 text-2xl font-semibold tracking-tight text-success">
              {stats.highest !== null ? `${stats.highest.toFixed(1)}%` : '-'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">คะแนนต่ำสุด</p>
            <p className="mt-1.5 text-2xl font-semibold tracking-tight text-destructive">
              {stats.lowest !== null ? `${stats.lowest.toFixed(1)}%` : '-'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="sticky left-0 bg-card px-5 py-3 font-medium">ชื่อ-นามสกุล</th>
                  {assignments.map((assignment) => (
                    <th key={assignment.id} className="px-3 py-3 text-center font-medium">
                      {assignment.title}
                      <div className="font-normal">/{assignment.maxScore}</div>
                    </th>
                  ))}
                  <th className="px-3 py-3 text-center font-medium">รวม</th>
                  <th className="px-3 py-3 text-center font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={assignments.length + 3} className="px-5 py-6 text-center text-muted-foreground">
                      กำลังโหลด...
                    </td>
                  </tr>
                ) : roster.length === 0 ? (
                  <tr>
                    <td colSpan={assignments.length + 3} className="px-5 py-6 text-center text-muted-foreground">
                      ยังไม่มีนักเรียนในห้องเรียนนี้
                    </td>
                  </tr>
                ) : (
                  roster.map((student) => {
                    const row = rowById[student.id]
                    return (
                      <tr key={student.id} className="border-b border-border last:border-0">
                        <td className="sticky left-0 whitespace-nowrap bg-card px-5 py-2 font-medium">
                          {student.number ?? '-'}. {student.firstName} {student.lastName}
                        </td>
                        {assignments.map((assignment) => {
                          const score = row?.scoresByAssignment[assignment.id] ?? null
                          const cellKey = `${assignment.id}:${student.id}`
                          return (
                            <td key={assignment.id} className="px-3 py-2 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <Input
                                  type="number"
                                  min={0}
                                  max={assignment.maxScore}
                                  defaultValue={score ?? ''}
                                  key={`${cellKey}-${score}-${resetTicks[cellKey] ?? 0}`}
                                  onBlur={(e) => handleScoreBlur(assignment, student.id, e.target.value)}
                                  className="h-8 w-16 text-center"
                                />
                              </div>
                            </td>
                          )
                        })}
                        <td className="px-3 py-2 text-center font-semibold">
                          {row?.total ?? 0}/{row?.possible ?? 0}
                        </td>
                        <td className="px-3 py-2 text-center text-muted-foreground">
                          {row?.percentage !== null && row?.percentage !== undefined ? `${row.percentage.toFixed(1)}%` : '-'}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
