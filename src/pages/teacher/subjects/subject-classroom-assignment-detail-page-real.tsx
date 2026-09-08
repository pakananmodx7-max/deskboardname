import { ArrowLeft } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/toast'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import {
  bulkFillWouldOverwrite,
  deriveAssignmentRoster,
  getAssignmentById,
  getSubmissionSummary,
  getSubmissions,
  mergeSubmissionsWithDefaults,
  nextScoreFocusIndex,
  nextStatusAfterScore,
  parseScoreInput,
  planScorePaste,
  setSubmissionNote,
  setSubmissionScore,
  setSubmissionStatus,
  updateAssignment,
  validateMaxScoreChange,
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

type ScoreSaveState = 'saving' | 'saved' | 'error'

function studentLabel(student: { firstName: string; lastName: string } | undefined, fallbackId: string): string {
  return student ? `${student.firstName} ${student.lastName}` : fallbackId
}

/**
 * Real, Supabase-backed assignment detail — checklist, bulk status
 * actions, and spreadsheet-style score entry, all scoped to this one
 * assignment's classroom roster (getStudentsByClassroom(classroomId),
 * never another linked classroom's students). Unlike the standalone
 * Attendance page, there's no batch "Save" step: each status click and
 * each score/note edit (committed on blur, to avoid a network round trip
 * per keystroke) persists immediately via assignment-service.ts —
 * assignment submissions aren't an atomic all-or-nothing batch the way
 * one day's attendance session is, so there's no shared parent write
 * that needs a single deferred commit.
 *
 * Score entry supports Enter-to-next-row, Arrow Up/Down navigation,
 * pasting a multi-row column copied from Excel/Sheets, and a bulk-fill
 * action for the currently checkbox-selected students — all built on
 * the same setSubmissionScore/parseScoreInput used by a single-cell
 * edit, never a second, competing write path.
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
   * didn't change. Also bumped after a successful paste/bulk-fill so
   * every affected cell re-reads its new value from `submissions`. */
  const [scoreResetTick, setScoreResetTick] = useState(0)
  /** Per-student "กำลังบันทึก.../บันทึกแล้ว/เกิดข้อผิดพลาด" indicator for
   * score entry specifically — cleared back to idle (key absent) a
   * moment after a successful save. */
  const [scoreSaveState, setScoreSaveState] = useState<Record<string, ScoreSaveState>>({})
  const scoreInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const saveStateTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const [maxScoreError, setMaxScoreError] = useState<string | null>(null)
  const [maxScoreResetTick, setMaxScoreResetTick] = useState(0)

  const [bulkFillOpen, setBulkFillOpen] = useState(false)
  const [bulkFillScore, setBulkFillScore] = useState('')
  const [bulkFillError, setBulkFillError] = useState<string | null>(null)
  const [bulkFillConfirmOpen, setBulkFillConfirmOpen] = useState(false)
  const [bulkFillPendingValue, setBulkFillPendingValue] = useState<number | null>(null)

  const refresh = useCallback(() => {
    if (!assignmentId || !classroomId) return undefined
    setLoading(true)
    setError(null)
    return Promise.all([getAssignmentById(assignmentId), getStudentsByClassroom(classroomId), getSubmissions(assignmentId)])
      .then(([assignmentRow, classroomStudents, submissionRows]) => {
        setAssignment(assignmentRow)
        setStudents(classroomStudents)
        const activeIds = classroomStudents.filter((s) => s.status === 'active').map((s) => s.id)
        const merged = mergeSubmissionsWithDefaults(activeIds, submissionRows)
        setSubmissions(merged)
        setNoteDrafts(Object.fromEntries(Object.entries(merged).map(([id, s]) => [id, s.note ?? ''])))
      })
      .catch((err: unknown) => setError(toFriendlyErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [assignmentId, classroomId])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const timers = saveStateTimers.current
    return () => {
      Object.values(timers).forEach(clearTimeout)
    }
  }, [])

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
  // (handleScoreBlur, etc.), so it's re-asserted here once.
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

  function setScoreSaveStateFor(studentId: string, state: ScoreSaveState) {
    const existingTimer = saveStateTimers.current[studentId]
    if (existingTimer) {
      clearTimeout(existingTimer)
      delete saveStateTimers.current[studentId]
    }
    setScoreSaveState((prev) => ({ ...prev, [studentId]: state }))
    if (state === 'saved') {
      saveStateTimers.current[studentId] = setTimeout(() => {
        setScoreSaveState((prev) => {
          const next = { ...prev }
          delete next[studentId]
          return next
        })
      }, 1500)
    }
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

  async function handleMaxScoreBlur(raw: string) {
    const parsed = Number(raw)
    const result = validateMaxScoreChange(parsed, submissions)
    if (!result.ok) {
      const detail =
        result.violations.length > 0
          ? ` — ${result.violations.map((v) => `${studentLabel(roster.find((s) => s.id === v.studentId), v.studentId)} (${v.score})`).join(', ')}`
          : ''
      setMaxScoreError(`${result.error}${detail}`)
      setMaxScoreResetTick((t) => t + 1)
      return
    }
    setMaxScoreError(null)
    if (parsed === currentAssignment.maxScore) return
    try {
      const updated = await updateAssignment(currentAssignmentId, { maxScore: parsed })
      setAssignment(updated)
      toast('อัปเดตคะแนนเต็มแล้ว')
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถอัปเดตคะแนนเต็มได้'))
      setMaxScoreResetTick((t) => t + 1)
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
    setScoreSaveStateFor(studentId, 'saving')
    try {
      await setSubmissionScore(currentAssignmentId, studentId, score, current.status)
      setSubmissions((prev) => ({
        ...prev,
        [studentId]: { ...current, score, status: nextStatusAfterScore(current.status, score) },
      }))
      setScoreSaveStateFor(studentId, 'saved')
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกคะแนนได้'))
      setScoreResetTick((t) => t + 1)
      setScoreSaveStateFor(studentId, 'error')
    }
  }

  function handleScoreKeyDown(e: KeyboardEvent<HTMLInputElement>, studentId: string, rowIndex: number) {
    if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return

    const targetIndex = nextScoreFocusIndex(e.key, rowIndex, roster.length)

    if (e.key === 'Enter') {
      e.preventDefault()
      // onBlur (already wired below) fires from this and persists the
      // current value — Enter just needs to trigger that and move on. On
      // the last row, targetIndex === rowIndex, so this simply re-focuses
      // the same (now-saved) cell instead of nowhere.
      e.currentTarget.blur()
      const targetId = roster[targetIndex]?.id ?? studentId
      requestAnimationFrame(() => scoreInputRefs.current[targetId]?.focus())
      return
    }

    // ArrowDown/ArrowUp: only intercept the native number-input
    // spinner behavior when this actually moves focus to another row.
    if (targetIndex !== rowIndex) {
      e.preventDefault()
      const targetId = roster[targetIndex]?.id
      if (targetId) scoreInputRefs.current[targetId]?.focus()
    }
  }

  async function handleScorePaste(e: ClipboardEvent<HTMLInputElement>, rowIndex: number) {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\n') && !text.includes('\r') && !text.includes('\t')) {
      // A single plain value — let the browser's normal single-cell
      // paste happen; it's validated the same as any typed entry once
      // the input blurs.
      return
    }
    e.preventDefault()

    const plan = planScorePaste(
      text,
      rowIndex,
      roster.map((s) => s.id),
      currentAssignment.maxScore,
    )
    const invalidRows = plan.filter((row) => row.error)
    const validRows = plan.filter((row) => !row.error && row.raw !== '')

    if (invalidRows.length > 0) {
      const names = invalidRows
        .map((row) => `${studentLabel(roster.find((s) => s.id === row.studentId), row.studentId)} (${row.raw || 'ว่าง'})`)
        .join(', ')
      toast(`ข้ามแถวที่คะแนนไม่ถูกต้อง: ${names}`)
    }

    if (validRows.length === 0) return

    for (const row of validRows) setScoreSaveStateFor(row.studentId, 'saving')
    try {
      await Promise.all(
        validRows.map((row) => {
          const current = submissions[row.studentId] ?? defaultSubmission(row.studentId)
          return setSubmissionScore(currentAssignmentId, row.studentId, row.value, current.status)
        }),
      )
      setSubmissions((prev) => {
        const next = { ...prev }
        for (const row of validRows) {
          const current = prev[row.studentId] ?? defaultSubmission(row.studentId)
          next[row.studentId] = { ...current, score: row.value, status: nextStatusAfterScore(current.status, row.value) }
        }
        return next
      })
      for (const row of validRows) setScoreSaveStateFor(row.studentId, 'saved')
      setScoreResetTick((t) => t + 1)
      toast(`วางคะแนน ${validRows.length} รายการสำเร็จ`)
    } catch (err) {
      for (const row of validRows) setScoreSaveStateFor(row.studentId, 'error')
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกคะแนนที่วางได้'))
    }
  }

  async function handleCopySelectedScores() {
    const orderedSelected = roster.filter((s) => selectedIds.includes(s.id))
    if (orderedSelected.length === 0) return
    const text = orderedSelected.map((s) => submissions[s.id]?.score ?? '').join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast(`คัดลอกคะแนน ${orderedSelected.length} รายการแล้ว`)
    } catch {
      toast('ไม่สามารถคัดลอกคะแนนได้')
    }
  }

  function handleBulkFillSubmit(e: FormEvent) {
    e.preventDefault()
    const { value, error: validationError } = parseScoreInput(bulkFillScore, currentAssignment.maxScore)
    if (validationError || value === null) {
      setBulkFillError(validationError ?? 'กรุณากรอกคะแนน')
      return
    }
    setBulkFillError(null)
    if (bulkFillWouldOverwrite(selectedIds, submissions)) {
      setBulkFillPendingValue(value)
      setBulkFillOpen(false)
      setBulkFillConfirmOpen(true)
    } else {
      applyBulkFill(value)
    }
  }

  async function applyBulkFill(value: number) {
    const targetIds = [...selectedIds]
    for (const id of targetIds) setScoreSaveStateFor(id, 'saving')
    try {
      await Promise.all(
        targetIds.map((studentId) => {
          const current = submissions[studentId] ?? defaultSubmission(studentId)
          return setSubmissionScore(currentAssignmentId, studentId, value, current.status)
        }),
      )
      setSubmissions((prev) => {
        const next = { ...prev }
        for (const studentId of targetIds) {
          const current = prev[studentId] ?? defaultSubmission(studentId)
          next[studentId] = { ...current, score: value, status: nextStatusAfterScore(current.status, value) }
        }
        return next
      })
      for (const id of targetIds) setScoreSaveStateFor(id, 'saved')
      toast(`ใส่คะแนน ${value} ให้ ${targetIds.length} คนแล้ว`)
      setScoreResetTick((t) => t + 1)
      setBulkFillOpen(false)
      setBulkFillConfirmOpen(false)
      setBulkFillScore('')
      setBulkFillPendingValue(null)
      setSelectedIds([])
    } catch (err) {
      for (const id of targetIds) setScoreSaveStateFor(id, 'error')
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถใส่คะแนนได้'))
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
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <label htmlFor="assignment-max-score" className="flex items-center gap-1.5">
            คะแนนเต็ม:
            <Input
              id="assignment-max-score"
              type="number"
              min={1}
              defaultValue={currentAssignment.maxScore}
              key={`max-score-${currentAssignment.maxScore}-${maxScoreResetTick}`}
              onBlur={(e) => handleMaxScoreBlur(e.target.value)}
              className="h-8 w-20 text-center"
            />
          </label>
          {assignment.dueDate && <span>กำหนดส่ง {assignment.dueDate}</span>}
        </div>
        {maxScoreError && <p className="mt-1 text-sm text-destructive">{maxScoreError}</p>}
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
          <Button variant="outline" size="sm" disabled={selectedIds.length === 0} onClick={handleCopySelectedScores}>
            คัดลอกคะแนนที่เลือก
          </Button>
          <Button variant="outline" size="sm" disabled={selectedIds.length === 0} onClick={() => setBulkFillOpen(true)}>
            ใส่คะแนนหลายคน
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
                  roster.map((student, rowIndex) => {
                    const submission = submissions[student.id] ?? {
                      studentId: student.id,
                      status: 'not_submitted' as SubmissionStatus,
                      score: null,
                      note: null,
                    }
                    const saveState = scoreSaveState[student.id]
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
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Input
                                type="number"
                                min={0}
                                max={currentAssignment.maxScore}
                                defaultValue={submission.score ?? ''}
                                key={`${student.id}-${submission.score}-${scoreResetTick}`}
                                ref={(el) => {
                                  scoreInputRefs.current[student.id] = el
                                }}
                                onBlur={(e) => handleScoreBlur(student.id, e.target.value)}
                                onKeyDown={(e) => handleScoreKeyDown(e, student.id, rowIndex)}
                                onPaste={(e) => handleScorePaste(e, rowIndex)}
                                className="h-8 w-16 text-center"
                              />
                              <span>/ {currentAssignment.maxScore}</span>
                            </div>
                            {saveState === 'saving' && (
                              <span className="text-[11px] text-muted-foreground">กำลังบันทึก...</span>
                            )}
                            {saveState === 'saved' && <span className="text-[11px] text-success">บันทึกแล้ว</span>}
                            {saveState === 'error' && <span className="text-[11px] text-destructive">เกิดข้อผิดพลาด</span>}
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

      <Dialog open={bulkFillOpen} onOpenChange={setBulkFillOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ใส่คะแนนหลายคน</DialogTitle>
            <DialogDescription>ใส่คะแนนเดียวกันให้นักเรียนที่เลือกไว้ {selectedIds.length} คน</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleBulkFillSubmit}>
            {bulkFillError && <p className="text-sm text-destructive">{bulkFillError}</p>}
            <div className="space-y-1.5">
              <Label htmlFor="bulk-fill-score">คะแนน (เต็ม {currentAssignment.maxScore})</Label>
              <Input
                id="bulk-fill-score"
                type="number"
                min={0}
                max={currentAssignment.maxScore}
                value={bulkFillScore}
                onChange={(e) => setBulkFillScore(e.target.value)}
                autoFocus
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit">นำไปใช้</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={bulkFillConfirmOpen}
        onOpenChange={(open) => {
          setBulkFillConfirmOpen(open)
          if (!open) setBulkFillPendingValue(null)
        }}
        title="เขียนทับคะแนนเดิม?"
        description={`นักเรียนบางคนในกลุ่มที่เลือกมีคะแนนอยู่แล้ว การใส่คะแนน ${bulkFillPendingValue ?? ''} จะเขียนทับคะแนนเดิมของพวกเขา ต้องการดำเนินการต่อหรือไม่?`}
        confirmLabel="เขียนทับ"
        onConfirm={() => {
          if (bulkFillPendingValue !== null) return applyBulkFill(bulkFillPendingValue)
        }}
      />
    </div>
  )
}
