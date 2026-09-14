import { Check, CheckCircle2, Clock3, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/toast'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import {
  SUBMISSION_CELL_STATE_LABEL,
  SUBMISSION_CHECK_FILTERS,
  computeSubmissionCellState,
  computeSubmissionCheckTally,
  deriveGradeRoster,
  filterStudentsBySubmissionCheckState,
  getAssignments,
  getSubmissions,
  isSubmissionCellGradable,
  nextStatusAfterScore,
  parseScoreInput,
  searchAssignmentsByTitle,
  setSubmissionScore,
  type SubmissionCheckFilter,
} from '@/services/assignment-service'
import { getStudentsByClassroom } from '@/services/student-service'
import type { Assignment, AssignmentSubmission } from '@/types/assignment'
import type { Subject } from '@/types/subject'
import type { ClassroomStudent } from '@/types/student'

interface SubmissionCheckTabProps {
  subject: Subject
  classroomId: string
}

interface GradingTarget {
  assignment: Assignment
  student: ClassroomStudent
}

function studentDisplayName(student: ClassroomStudent): string {
  return `${student.number ?? '-'}. ${student.firstName} ${student.lastName}`
}

/**
 * ตรวจสอบงาน — separates "was this turned in?" (checking) from "what
 * score did it get?" (grading), the two questions the คะแนน tab's plain
 * number-input matrix conflates into one blank cell. Reads the exact
 * same `assignments` + `assignment_submissions` data as งาน/คะแนน (via
 * getAssignments/getSubmissions) — no new table, no mock data, no
 * invented database status. The only new idea is a pure DISPLAY
 * derivation of one of 5 visual states from the existing
 * (status, score) pair — see assignment-service.ts's
 * computeSubmissionCellState for the full rule (score !== null always
 * wins; a submitted-but-ungraded cell is never treated as score 0).
 *
 * Also reflects Hermes-written changes immediately: mark_submission_status
 * / mark_submission_status_bulk write to the SAME assignment_submissions
 * rows this tab reads on refresh() — there is no separate "checked by
 * teacher" flag that could fall out of sync with what Hermes recorded.
 */
export function SubmissionCheckTab({ subject, classroomId }: SubmissionCheckTabProps) {
  const { toast } = useToast()

  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [students, setStudents] = useState<ClassroomStudent[]>([])
  const [submissionsByAssignment, setSubmissionsByAssignment] = useState<
    Record<string, Record<string, AssignmentSubmission>>
  >({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [filter, setFilter] = useState<SubmissionCheckFilter>('all')
  const [assignmentQuery, setAssignmentQuery] = useState('')

  const [gradingTarget, setGradingTarget] = useState<GradingTarget | null>(null)
  const [scoreDraft, setScoreDraft] = useState('')
  const [scoreError, setScoreError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

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
  const visibleAssignments = searchAssignmentsByTitle(assignments, assignmentQuery)
  const visibleAssignmentIds = visibleAssignments.map((a) => a.id)

  // Tallies and the row filter both reflect the CURRENTLY SEARCHED
  // assignment columns, not every assignment ever created — so the
  // numbers on screen always match what's actually shown in the matrix
  // below, whether or not the assignment search box narrowed it.
  const tally = computeSubmissionCheckTally(
    roster.map((s) => s.id),
    visibleAssignmentIds,
    submissionsByAssignment,
  )
  const filteredRoster = filterStudentsBySubmissionCheckState(roster, visibleAssignmentIds, submissionsByAssignment, filter)

  function openGradingDialog(assignment: Assignment, student: ClassroomStudent) {
    const submission = submissionsByAssignment[assignment.id]?.[student.id]
    const state = computeSubmissionCellState(submission?.status ?? 'not_submitted', submission?.score ?? null)
    if (!isSubmissionCellGradable(state)) return

    setGradingTarget({ assignment, student })
    setScoreDraft(submission?.score !== null && submission?.score !== undefined ? String(submission.score) : '')
    setScoreError(null)
  }

  async function handleSaveScore() {
    if (!gradingTarget) return
    const { assignment, student } = gradingTarget
    const { value: score, error: validationError } = parseScoreInput(scoreDraft, assignment.maxScore)
    if (validationError) {
      setScoreError(validationError)
      return
    }

    const currentStatus = submissionsByAssignment[assignment.id]?.[student.id]?.status ?? 'not_submitted'
    setSaving(true)
    try {
      await setSubmissionScore(assignment.id, student.id, score, currentStatus)
      setSubmissionsByAssignment((prev) => {
        const existing = prev[assignment.id]?.[student.id] ?? {
          studentId: student.id,
          status: 'not_submitted' as const,
          score: null,
          note: null,
        }
        return {
          ...prev,
          [assignment.id]: {
            ...prev[assignment.id],
            [student.id]: { ...existing, score, status: nextStatusAfterScore(currentStatus, score) },
          },
        }
      })
      toast(score === null ? 'ล้างคะแนนแล้ว' : `บันทึกคะแนน ${score}/${assignment.maxScore} แล้ว`)
      setGradingTarget(null)
    } catch (err) {
      setScoreError(toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกคะแนนได้'))
    } finally {
      setSaving(false)
    }
  }

  if (!loading && assignments.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          ยังไม่มีงานในห้องเรียนนี้ — เพิ่มงานในแท็บ &ldquo;งาน&rdquo; ก่อน เพื่อตรวจสอบการส่งงาน
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryStat label="ส่งแล้ว" value={tally.submitted} tone="default" />
        <SummaryStat label="รอตรวจ" value={tally.awaitingReview} tone="warning" />
        <SummaryStat label="ตรวจแล้ว" value={tally.graded} tone="success" />
        <SummaryStat label="ยังไม่ส่ง" value={tally.notSubmitted} tone="muted" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 overflow-x-auto">
          {SUBMISSION_CHECK_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                'shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                filter === f.key
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {assignments.length > 4 && (
          <div className="relative ml-auto w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={assignmentQuery}
              onChange={(e) => setAssignmentQuery(e.target.value)}
              placeholder="ค้นหางาน..."
              className="h-8 pl-8"
            />
          </div>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[70vh] overflow-auto rounded-md">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="sticky left-0 top-0 z-20 bg-card px-5 py-3 font-medium">ชื่อ-นามสกุล</th>
                  {visibleAssignments.map((assignment) => (
                    <th key={assignment.id} className="sticky top-0 z-10 bg-card px-3 py-3 text-center font-medium">
                      {assignment.title}
                      <div className="font-normal">/{assignment.maxScore}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={visibleAssignments.length + 1} className="px-5 py-6 text-center text-muted-foreground">
                      กำลังโหลด...
                    </td>
                  </tr>
                ) : filteredRoster.length === 0 ? (
                  <tr>
                    <td colSpan={visibleAssignments.length + 1} className="px-5 py-6 text-center text-muted-foreground">
                      {roster.length === 0 ? 'ยังไม่มีนักเรียนในห้องเรียนนี้' : 'ไม่พบนักเรียนที่ตรงกับตัวกรองนี้'}
                    </td>
                  </tr>
                ) : (
                  filteredRoster.map((student) => (
                    <tr key={student.id} className="border-b border-border last:border-0">
                      <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-5 py-2 font-medium">
                        {studentDisplayName(student)}
                      </td>
                      {visibleAssignments.map((assignment) => {
                        const submission = submissionsByAssignment[assignment.id]?.[student.id]
                        const state = computeSubmissionCellState(submission?.status ?? 'not_submitted', submission?.score ?? null)
                        const gradable = isSubmissionCellGradable(state)
                        return (
                          <td key={assignment.id} className="px-3 py-2 text-center">
                            <button
                              type="button"
                              disabled={!gradable}
                              onClick={() => openGradingDialog(assignment, student)}
                              title={SUBMISSION_CELL_STATE_LABEL[state]}
                              className={cn(
                                'inline-flex h-8 min-w-14 items-center justify-center gap-1 rounded-md px-2 text-sm transition-colors',
                                gradable ? 'hover:bg-accent' : 'cursor-default',
                              )}
                            >
                              <SubmissionCellVisual state={state} score={submission?.score ?? null} maxScore={assignment.maxScore} />
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {gradingTarget && (
        <Dialog open={Boolean(gradingTarget)} onOpenChange={(open) => !open && setGradingTarget(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>ให้คะแนน</DialogTitle>
              <DialogDescription>
                {studentDisplayName(gradingTarget.student)} · {gradingTarget.assignment.title}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">สถานะการส่งงาน</span>
                <span className="font-medium">
                  {
                    SUBMISSION_CELL_STATE_LABEL[
                      computeSubmissionCellState(
                        submissionsByAssignment[gradingTarget.assignment.id]?.[gradingTarget.student.id]?.status ??
                          'not_submitted',
                        submissionsByAssignment[gradingTarget.assignment.id]?.[gradingTarget.student.id]?.score ?? null,
                      )
                    ]
                  }
                </span>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="submission-check-score">
                  คะแนน (เต็ม {gradingTarget.assignment.maxScore})
                </Label>
                <Input
                  id="submission-check-score"
                  type="number"
                  min={0}
                  max={gradingTarget.assignment.maxScore}
                  value={scoreDraft}
                  onChange={(e) => {
                    setScoreDraft(e.target.value)
                    setScoreError(null)
                  }}
                  placeholder="เว้นว่าง = ยังไม่ให้คะแนน"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">เว้นว่างไว้เพื่อตรวจทีหลัง — จะไม่ถูกนับเป็นคะแนน 0</p>
                {scoreError && <p className="text-sm text-destructive">{scoreError}</p>}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setGradingTarget(null)} disabled={saving}>
                ยกเลิก
              </Button>
              <Button type="button" onClick={handleSaveScore} disabled={saving}>
                {saving ? 'กำลังบันทึก...' : 'บันทึกคะแนน'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function SummaryStat({ label, value, tone }: { label: string; value: number; tone: 'default' | 'warning' | 'success' | 'muted' }) {
  const toneClass = {
    default: 'text-foreground',
    warning: 'text-warning-foreground',
    success: 'text-success',
    muted: 'text-muted-foreground',
  }[tone]

  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={cn('mt-1.5 text-2xl font-semibold tracking-tight', toneClass)}>{value}</p>
      </CardContent>
    </Card>
  )
}

/**
 * The 4 visual states from the spec: neutral "—" (not submitted), a
 * green check with no score (submitted, awaiting review — NEVER shown
 * as/confused with 0), an amber check for a late-but-ungraded submission,
 * a muted "ขาดส่ง" tag, and a check + score once grading is complete.
 */
function SubmissionCellVisual({
  state,
  score,
  maxScore,
}: {
  state: ReturnType<typeof computeSubmissionCellState>
  score: number | null
  maxScore: number
}) {
  if (state === 'graded') {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-success">
        <Check className="size-3.5" />
        {score}/{maxScore}
      </span>
    )
  }
  if (state === 'submitted_ungraded') {
    return <CheckCircle2 className="size-4 text-success" />
  }
  if (state === 'late_ungraded') {
    return <Clock3 className="size-4 text-warning-foreground" />
  }
  if (state === 'missing') {
    return <span className="text-xs font-medium text-destructive">ขาดส่ง</span>
  }
  return <span className="text-muted-foreground">—</span>
}
