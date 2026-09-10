import { ArrowLeft, ChevronLeft, ChevronRight, Search } from 'lucide-react'
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

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { AssignmentDialog } from '@/features/subjects-real/assignment-dialog'
import { AssignmentResourcesSection } from '@/features/subjects-real/assignment-resources-section'
import { SubmissionViewerDrawer } from '@/features/subjects-real/submission-viewer-drawer'
import { buildAssignmentDetailPath, buildSubjectClassroomTabPath } from '@/features/subjects-shared/subject-classroom-nav'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import {
  ASSIGNMENT_DETAIL_FILTERS,
  archiveAssignment,
  bulkFillWouldOverwrite,
  computeGradedTally,
  deriveAssignmentRoster,
  filterActiveAssignmentsForSwitcher,
  filterRosterByStatus,
  findSwitcherIndex,
  getAssignmentById,
  getAssignments,
  getNextAssignment,
  getPreviousAssignment,
  getSubmissionSummary,
  getSubmissions,
  mergeSubmissionsWithDefaults,
  nextScoreFocusIndex,
  nextStatusAfterScore,
  parseScoreInput,
  planScorePaste,
  searchRoster,
  setSubmissionNote,
  setSubmissionScore,
  setSubmissionStatus,
  updateAssignment,
  validateMaxScoreChange,
  type AssignmentDetailFilter,
} from '@/services/assignment-service'
import { getClassroomById } from '@/services/classroom-service'
import { getStudentsByClassroom } from '@/services/student-service'
import { getSubjectById } from '@/services/subject-service'
import { getSubmissionResourceCounts } from '@/services/submission-service'
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

type SaveState = 'saving' | 'saved' | 'error'

function studentLabel(student: { firstName: string; lastName: string } | undefined, fallbackId: string): string {
  return student ? `${student.firstName} ${student.lastName}` : fallbackId
}

/**
 * Real, Supabase-backed assignment detail workspace — header (title,
 * subject, classroom, due date, description, status, edit/archive),
 * "สื่อและใบงาน" resources, a REAL classroom roster with submission
 * status + score entry, and filters/search over that roster. Everything
 * here reads through assignments / assignment_resources /
 * assignment_submissions / classroom_students / students — no demo/mock
 * fallback anywhere.
 *
 * Loading is split into two INDEPENDENT sections on purpose (see the
 * task's "error isolation" requirement): loadHeader() resolves the
 * assignment plus its subject/classroom names, loadRoster() resolves the
 * classroom roster + submissions. A failure in either leaves the other
 * section rendering normally — e.g. a roster load failure never blanks
 * the header or the resources section, and a header load failure (rare —
 * it's the same query that already gates the whole page's identity
 * check) never blocks the resources section, which manages its own
 * loading/error state entirely on its own (AssignmentResourcesSection).
 *
 * Unlike the standalone Attendance page, there's no batch "Save" step for
 * submissions: each status click and each score/note edit (committed on
 * blur, to avoid a network round trip per keystroke) persists immediately
 * via assignment-service.ts. Score entry supports Enter-to-next-row,
 * Arrow Up/Down navigation, pasting a multi-row column copied from
 * Excel/Sheets, and a bulk-fill action for the currently checkbox-
 * selected students — all built on the same setSubmissionScore/
 * parseScoreInput used by a single-cell edit, never a second, competing
 * write path. Filtering/searching only narrows what the TABLE shows —
 * the summary counts above it always reflect the full roster
 * (computeGradedTally/getSubmissionSummary are always called with the
 * full, unfiltered roster).
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
  const [subjectName, setSubjectName] = useState<string | null>(null)
  const [classroomName, setClassroomName] = useState<string | null>(null)
  const [headerLoading, setHeaderLoading] = useState(true)
  const [headerError, setHeaderError] = useState<string | null>(null)

  /** Every ACTIVE (non-archived) assignment in this exact subject+
   * classroom, in the same order the งาน tab itself shows them
   * (getAssignments' own `created_at` ascending ordering — never
   * re-sorted here) — powers both the "งานอื่นในห้องนี้" switcher and
   * งานก่อนหน้า/งานถัดไป. Loaded independently of the header/roster
   * (Section 5's error-isolation convention): a failure here only
   * disables the switcher, never blocks the rest of the page. Reuses
   * the exact same RLS-scoped assignment-service.ts query the tab
   * already uses — no new query shape, no N+1, no other
   * subject/classroom ever fetched. */
  const [siblingAssignments, setSiblingAssignments] = useState<Assignment[]>([])
  const [siblingsError, setSiblingsError] = useState<string | null>(null)

  const [students, setStudents] = useState<ClassroomStudent[]>([])
  const [submissions, setSubmissions] = useState<Record<string, AssignmentSubmission>>({})
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({})
  const [rosterLoading, setRosterLoading] = useState(true)
  const [rosterError, setRosterError] = useState<string | null>(null)

  /** submissionId -> resource count. Loaded independently of the roster
   * itself (Section 10: "if submission file loading fails, teacher must
   * still see student/status/score") — a failure here just means every
   * "งานออนไลน์" cell falls back to "-", never blanks the roster. */
  const [resourceCounts, setResourceCounts] = useState<Record<string, number>>({})
  const [viewerStudentId, setViewerStudentId] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<AssignmentDetailFilter>('all')
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const [editOpen, setEditOpen] = useState(false)
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)

  /** Bumped whenever a score entry is rejected as out-of-range, forcing
   * the (uncontrolled, defaultValue-based) score input to remount and
   * revert to the last saved value even when that saved value itself
   * didn't change. Also bumped after a successful paste/bulk-fill so
   * every affected cell re-reads its new value from `submissions`. */
  const [scoreResetTick, setScoreResetTick] = useState(0)
  /** Per-field "กำลังบันทึก.../บันทึกแล้ว/เกิดข้อผิดพลาด" indicator, shared
   * across score/status/note editing — keyed `${kind}:${studentId}` (e.g.
   * `score:s1`, `status:s1`, `note:s1`) so each field's indicator is
   * independent even for the same student. Cleared back to idle (key
   * absent) a moment after a successful save. */
  const [fieldSaveState, setFieldSaveState] = useState<Record<string, SaveState>>({})
  const scoreInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const saveStateTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const [maxScoreError, setMaxScoreError] = useState<string | null>(null)
  const [maxScoreResetTick, setMaxScoreResetTick] = useState(0)

  const [bulkFillOpen, setBulkFillOpen] = useState(false)
  const [bulkFillScore, setBulkFillScore] = useState('')
  const [bulkFillError, setBulkFillError] = useState<string | null>(null)
  const [bulkFillConfirmOpen, setBulkFillConfirmOpen] = useState(false)
  const [bulkFillPendingValue, setBulkFillPendingValue] = useState<number | null>(null)

  const loadHeader = useCallback(() => {
    if (!assignmentId) return undefined
    setHeaderLoading(true)
    setHeaderError(null)
    return getAssignmentById(assignmentId)
      .then(async (assignmentRow) => {
        setAssignment(assignmentRow)
        if (!assignmentRow) return
        const [subject, classroom] = await Promise.all([
          getSubjectById(assignmentRow.subjectId).catch(() => null),
          getClassroomById(assignmentRow.classroomId).catch(() => null),
        ])
        setSubjectName(subject?.name ?? null)
        setClassroomName(classroom?.name ?? null)
      })
      .catch((err: unknown) => setHeaderError(toFriendlyErrorMessage(err)))
      .finally(() => setHeaderLoading(false))
  }, [assignmentId])

  const loadRoster = useCallback(() => {
    if (!assignmentId || !classroomId) return undefined
    setRosterLoading(true)
    setRosterError(null)
    return Promise.all([getStudentsByClassroom(classroomId), getSubmissions(assignmentId)])
      .then(async ([classroomStudents, submissionRows]) => {
        setStudents(classroomStudents)
        const activeIds = classroomStudents.filter((s) => s.status === 'active').map((s) => s.id)
        const merged = mergeSubmissionsWithDefaults(activeIds, submissionRows)
        setSubmissions(merged)
        setNoteDrafts(Object.fromEntries(Object.entries(merged).map(([id, s]) => [id, s.note ?? ''])))

        // Best-effort enrichment only — a resource-count lookup failure
        // must never block the roster (student/status/score) from
        // rendering, so it always falls back to an empty map.
        const submissionIds = Object.values(merged)
          .map((s) => s.id)
          .filter((id): id is string => Boolean(id))
        const counts = await getSubmissionResourceCounts(submissionIds).catch(() => ({}))
        setResourceCounts(counts)
      })
      .catch((err: unknown) => setRosterError(toFriendlyErrorMessage(err)))
      .finally(() => setRosterLoading(false))
  }, [assignmentId, classroomId])

  useEffect(() => {
    loadHeader()
  }, [loadHeader])

  useEffect(() => {
    loadRoster()
  }, [loadRoster])

  useEffect(() => {
    if (!subjectId || !classroomId) return
    let active = true
    setSiblingsError(null)
    getAssignments(subjectId, classroomId)
      .then((rows) => {
        if (active) setSiblingAssignments(filterActiveAssignmentsForSwitcher(rows))
      })
      .catch((err: unknown) => {
        if (active) setSiblingsError(toFriendlyErrorMessage(err))
      })
    return () => {
      active = false
    }
  }, [subjectId, classroomId])

  useEffect(() => {
    const timers = saveStateTimers.current
    return () => {
      Object.values(timers).forEach(clearTimeout)
    }
  }, [])

  if (!subjectId || !classroomId || !assignmentId) {
    return <Navigate to="/teacher/subjects" replace />
  }

  if (assignment === undefined || headerLoading) {
    return <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
  }

  // Closes the "type a mismatched subject/classroom id into the URL"
  // path — an assignment that doesn't actually belong to this exact
  // subject+classroom bounces back to the workspace instead of silently
  // rendering it under the wrong classroom. This is also what blocks
  // cross-teacher access: getAssignmentById is scoped by RLS
  // (assignments_select_own, 0006) to assignments the caller's own
  // classroom owns, so a URL naming another teacher's assignment id
  // resolves to `null` here, same as any other not-found id.
  if (!assignment || assignment.subjectId !== subjectId || assignment.classroomId !== classroomId) {
    return <Navigate to={`/teacher/subjects/${subjectId}/classrooms/${classroomId}`} replace />
  }

  const currentAssignmentId = assignmentId as string
  // Same reasoning as currentAssignmentId above: TS doesn't carry the
  // `!assignment` narrowing above into a nested function declared later
  // (handleScoreBlur, etc.), so it's re-asserted here once.
  const currentAssignment = assignment as Assignment

  // งานก่อนหน้า/งานถัดไป/งานอื่นในห้องนี้ — derived from siblingAssignments
  // (already scoped to this exact subject+classroom, active only, in the
  // งาน tab's own order). If the currently-viewed assignment is itself
  // archived, it simply has no entry here (currentIndex === -1) and
  // prev/next/the switcher's "current" mark are all correctly absent —
  // never wraps from last to first.
  const currentSiblingIndex = findSwitcherIndex(siblingAssignments, currentAssignmentId)
  const previousAssignment = getPreviousAssignment(siblingAssignments, currentAssignmentId)
  const nextAssignment = getNextAssignment(siblingAssignments, currentAssignmentId)

  // Same reasoning as currentAssignmentId above: TS doesn't carry the
  // early-return narrowing into a nested function.
  const currentSubjectId = subjectId as string
  const currentClassroomId = classroomId as string

  function goToAssignment(id: string) {
    navigate(buildAssignmentDetailPath(currentSubjectId, currentClassroomId, id))
  }

  const roster = deriveAssignmentRoster(students, submissions)
  const rosterSubmissions: Record<string, AssignmentSubmission> = {}
  for (const student of roster) {
    if (submissions[student.id]) rosterSubmissions[student.id] = submissions[student.id]
  }
  // Summary counts always reflect the FULL roster — never narrowed by
  // statusFilter/search below, which only affect the table's visible rows.
  const summary = getSubmissionSummary(rosterSubmissions)
  const gradedTally = computeGradedTally(
    roster.map((s) => s.id),
    submissions,
  )

  const visibleRoster = searchRoster(filterRosterByStatus(roster, submissions, statusFilter), search)
  const allSelected = selectedIds.length > 0 && selectedIds.length === visibleRoster.length

  function toggleSelectAll() {
    setSelectedIds(allSelected ? [] : visibleRoster.map((s) => s.id))
  }

  function toggleSelect(studentId: string) {
    setSelectedIds((prev) => (prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]))
  }

  function defaultSubmission(studentId: string): AssignmentSubmission {
    return { studentId, status: 'not_submitted', score: null, note: null }
  }

  function setFieldSaveStateFor(key: string, state: SaveState) {
    const existingTimer = saveStateTimers.current[key]
    if (existingTimer) {
      clearTimeout(existingTimer)
      delete saveStateTimers.current[key]
    }
    setFieldSaveState((prev) => ({ ...prev, [key]: state }))
    if (state === 'saved') {
      saveStateTimers.current[key] = setTimeout(() => {
        setFieldSaveState((prev) => {
          const next = { ...prev }
          delete next[key]
          return next
        })
      }, 1500)
    }
  }

  function setScoreSaveStateFor(studentId: string, state: SaveState) {
    setFieldSaveStateFor(`score:${studentId}`, state)
  }

  async function handleSetStatus(studentId: string, status: SubmissionStatus) {
    setFieldSaveStateFor(`status:${studentId}`, 'saving')
    try {
      await setSubmissionStatus(currentAssignmentId, studentId, status)
      setSubmissions((prev) => ({
        ...prev,
        [studentId]: { ...(prev[studentId] ?? defaultSubmission(studentId)), status },
      }))
      setFieldSaveStateFor(`status:${studentId}`, 'saved')
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกสถานะได้'))
      setFieldSaveStateFor(`status:${studentId}`, 'error')
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

    const targetIndex = nextScoreFocusIndex(e.key, rowIndex, visibleRoster.length)

    if (e.key === 'Enter') {
      e.preventDefault()
      // onBlur (already wired below) fires from this and persists the
      // current value — Enter just needs to trigger that and move on. On
      // the last row, targetIndex === rowIndex, so this simply re-focuses
      // the same (now-saved) cell instead of nowhere.
      e.currentTarget.blur()
      const targetId = visibleRoster[targetIndex]?.id ?? studentId
      requestAnimationFrame(() => scoreInputRefs.current[targetId]?.focus())
      return
    }

    // ArrowDown/ArrowUp: only intercept the native number-input
    // spinner behavior when this actually moves focus to another row.
    if (targetIndex !== rowIndex) {
      e.preventDefault()
      const targetId = visibleRoster[targetIndex]?.id
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
      visibleRoster.map((s) => s.id),
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
    const orderedSelected = visibleRoster.filter((s) => selectedIds.includes(s.id))
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
    setFieldSaveStateFor(`note:${studentId}`, 'saving')
    try {
      await setSubmissionNote(currentAssignmentId, studentId, note)
      setSubmissions((prev) => ({
        ...prev,
        [studentId]: { ...(prev[studentId] ?? defaultSubmission(studentId)), note: note || null },
      }))
      setFieldSaveStateFor(`note:${studentId}`, 'saved')
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกหมายเหตุได้'))
      // Deliberately does NOT revert noteDrafts[studentId] — the teacher's
      // typed value stays visible in the (controlled) input so a failed
      // save never silently discards their edit; blurring again retries
      // the same write.
      setFieldSaveStateFor(`note:${studentId}`, 'error')
    }
  }

  async function handleArchive() {
    try {
      const updated = await archiveAssignment(currentAssignmentId)
      setAssignment(updated)
      toast('เก็บถาวรงานแล้ว')
      setArchiveConfirmOpen(false)
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถเก็บถาวรงานได้'))
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <button
          type="button"
          onClick={() => navigate(buildSubjectClassroomTabPath(subjectId, classroomId, 'assignments'))}
          className="mb-2 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          กลับไปหน้างาน
        </button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{currentAssignment.title}</h1>
              <Badge variant={currentAssignment.isArchived ? 'outline' : 'success'}>
                {currentAssignment.isArchived ? 'เก็บถาวร' : 'ใช้งานอยู่'}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {subjectName ?? '-'} · {classroomName ?? '-'}
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={!previousAssignment}
                onClick={() => previousAssignment && goToAssignment(previousAssignment.id)}
                aria-label="งานก่อนหน้า"
              >
                <ChevronLeft className="size-3.5" />
                งานก่อนหน้า
              </Button>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                งานอื่นในห้องนี้:
                <NativeSelect
                  value={currentAssignmentId}
                  onChange={(e) => goToAssignment(e.target.value)}
                  className="w-auto max-w-[220px]"
                  aria-label="งานอื่นในห้องนี้"
                  disabled={siblingAssignments.length === 0}
                >
                  {currentSiblingIndex === -1 && <option value={currentAssignmentId}>{currentAssignment.title}</option>}
                  {siblingAssignments.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.id === currentAssignmentId ? '✓ ' : ''}
                      {a.title}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <Button
                variant="outline"
                size="sm"
                disabled={!nextAssignment}
                onClick={() => nextAssignment && goToAssignment(nextAssignment.id)}
                aria-label="งานถัดไป"
              >
                งานถัดไป
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                แก้ไขงาน
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={currentAssignment.isArchived}
                onClick={() => setArchiveConfirmOpen(true)}
              >
                เก็บถาวรงาน
              </Button>
            </div>
          </div>
        </div>
        {siblingsError && <p className="mt-1 text-xs text-destructive">{siblingsError}</p>}

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
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
          {currentAssignment.dueDate && <span>กำหนดส่ง {currentAssignment.dueDate}</span>}
        </div>
        {maxScoreError && <p className="mt-1 text-sm text-destructive">{maxScoreError}</p>}
        {currentAssignment.description && <p className="mt-1 text-sm text-muted-foreground">{currentAssignment.description}</p>}
        {headerError && <p className="mt-1 text-sm text-destructive">{headerError}</p>}
      </div>

      <AssignmentResourcesSection assignmentId={currentAssignmentId} subjectId={subjectId} classroomId={classroomId} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">สรุปการส่งงาน</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">นักเรียนทั้งหมด</span>
            <span className="font-semibold">{gradedTally.total}</span>
          </div>
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
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">ตรวจแล้ว / ยังไม่ตรวจ</span>
            <span className="font-semibold">
              {gradedTally.graded} / {gradedTally.notGraded}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2 border-l border-border pl-6">
            <span className="text-muted-foreground">คะแนนเฉลี่ย</span>
            <span className="font-semibold">
              {summary.average !== null ? summary.average.toFixed(1) : '-'}/{currentAssignment.maxScore}
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 overflow-x-auto">
          {ASSIGNMENT_DETAIL_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              className={cn(
                'shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                statusFilter === f.key
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหานักเรียน..."
            className="h-8 pl-8"
          />
        </div>
      </div>

      {rosterError && <p className="text-sm text-destructive">{rosterError}</p>}

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
                  <th className="px-3 py-3 font-medium">นักเรียน</th>
                  <th className="px-3 py-3 font-medium">สถานะ</th>
                  <th className="px-3 py-3 font-medium">งานออนไลน์</th>
                  <th className="px-3 py-3 font-medium">คะแนน</th>
                  <th className="px-3 py-3 font-medium">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {rosterLoading ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-6 text-center text-muted-foreground">
                      กำลังโหลด...
                    </td>
                  </tr>
                ) : roster.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-6 text-center text-muted-foreground">
                      ยังไม่มีนักเรียนในห้องเรียนนี้
                    </td>
                  </tr>
                ) : visibleRoster.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-6 text-center text-muted-foreground">
                      ไม่พบนักเรียนตามเงื่อนไขที่เลือก
                    </td>
                  </tr>
                ) : (
                  visibleRoster.map((student, rowIndex) => {
                    const submission = submissions[student.id] ?? {
                      studentId: student.id,
                      status: 'not_submitted' as SubmissionStatus,
                      score: null,
                      note: null,
                    }
                    const scoreSaveState = fieldSaveState[`score:${student.id}`]
                    const statusSaveState = fieldSaveState[`status:${student.id}`]
                    const noteSaveState = fieldSaveState[`note:${student.id}`]
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
                          <div className="flex flex-col gap-0.5">
                            <div className="flex flex-wrap gap-1.5">
                              {STATUS_ORDER.map((status) => (
                                <button
                                  key={status}
                                  type="button"
                                  data-active={submission.status === status}
                                  onClick={() => handleSetStatus(student.id, status)}
                                  disabled={statusSaveState === 'saving'}
                                  className={cn(
                                    'rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50',
                                    STATUS_BUTTON_STYLE[status],
                                  )}
                                >
                                  {STATUS_LABEL[status]}
                                </button>
                              ))}
                            </div>
                            {statusSaveState === 'saving' && (
                              <span className="text-[11px] text-muted-foreground">กำลังบันทึก...</span>
                            )}
                            {statusSaveState === 'saved' && <span className="text-[11px] text-success">บันทึกแล้ว</span>}
                            {statusSaveState === 'error' && (
                              <span className="text-[11px] text-destructive">บันทึกไม่สำเร็จ</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {submission.id ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setViewerStudentId(student.id)}
                            >
                              {(resourceCounts[submission.id] ?? 0) > 0
                                ? `${resourceCounts[submission.id]} ไฟล์`
                                : 'เปิดดู'}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
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
                            {scoreSaveState === 'saving' && (
                              <span className="text-[11px] text-muted-foreground">กำลังบันทึก...</span>
                            )}
                            {scoreSaveState === 'saved' && <span className="text-[11px] text-success">บันทึกแล้ว</span>}
                            {scoreSaveState === 'error' && (
                              <span className="text-[11px] text-destructive">บันทึกไม่สำเร็จ</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-0.5">
                            <Input
                              value={noteDrafts[student.id] ?? ''}
                              onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [student.id]: e.target.value }))}
                              onBlur={() => handleNoteBlur(student.id)}
                              placeholder="หมายเหตุ"
                              className="h-8 w-36"
                            />
                            {noteSaveState === 'saving' && (
                              <span className="text-[11px] text-muted-foreground">กำลังบันทึก...</span>
                            )}
                            {noteSaveState === 'saved' && <span className="text-[11px] text-success">บันทึกแล้ว</span>}
                            {noteSaveState === 'error' && (
                              <span className="text-[11px] text-destructive">บันทึกไม่สำเร็จ กรุณาลองใหม่</span>
                            )}
                          </div>
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

      <AssignmentDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        subjectId={subjectId}
        classroomId={classroomId}
        assignment={currentAssignment}
        hideResourcesSection
        disableMaxScoreEdit
        onSaved={() => {
          setEditOpen(false)
          loadHeader()
        }}
      />

      <ConfirmDialog
        open={archiveConfirmOpen}
        onOpenChange={setArchiveConfirmOpen}
        title="เก็บถาวรงาน"
        description={`เก็บถาวร "${currentAssignment.title}"?\nงานและคะแนนของนักเรียนจะยังคงอยู่ในระบบ`}
        confirmLabel="เก็บถาวร"
        onConfirm={handleArchive}
      />

      <SubmissionViewerDrawer
        open={Boolean(viewerStudentId)}
        onOpenChange={(open) => !open && setViewerStudentId(null)}
        studentName={viewerStudentId ? studentLabel(roster.find((s) => s.id === viewerStudentId), viewerStudentId) : ''}
        submission={viewerStudentId ? (submissions[viewerStudentId] ?? null) : null}
        maxScore={currentAssignment.maxScore}
      />
    </div>
  )
}
