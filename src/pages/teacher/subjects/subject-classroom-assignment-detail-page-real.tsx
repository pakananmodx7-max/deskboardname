import { ArrowLeft } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import {
  buildDefaultSubmissions,
  deriveAssignmentRoster,
  getAssignmentById,
  getSubmissionSummary,
  getSubmissions,
  nextStatusAfterScore,
  parseScoreInput,
  setSubmissionNote,
  setSubmissionScore,
  setSubmissionStatus,
} from '@/services/assignment-service'
import { getStudentsByClassroom } from '@/services/student-service'
import type { Assignment, AssignmentSubmission, SubmissionStatus } from '@/types/assignment'
import type { ClassroomStudent } from '@/types/student'

const STATUS_ORDER: SubmissionStatus[] = ['submitted', 'not_submitted', 'late', 'missing']
const STATUS_LABEL: Record<SubmissionStatus, string> = {
  submitted: 'ส่งแล้ว',
  not_submitted: 'ยังไม่ส่ง',
  late: 'ส่งช้า',
  missing: 'ขาดส่ง',
}
const STATUS_BUTTON_STYLE: Record<SubmissionStatus, string> = {
  submitted: 'data-[active=true]:bg-success data-[active=true]:text-success-foreground',
  not_submitted:
    'data-[active=true]:bg-secondary data-[active=true]:text-secondary-foreground data-[active=true]:border-foreground/30',
  late: 'data-[active=true]:bg-warning data-[active=true]:text-warning-foreground',
  missing: 'data-[active=true]:bg-destructive data-[active=true]:text-destructive-foreground',
}

/**
 * Real, Supabase-backed assignment detail — checklist, bulk status
 * actions, score/note entry, all scoped to this one assignment's
 * classroom roster (getStudentsByClassroom(classroomId), never another
 * linked classroom's students). Unlike the standalone Attendance page,
 * there's no batch "Save" step: each status click and each score/note
 * edit (committed on blur, to avoid a network round trip per keystroke)
 * persists immediately via assignment-service.ts — assignment
 * submissions aren't an atomic all-or-nothing batch the way one day's
 * attendance session is, so there's no shared parent write that needs
 * a single deferred commit.
 */
export function SubjectClassroomAssignmentDetailPageReal() {
  const { subjectId, classroomId, assignmentId } = useParams<{
    subjectId: string
    classroomId: string
    assignmentId: string
  }>()
  const navigate = useNavigate()
  const { toast } = useToast()

  const [assignment, setAssignment] = useState<Assignment | null | undefined>(undefined)
  const [students, setStudents] = useState<ClassroomStudent[]>([])
  const [submissions, setSubmissions] = useState<Record<string, AssignmentSubmission>>({})
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  /** Bumped whenever a score entry is rejected as out-of-range, forcing
   * the (uncontrolled, defaultValue-based) score input to remount and
   * revert to the last saved value even when that saved value itself
   * didn't change. */
  const [scoreResetTick, setScoreResetTick] = useState(0)

  const refresh = useCallback(() => {
    if (!assignmentId || !classroomId) return undefined
    setLoading(true)
    setError(null)
    return Promise.all([getAssignmentById(assignmentId), getStudentsByClassroom(classroomId), getSubmissions(assignmentId)])
      .then(([assignmentRow, classroomStudents, submissionRows]) => {
        setAssignment(assignmentRow)
        setStudents(classroomStudents)
        const activeIds = classroomStudents.filter((s) => s.status === 'active').map((s) => s.id)
        const merged = { ...buildDefaultSubmissions(activeIds), ...submissionRows }
        setSubmissions(merged)
        setNoteDrafts(Object.fromEntries(Object.entries(merged).map(([id, s]) => [id, s.note ?? ''])))
      })
      .catch((err: unknown) => setError(toFriendlyErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [assignmentId, classroomId])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (!subjectId || !classroomId || !assignmentId) {
    return <Navigate to="/teacher/subjects" replace />
  }

  if (assignment === undefined || loading) {
    return <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
  }

  // Closes the "type a mismatched subject/classroom id into the URL"
  // path — an assignment that doesn't actually belong to this exact
  // subject+classroom bounces back to the workspace instead of silently
  // rendering it under the wrong classroom.
  if (!assignment || assignment.subjectId !== subjectId || assignment.classroomId !== classroomId) {
    return <Navigate to={`/teacher/subjects/${subjectId}/classrooms/${classroomId}`} replace />
  }

  const currentAssignmentId = assignmentId as string
  // Same reasoning as currentAssignmentId above: TS doesn't carry the
  // `!assignment` narrowing above into a nested function declared later
  // (handleScoreBlur), so it's re-asserted here once.
  const currentAssignment = assignment as Assignment

  const roster = deriveAssignmentRoster(students, submissions)
  const rosterSubmissions: Record<string, AssignmentSubmission> = {}
  for (const student of roster) {
    if (submissions[student.id]) rosterSubmissions[student.id] = submissions[student.id]
  }
  const summary = getSubmissionSummary(rosterSubmissions)
  const allSelected = selectedIds.length > 0 && selectedIds.length === roster.length

  function toggleSelectAll() {
    setSelectedIds(allSelected ? [] : roster.map((s) => s.id))
  }

  function toggleSelect(studentId: string) {
    setSelectedIds((prev) => (prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]))
  }

  function defaultSubmission(studentId: string): AssignmentSubmission {
    return { studentId, status: 'not_submitted', score: null, note: null }
  }

  async function handleSetStatus(studentId: string, status: SubmissionStatus) {
    try {
      await setSubmissionStatus(currentAssignmentId, studentId, status)
      setSubmissions((prev) => ({
        ...prev,
        [studentId]: { ...(prev[studentId] ?? defaultSubmission(studentId)), status },
      }))
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกสถานะได้'))
    }
  }

  async function handleBulkStatus(status: SubmissionStatus) {
    if (selectedIds.length === 0) return
    try {
      await Promise.all(selectedIds.map((studentId) => setSubmissionStatus(currentAssignmentId, studentId, status)))
      setSubmissions((prev) => {
        const next = { ...prev }
        for (const studentId of selectedIds) {
          next[studentId] = { ...(prev[studentId] ?? defaultSubmission(studentId)), status }
        }
        return next
      })
      toast(`ทำเครื่องหมาย "${STATUS_LABEL[status]}" ให้ ${selectedIds.length} คนแล้ว`)
      setSelectedIds([])
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกสถานะได้'))
    }
  }

  async function handleScoreBlur(studentId: string, raw: string) {
    const { value: score, error: validationError } = parseScoreInput(raw, currentAssignment.maxScore)
    if (validationError) {
      toast(validationError)
      setScoreResetTick((t) => t + 1)
      return
    }
    const current = submissions[studentId] ?? defaultSubmission(studentId)
    try {
      await setSubmissionScore(currentAssignmentId, studentId, score, current.status)
      setSubmissions((prev) => ({
        ...prev,
        [studentId]: { ...current, score, status: nextStatusAfterScore(current.status, score) },
      }))
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกคะแนนได้'))
      setScoreResetTick((t) => t + 1)
    }
  }

  async function handleNoteBlur(studentId: string) {
    const note = noteDrafts[studentId] ?? ''
    if (note === (submissions[studentId]?.note ?? '')) return
    try {
      await setSubmissionNote(currentAssignmentId, studentId, note)
      setSubmissions((prev) => ({
        ...prev,
        [studentId]: { ...(prev[studentId] ?? defaultSubmission(studentId)), note: note || null },
      }))
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกหมายเหตุได้'))
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <button
          type="button"
          onClick={() => navigate(`/teacher/subjects/${subjectId}/classrooms/${classroomId}`)}
          className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          กลับไปที่ห้องเรียน
        </button>
        <h1 className="text-xl font-semibold tracking-tight">{assignment.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {assignment.maxScore} คะแนนเต็ม{assignment.dueDate ? ` · กำหนดส่ง ${assignment.dueDate}` : ''}
        </p>
        {assignment.description && <p className="mt-1 text-sm text-muted-foreground">{assignment.description}</p>}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">สรุปการส่งงาน</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">ส่งแล้ว</span>
            <span className="font-semibold">{summary.submitted}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">ยังไม่ส่ง</span>
            <span className="font-semibold">{summary.notSubmitted}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">ส่งช้า</span>
            <span className="font-semibold">{summary.late}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">ขาดส่ง</span>
            <span className="font-semibold">{summary.missing}</span>
          </div>
          <div className="ml-auto flex items-center gap-2 border-l border-border pl-6">
            <span className="text-muted-foreground">คะแนนเฉลี่ย</span>
            <span className="font-semibold">
              {summary.average !== null ? summary.average.toFixed(1) : '-'}/{assignment.maxScore}
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="size-4 rounded border-input" />
          เลือกทั้งหมด
        </label>
        <span className="text-xs text-muted-foreground">{selectedIds.length > 0 && `เลือก ${selectedIds.length} คน`}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={selectedIds.length === 0} onClick={() => handleBulkStatus('submitted')}>
            ทำเครื่องหมาย &ldquo;ส่งแล้ว&rdquo;
          </Button>
          <Button variant="outline" size="sm" disabled={selectedIds.length === 0} onClick={() => handleBulkStatus('not_submitted')}>
            ทำเครื่องหมาย &ldquo;ยังไม่ส่ง&rdquo;
          </Button>
          <Button variant="outline" size="sm" disabled={selectedIds.length === 0} onClick={() => handleBulkStatus('late')}>
            ทำเครื่องหมาย &ldquo;ส่งช้า&rdquo;
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-4 py-3"></th>
                  <th className="px-3 py-3 font-medium">เลขที่</th>
                  <th className="px-3 py-3 font-medium">ชื่อ</th>
                  <th className="px-3 py-3 font-medium">สถานะ</th>
                  <th className="px-3 py-3 font-medium">คะแนน</th>
                  <th className="px-3 py-3 font-medium">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {roster.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-6 text-center text-muted-foreground">
                      ยังไม่มีนักเรียนในห้องเรียนนี้
                    </td>
                  </tr>
                ) : (
                  roster.map((student) => {
                    const submission = submissions[student.id] ?? {
                      studentId: student.id,
                      status: 'not_submitted' as SubmissionStatus,
                      score: null,
                      note: null,
                    }
                    return (
                      <tr key={student.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(student.id)}
                            onChange={() => toggleSelect(student.id)}
                            className="size-4 rounded border-input"
                          />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{student.number}</td>
                        <td className="px-3 py-2 font-medium">
                          {student.firstName} {student.lastName}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1.5">
                            {STATUS_ORDER.map((status) => (
                              <button
                                key={status}
                                type="button"
                                data-active={submission.status === status}
                                onClick={() => handleSetStatus(student.id, status)}
                                className={cn(
                                  'rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent',
                                  STATUS_BUTTON_STYLE[status],
                                )}
                              >
                                {STATUS_LABEL[status]}
                              </button>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Input
                              type="number"
                              min={0}
                              max={assignment.maxScore}
                              defaultValue={submission.score ?? ''}
                              key={`${student.id}-${submission.score}-${scoreResetTick}`}
                              onBlur={(e) => handleScoreBlur(student.id, e.target.value)}
                              className="h-8 w-16 text-center"
                            />
                            <span>/ {assignment.maxScore}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            value={noteDrafts[student.id] ?? ''}
                            onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [student.id]: e.target.value }))}
                            onBlur={() => handleNoteBlur(student.id)}
                            placeholder="หมายเหตุ"
                            className="h-8 w-36"
                          />
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
