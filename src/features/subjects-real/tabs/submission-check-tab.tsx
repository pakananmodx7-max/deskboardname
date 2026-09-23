import { AlertTriangle, CheckCircle2, Plus, Search, Users, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RowActionsMenu } from '@/components/ui/row-actions-menu'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { AssignmentDialog } from '@/features/subjects-real/assignment-dialog'
import { CopyAssignmentDialog } from '@/features/subjects-real/copy-assignment-dialog'
import { buildAssignmentDetailPath } from '@/features/subjects-shared/subject-classroom-nav'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import {
  SUBMISSION_CELL_STATE_LABEL,
  SUBMISSION_CHECK_MODE_COUNT_LABEL,
  SUBMISSION_CHECK_MODES,
  archiveAssignment,
  computeCellDisplay,
  computeExpectedItemCount,
  computeModeItemCount,
  computeSubmissionCellState,
  computeSubmittedMissingSplit,
  deleteAssignmentPermanently,
  deriveGradeRoster,
  filterStudentsByCheckMode,
  filterSubmittedStudentIds,
  getAssignments,
  getSubmissions,
  hasAssignmentSubmissions,
  nextStatusAfterScore,
  parseBulkScoreInput,
  parseScoreInput,
  searchAssignmentsByTitle,
  setSubmissionNote,
  setSubmissionScore,
  setSubmissionStatus,
  type CellDisplay,
  type SubmissionCheckMode,
} from '@/services/assignment-service'
import { bulkSetAssignmentScores, buildBulkScoreUpdates } from '@/services/score-bulk-service'
import { afterSourceScoresSaved } from '@/services/sgs-score-auto-service'
import { getStudentsByClassroom } from '@/services/student-service'
import { bulkMarkSubmissionStatus, buildBulkSubmissionStatusUpdates } from '@/services/submission-bulk-service'
import type { Assignment, AssignmentCopyOutcome, AssignmentSubmission, SubmissionStatus } from '@/types/assignment'
import type { Subject } from '@/types/subject'
import type { ClassroomStudent } from '@/types/student'

interface SubmissionCheckTabProps {
  subject: Subject
  classroomId: string
}

interface SubmissionTarget {
  assignment: Assignment
  student: ClassroomStudent
}

/** The 3 statuses a teacher can explicitly set from either the per-cell
 * dialog or a bulk action — 'not_submitted' is never an explicit target
 * (there is nothing to "mark" back to the default; a row/cell simply
 * starts there until something else happens to it), matching this
 * codebase's existing STATUS_ORDER convention on the assignment detail
 * page (subject-classroom-assignment-detail-page-real.tsx). */
const STATUS_ACTIONS: { key: SubmissionStatus; label: string }[] = [
  { key: 'submitted', label: 'ส่งแล้ว' },
  { key: 'late', label: 'ส่งช้า' },
  { key: 'missing', label: 'ขาดส่ง' },
]

/** The ONE bulk-status action available in each of the 2 non-scoring
 * modes — the mode itself names exactly what a bulk write in that mode
 * means, so there is no separate multi-button status picker to choose
 * from here (unlike the per-cell dialog above, which still exposes all
 * 3 real statuses for a single row's own correction). */
const MODE_BULK_STATUS_ACTION: Record<'submitted' | 'missing', { status: SubmissionStatus; label: string }> = {
  submitted: { status: 'submitted', label: 'ทำเครื่องหมายว่าส่งแล้ว' },
  missing: { status: 'missing', label: 'ทำเครื่องหมายว่าขาดส่ง' },
}

function studentDisplayName(student: ClassroomStudent): string {
  return `${student.number ?? '-'}. ${student.firstName} ${student.lastName}`
}

/**
 * ตรวจสอบงาน — the ONE spreadsheet-style student × assignment workspace
 * for checking submissions and grading, replacing the old "open one
 * assignment at a time" workflow for routine checking (the assignment
 * detail page itself — subject-classroom-assignment-detail-page-real.tsx
 * — still exists unchanged, reachable from the งาน tab/card menu, for
 * resource management and cross-classroom copy; nothing here deletes
 * that route). Reads the exact same `assignments` + `assignment_submissions`
 * data as งาน/คะแนน (via getAssignments/getSubmissions) — no new table,
 * no mock data, no invented database status.
 *
 * ONE master matrix — a SINGLE cell rendering (computeCellDisplay) shows
 * BOTH submission status and score together, in every mode: a submitted
 * cell is always a green ✓ plus its score (a "—" placeholder when not
 * yet graded, the literal "0" for an explicit zero — never conflated),
 * and a missing cell (explicit 'missing', explicit 'not_submitted', or
 * no submission row at all) is always red "ขาดส่ง" with no score field
 * at all. There is no separate score-only "ให้คะแนน" mode/page — grading
 * always happens in place, without navigating away from this matrix.
 *
 * Exactly 3 MODES (SUBMISSION_CHECK_MODES) — ทั้งหมด / ส่งแล้ว / ขาดส่ง,
 * defaulting to ทั้งหมด — control ONLY which student ROWS are visible
 * (filterStudentsByCheckMode) and the top counter (computeModeItemCount);
 * they never change what a visible cell shows, which is exactly what
 * replaced the old bug where a row kept because ONE assignment matched a
 * filter would still render a DIFFERENT assignment's real (mismatched)
 * state. ทั้งหมด shows the full roster; ส่งแล้ว/ขาดส่ง narrow the rows to
 * students with at least one matching assignment in scope. There is no
 * reviewed/checked/awaiting-review mode or state anywhere — never an
 * intermediate holding status between submitted and scored.
 *
 * "+ สร้างงาน" creates an assignment through the EXACT SAME
 * createAssignment (via AssignmentDialog) the งาน tab uses, then
 * refresh() re-fetches and the new assignment appears as a new column —
 * no navigation away from this page.
 *
 * Bulk actions (a whole column, a student/assignment multi-selection)
 * go through bulkMarkSubmissionStatus — the SAME mark_submission_status_bulk
 * tool Hermes calls, chunked at its own max batch size, never one
 * request per student. A single cell's status/score/note edit stays on
 * the existing lightweight setSubmissionStatus/setSubmissionScore/
 * setSubmissionNote upserts (already the production write path used
 * everywhere else in this app) — there is exactly one source of truth
 * (assignment_submissions) either way, so a change from Hermes, from a
 * bulk action here, or from a single-cell edit are all indistinguishable
 * on the next refresh().
 */
export function SubmissionCheckTab({ subject, classroomId }: SubmissionCheckTabProps) {
  const { toast } = useToast()
  const navigate = useNavigate()

  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [students, setStudents] = useState<ClassroomStudent[]>([])
  const [submissionsByAssignment, setSubmissionsByAssignment] = useState<
    Record<string, Record<string, AssignmentSubmission>>
  >({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [mode, setMode] = useState<SubmissionCheckMode>('all')
  const [assignmentQuery, setAssignmentQuery] = useState('')

  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set())
  const [selectedAssignmentIds, setSelectedAssignmentIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const [bulkScoreDraft, setBulkScoreDraft] = useState('')
  const [bulkScoreError, setBulkScoreError] = useState<string | null>(null)
  const [pendingBulkGrade, setPendingBulkGrade] = useState<{ assignment: Assignment; studentIds: string[]; score: number } | null>(
    null,
  )
  const [bulkScoreResult, setBulkScoreResult] = useState<{
    changedCount: number
    unchangedCount: number
    failedCount: number
    failures: { studentName: string; message: string }[]
  } | null>(null)
  const [bulkStatusResult, setBulkStatusResult] = useState<{
    changedCount: number
    unchangedCount: number
    failedCount: number
    failures: { studentName: string; assignmentTitle: string; message: string }[]
  } | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null)
  const [copyingAssignment, setCopyingAssignment] = useState<Assignment | null>(null)
  const [archivingAssignment, setArchivingAssignment] = useState<Assignment | null>(null)
  const [checkingDeleteId, setCheckingDeleteId] = useState<string | null>(null)
  const [deletingAssignment, setDeletingAssignment] = useState<{ assignment: Assignment; hasSubmissions: boolean } | null>(null)

  const [target, setTarget] = useState<SubmissionTarget | null>(null)
  const [statusDraft, setStatusDraft] = useState<SubmissionStatus>('not_submitted')
  const [scoreDraft, setScoreDraft] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
  const [targetError, setTargetError] = useState<string | null>(null)
  const [savingTarget, setSavingTarget] = useState(false)

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

  // The top counter and the row filter both reflect the CURRENTLY
  // SEARCHED assignment columns, not every assignment ever created — so
  // the number on screen always matches what's actually shown in the
  // matrix below, whether or not the assignment search box narrowed it.
  // The counter is always an ITEM count (one (student, assignment) cell
  // = one item), computed over the FULL roster regardless of the row
  // filter below, so it stays mathematically honest even once
  // 'submitted'/'missing' mode hides some rows.
  //
  // ทั้งหมด has no single count of its own — it's the whole expected
  // matrix (students × assignments) split into submitted vs. ขาดส่ง, so
  // its summary combines two computeModeItemCount calls with
  // computeExpectedItemCount rather than taking one mode-specific count.
  const rosterIds = roster.map((s) => s.id)
  const modeItemCount =
    mode === 'all' ? 0 : computeModeItemCount(rosterIds, visibleAssignmentIds, submissionsByAssignment, mode)
  // Computed unconditionally (not just while ทั้งหมด is active) so the
  // segmented mode switcher below can show a real, honest count on
  // EVERY mode pill at once — never a fabricated number, always this
  // same pure computeModeItemCount/computeExpectedItemCount math.
  const modeSubmittedCount = computeModeItemCount(rosterIds, visibleAssignmentIds, submissionsByAssignment, 'submitted')
  const modeMissingCount = computeModeItemCount(rosterIds, visibleAssignmentIds, submissionsByAssignment, 'missing')
  const modeExpectedCount = computeExpectedItemCount(rosterIds, visibleAssignmentIds)
  const filteredRoster = filterStudentsByCheckMode(roster, visibleAssignmentIds, submissionsByAssignment, mode)

  const rosterKey = roster.map((s) => s.id).join(',')
  const assignmentIdsKey = visibleAssignmentIds.join(',')
  useEffect(() => {
    // A stale selection can never silently target a row/column that no
    // longer exists (or no longer means what the teacher thinks it
    // does) once the roster or the assignment set actually changes —
    // e.g. right after creating/archiving/deleting an assignment.
    setSelectedStudentIds(new Set())
    setSelectedAssignmentIds(new Set())
  }, [rosterKey, assignmentIdsKey])

  function toggleStudentSelected(studentId: string) {
    setSelectedStudentIds((prev) => {
      const next = new Set(prev)
      if (next.has(studentId)) next.delete(studentId)
      else next.add(studentId)
      return next
    })
  }

  function toggleAssignmentSelected(assignmentId: string) {
    setSelectedAssignmentIds((prev) => {
      const next = new Set(prev)
      if (next.has(assignmentId)) next.delete(assignmentId)
      else next.add(assignmentId)
      return next
    })
  }

  function toggleSelectAllVisible() {
    setSelectedStudentIds((prev) => {
      const allSelected = filteredRoster.length > 0 && filteredRoster.every((s) => prev.has(s.id))
      return allSelected ? new Set() : new Set(filteredRoster.map((s) => s.id))
    })
  }

  function clearSelection() {
    setSelectedStudentIds(new Set())
    setSelectedAssignmentIds(new Set())
  }

  const allVisibleSelected = filteredRoster.length > 0 && filteredRoster.every((s) => selectedStudentIds.has(s.id))
  const selectionCellCount = selectedStudentIds.size * selectedAssignmentIds.size

  // The bulk GRADING bar (as opposed to the status quick actions above,
  // which can target several assignment columns at once) only ever
  // targets exactly ONE assignment — a score is meaningless without
  // knowing which assignment's max score it's bounded by.
  const singleSelectedAssignmentId = selectedAssignmentIds.size === 1 ? Array.from(selectedAssignmentIds)[0] : null
  const singleSelectedAssignment = singleSelectedAssignmentId
    ? (visibleAssignments.find((a) => a.id === singleSelectedAssignmentId) ?? null)
    : null

  // Drives the "ส่งแล้ว N · ขาดส่ง M" readout in the bulk grading bar —
  // always computed over the CURRENT selection × the one selected
  // assignment, so it reflects exactly which of the selected students
  // will actually be graded (never the whole roster/classroom).
  const selectionSubmittedMissingSplit = singleSelectedAssignmentId
    ? computeSubmittedMissingSplit(Array.from(selectedStudentIds), singleSelectedAssignmentId, submissionsByAssignment)
    : { submittedCount: 0, missingCount: 0 }

  useEffect(() => {
    // A score typed for one assignment must never silently carry over to
    // a different one once the selection changes (its max score may
    // differ entirely).
    setBulkScoreDraft('')
    setBulkScoreError(null)
  }, [singleSelectedAssignmentId])

  // Distinct from "select all visible" (the header checkbox, which
  // respects the current mode's row filter): this always selects the
  // FULL roster regardless of what's currently shown/searched.
  function handleSelectEntireClassroom() {
    setSelectedStudentIds(new Set(roster.map((s) => s.id)))
  }

  /**
   * The one place any bulk status change actually runs — column quick
   * actions ("ส่งแล้วทั้งห้อง"/"ขาดส่งทั้งห้อง") and the multi-select bulk
   * bar's own "สถานะงาน" group (available in EVERY mode, not just
   * ส่งแล้ว/ขาดส่ง) both call this with their own (studentIds,
   * assignmentIds) pair. Builds the FULL (student × assignment) cross
   * product regardless of how many assignments are selected — "8
   * นักเรียน × 3 งาน" becomes 24 updates in one call, chunked internally
   * by bulkMarkSubmissionStatus at its own max batch size, never one
   * request per student. Only ever writes `status` — never touches
   * `score`, so a bulk "ส่งแล้ว" can never create a score and a bulk
   * "ขาดส่ง" can never create/force a score of 0. RE-FETCHES the matrix
   * from the real source of truth after the write (the same pattern
   * runBulkScoreUpdate already uses) so the teacher always sees the
   * actual server state, then reports a concise, honest result —
   * changed/unchanged/failed counts, with every failure named — via
   * bulkStatusResult, a persistent dismissible panel, not just a toast.
   */
  async function runBulkStatusUpdate(studentIds: string[], assignmentIds: string[], status: SubmissionStatus) {
    if (studentIds.length === 0 || assignmentIds.length === 0) return
    const updates = buildBulkSubmissionStatusUpdates(studentIds, assignmentIds, status)
    setBulkBusy(true)
    setBulkStatusResult(null)
    try {
      const result = await bulkMarkSubmissionStatus(updates)
      await refresh()

      setBulkStatusResult({
        changedCount: result.changedCount,
        unchangedCount: result.unchangedCount,
        failedCount: result.failedCount,
        failures: result.failures.map((f) => {
          const student = roster.find((s) => s.id === f.studentId)
          const assignment = assignments.find((a) => a.id === f.assignmentId)
          return {
            studentName: student ? studentDisplayName(student) : f.studentId,
            assignmentTitle: assignment ? assignment.title : f.assignmentId,
            message: f.message,
          }
        }),
      })

      if (result.failedCount === 0) {
        toast(`บันทึกสถานะสำเร็จ ${result.changedCount} รายการ`)
      } else {
        toast(`บันทึกสถานะสำเร็จ ${result.changedCount} รายการ — ไม่สำเร็จ ${result.failedCount} รายการ`)
      }
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถอัปเดตสถานะได้'))
    } finally {
      setBulkBusy(false)
    }
  }

  function handleColumnQuickAction(assignment: Assignment, status: SubmissionStatus) {
    runBulkStatusUpdate(
      roster.map((s) => s.id),
      [assignment.id],
      status,
    )
  }

  function handleSelectionBulkAction(status: SubmissionStatus) {
    runBulkStatusUpdate(Array.from(selectedStudentIds), Array.from(selectedAssignmentIds), status)
  }

  function handleBulkScoreFullMark() {
    if (!singleSelectedAssignment) return
    setBulkScoreDraft(String(singleSelectedAssignment.maxScore))
    setBulkScoreError(null)
  }

  /**
   * "ให้คะแนนคนที่ส่งแล้ว": validates the bulk score draft
   * (parseBulkScoreInput — same 0 <= score <= maxScore bound as the
   * per-cell dialog, but blank is rejected here since bulk grading
   * always assigns a specific score), then narrows the selection down to
   * only the SUBMITTED students via filterSubmittedStudentIds — a
   * missing student in the same selection is always skipped, never
   * assigned a 0 or any score — before opening the required confirmation
   * step ("กำลังให้คะแนน X/max แก่นักเรียน N คน", N already reflecting
   * only the submitted count).
   */
  function handleOpenBulkGradeConfirm() {
    if (!singleSelectedAssignment || selectedStudentIds.size === 0) return
    const { value, error: validationError } = parseBulkScoreInput(bulkScoreDraft, singleSelectedAssignment.maxScore)
    if (validationError || value === null) {
      setBulkScoreError(validationError ?? 'กรุณากรอกคะแนน')
      return
    }
    const submittedStudentIds = filterSubmittedStudentIds(
      Array.from(selectedStudentIds),
      singleSelectedAssignment.id,
      submissionsByAssignment,
    )
    if (submittedStudentIds.length === 0) {
      setBulkScoreError('ไม่มีนักเรียนที่ส่งงานแล้วในกลุ่มที่เลือก')
      return
    }
    setBulkScoreError(null)
    setPendingBulkGrade({ assignment: singleSelectedAssignment, studentIds: submittedStudentIds, score: value })
  }

  /**
   * "เต็มคะแนนคนที่ส่งแล้ว": one click grades every SUBMITTED student in
   * the current selection with the assignment's own max score, straight
   * to the SAME required confirmation dialog — never skipping
   * confirmation, and (via the same filterSubmittedStudentIds gate)
   * never touching a missing student in the same selection.
   */
  function handleBulkGradeSubmittedFullMarks() {
    if (!singleSelectedAssignment || selectedStudentIds.size === 0) return
    const submittedStudentIds = filterSubmittedStudentIds(
      Array.from(selectedStudentIds),
      singleSelectedAssignment.id,
      submissionsByAssignment,
    )
    if (submittedStudentIds.length === 0) {
      setBulkScoreError('ไม่มีนักเรียนที่ส่งงานแล้วในกลุ่มที่เลือก')
      return
    }
    setBulkScoreDraft(String(singleSelectedAssignment.maxScore))
    setBulkScoreError(null)
    setPendingBulkGrade({ assignment: singleSelectedAssignment, studentIds: submittedStudentIds, score: singleSelectedAssignment.maxScore })
  }

  /**
   * The ONE place any bulk grading write happens — the sticky bulk bar's
   * "ให้คะแนนคนที่ส่งแล้ว"/"เต็มคะแนนคนที่ส่งแล้ว" and the "ทั้งห้อง"
   * column-menu shortcuts all end up here, and every one of those
   * callers has ALREADY narrowed `studentIds` down to submitted students
   * only (via filterSubmittedStudentIds) before reaching this function —
   * this never receives a missing student to grade. Builds the full
   * (assignment, student) update list, makes exactly one
   * bulkSetAssignmentScores call for the whole batch (chunking happens
   * inside that shared service, never per-student here), then
   * RE-FETCHES the matrix from the real source of truth (unlike the
   * status quick actions, which apply an optimistic local patch) so
   * every score/status/tally on screen is guaranteed correct after a
   * grading action, then reports a concise, honest result —
   * changed/unchanged/failed counts, with every failure named — via
   * bulkScoreResult, a persistent dismissible panel, not just a toast
   * (the same pattern runBulkStatusUpdate already uses).
   */
  async function runBulkScoreUpdate(studentIds: string[], assignmentId: string, score: number) {
    if (studentIds.length === 0) return
    const updates = buildBulkScoreUpdates(studentIds, assignmentId, score)
    setBulkBusy(true)
    setBulkScoreResult(null)
    try {
      const result = await bulkSetAssignmentScores(updates)
      // Some scores may have landed even when others failed — the
      // recalculation always reads the real saved scores, so run it for
      // any change.
      if (result.changedCount > 0) afterSourceScoresSaved(subject.id, classroomId, [assignmentId], toast)
      await refresh()

      setBulkScoreResult({
        changedCount: result.changedCount,
        unchangedCount: result.unchangedCount,
        failedCount: result.failedCount,
        failures: result.failures.map((f) => {
          const student = roster.find((s) => s.id === f.studentId)
          return { studentName: student ? studentDisplayName(student) : f.studentId, message: f.message }
        }),
      })

      if (result.failedCount === 0) {
        toast(`ให้คะแนนแล้ว ${result.changedCount + result.unchangedCount}/${result.requestedCount} คน`)
      } else {
        toast(
          `ให้คะแนนสำเร็จ ${result.requestedCount - result.failedCount}/${result.requestedCount} คน — ไม่สำเร็จ ${result.failedCount} คน`,
        )
      }
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถให้คะแนนได้'))
    } finally {
      setBulkBusy(false)
      setBulkScoreDraft('')
    }
  }

  async function handleConfirmBulkGrade() {
    if (!pendingBulkGrade) return
    const { assignment, studentIds, score } = pendingBulkGrade
    setPendingBulkGrade(null)
    await runBulkScoreUpdate(studentIds, assignment.id, score)
  }

  /** "ให้คะแนนทั้งห้อง" column-menu shortcut: selects this ONE assignment
   * plus the entire classroom roster, so the sticky bulk grading bar
   * appears ready for the teacher to type a score — no separate write
   * path from the multi-select bar. */
  function handleGradeWholeClassroom(assignment: Assignment) {
    setSelectedAssignmentIds(new Set([assignment.id]))
    setSelectedStudentIds(new Set(roster.map((s) => s.id)))
  }

  /** "เต็มคะแนนคนที่ส่งแล้วทั้งห้อง" column-menu shortcut: same selection
   * as "ให้คะแนนทั้งห้อง" above, pre-filled with the assignment's max
   * score, going straight to the SAME required confirmation dialog
   * ("กำลังให้คะแนน max/max แก่นักเรียน N คน") — never skipping
   * confirmation just because it's a shortcut, and (via the same
   * filterSubmittedStudentIds gate every bulk grading write uses) never
   * assigning a score to a student who hasn't submitted this assignment,
   * even though the WHOLE classroom was selected. */
  function handleGradeWholeClassroomFullMarks(assignment: Assignment) {
    const allStudentIds = roster.map((s) => s.id)
    const submittedStudentIds = filterSubmittedStudentIds(allStudentIds, assignment.id, submissionsByAssignment)
    setSelectedAssignmentIds(new Set([assignment.id]))
    setSelectedStudentIds(new Set(allStudentIds))
    setBulkScoreDraft(String(assignment.maxScore))
    setBulkScoreError(submittedStudentIds.length === 0 ? 'ไม่มีนักเรียนที่ส่งงานแล้วในกลุ่มที่เลือก' : null)
    if (submittedStudentIds.length === 0) return
    setPendingBulkGrade({ assignment, studentIds: submittedStudentIds, score: assignment.maxScore })
  }

  function openTargetDialog(assignment: Assignment, student: ClassroomStudent) {
    const submission = submissionsByAssignment[assignment.id]?.[student.id]
    setTarget({ assignment, student })
    setStatusDraft(submission?.status ?? 'not_submitted')
    setScoreDraft(submission?.score !== null && submission?.score !== undefined ? String(submission.score) : '')
    setNoteDraft(submission?.note ?? '')
    setTargetError(null)
  }

  /**
   * Saves whichever of status/score/note actually changed, each through
   * its OWN existing production function — never a new write path.
   * Status is written first (if changed) so setSubmissionScore's own
   * nextStatusAfterScore transform runs against the teacher's just-
   * chosen status, not the stale one this dialog opened with.
   */
  async function handleSaveTarget() {
    if (!target) return
    const { assignment, student } = target
    const original = submissionsByAssignment[assignment.id]?.[student.id]
    const originalStatus = original?.status ?? 'not_submitted'
    const originalScore = original?.score ?? null
    const originalNote = original?.note ?? ''

    const { value: score, error: validationError } = parseScoreInput(scoreDraft, assignment.maxScore)
    if (validationError) {
      setTargetError(validationError)
      return
    }

    setSavingTarget(true)
    try {
      let effectiveStatus = originalStatus
      if (statusDraft !== originalStatus) {
        await setSubmissionStatus(assignment.id, student.id, statusDraft)
        effectiveStatus = statusDraft
      }
      if (score !== originalScore) {
        await setSubmissionScore(assignment.id, student.id, score, effectiveStatus)
        effectiveStatus = nextStatusAfterScore(effectiveStatus, score)
        afterSourceScoresSaved(subject.id, classroomId, [assignment.id], toast)
      }
      if (noteDraft !== originalNote) {
        await setSubmissionNote(assignment.id, student.id, noteDraft)
      }

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
            [student.id]: { ...existing, status: effectiveStatus, score, note: noteDraft || null },
          },
        }
      })
      toast('บันทึกแล้ว')
      setTarget(null)
    } catch (err) {
      setTargetError(toFriendlyErrorMessage(err, 'ไม่สามารถบันทึกได้'))
    } finally {
      setSavingTarget(false)
    }
  }

  /** "คัดลอกไปห้องอื่น" — reuses the exact same copyAssignmentToClassrooms
   * path (via CopyAssignmentDialog) as the งาน tab's own card menu; this
   * matrix never re-implements the copy itself. */
  function handleCopied(outcomes: AssignmentCopyOutcome[]) {
    const succeeded = outcomes.filter((o) => o.ok).length
    const failed = outcomes.length - succeeded
    if (succeeded > 0 && failed === 0) {
      toast(`คัดลอกงานไป ${succeeded} ห้องแล้ว`)
    } else if (succeeded > 0 && failed > 0) {
      toast(`คัดลอกงานไป ${succeeded} ห้องสำเร็จ, ${failed} ห้องไม่สำเร็จ`)
    } else {
      toast('ไม่สามารถคัดลอกงานไปห้องที่เลือกได้')
    }
    refresh()
  }

  async function handleArchiveAssignment() {
    if (!archivingAssignment) return
    try {
      await archiveAssignment(archivingAssignment.id)
      toast(`เก็บถาวรงาน "${archivingAssignment.title}" แล้ว`)
      setArchivingAssignment(null)
      refresh()
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถเก็บถาวรงานได้'))
    }
  }

  async function handleDeleteMenuClick(assignment: Assignment) {
    setCheckingDeleteId(assignment.id)
    try {
      const hasSubmissions = await hasAssignmentSubmissions(assignment.id)
      setDeletingAssignment({ assignment, hasSubmissions })
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถตรวจสอบข้อมูลงานได้'))
    } finally {
      setCheckingDeleteId(null)
    }
  }

  async function handleDeletePermanently() {
    if (!deletingAssignment) return
    const { assignment } = deletingAssignment
    try {
      await deleteAssignmentPermanently(assignment.id)
      toast(`ลบงาน "${assignment.title}" แล้ว`)
      setDeletingAssignment(null)
      refresh()
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถลบงานนี้ได้'))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">
          {loading ? 'กำลังโหลด...' : `${roster.length} นักเรียน · ${assignments.length} งาน`}
        </p>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          สร้างงาน
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && assignments.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            ยังไม่มีงานในห้องเรียนนี้ — กด &ldquo;สร้างงาน&rdquo; เพื่อเริ่มต้น
          </CardContent>
        </Card>
      ) : (
        <>
          {/* One grouped "control panel" card — the mode summary, the
              segmented filter, select-all, and search all live inside
              ONE visually distinct surface, clearly separated from the
              raw matrix below, instead of floating loosely on the page
              (the "plain admin table" feeling this pass fixes). */}
          <Card>
            <CardContent className="space-y-3 pt-5">
              {/* ONE counter, matching the active mode exactly — an ITEM
                  count (assignment submissions, or scored items), never a
                  student headcount, so the number is always
                  mathematically honest regardless of how many rows the
                  mode below is hiding. ทั้งหมด is the one exception: it
                  has no single mode-specific count, so it shows the
                  submitted/ขาดส่ง split against the full expected
                  (students × assignments) total instead. */}
              {mode === 'all' ? (
                <SummaryStat
                  label={`ส่งแล้ว ${modeSubmittedCount} · ขาดส่ง ${modeMissingCount} จาก ${modeExpectedCount} รายการ`}
                  tone={modeMissingCount > 0 ? 'warning' : 'success'}
                />
              ) : (
                <SummaryStat
                  label={`${SUBMISSION_CHECK_MODE_COUNT_LABEL[mode]} ${modeItemCount} รายการ`}
                  tone={mode === 'missing' ? 'warning' : 'success'}
                />
              )}

              <div className="flex flex-wrap items-center gap-2">
                {/* Segmented control, not plain text tabs — active mode
                    gets strong solid-blue emphasis, inactive stays
                    neutral, and each pill carries its own real (never
                    fabricated) item count from the same
                    modeSubmittedCount/modeMissingCount/modeExpectedCount
                    math the summary banner above uses. */}
                <div className="inline-flex flex-wrap items-center gap-1.5">
                  {SUBMISSION_CHECK_MODES.map((m) => {
                    const count = m.key === 'all' ? modeExpectedCount : m.key === 'submitted' ? modeSubmittedCount : modeMissingCount
                    return (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => setMode(m.key)}
                        className={cn(
                          'shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                          mode === m.key
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'bg-secondary text-secondary-foreground hover:bg-accent',
                        )}
                      >
                        {m.label}
                        <span className={cn('ml-1.5 tabular-nums', mode === m.key ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                          {count}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={handleSelectEntireClassroom} disabled={roster.length === 0}>
                  <Users className="size-3.5" />
                  เลือกทั้งห้อง ({roster.length})
                </Button>
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
            </CardContent>
          </Card>

          {/* Prominent, elevated bar — only ever rendered once a
              selection exists, never taking up space otherwise. Not
              page-sticky: the workspace's own header above already
              occupies `sticky top-0`, and its height varies (badge,
              wrapping tabs), so stacking a second sticky bar under it
              without a hardcoded offset would risk overlapping it. */}
          {(selectedStudentIds.size > 0 || selectedAssignmentIds.size > 0) && (
            <div className="flex flex-col gap-2.5 rounded-2xl border border-primary/40 bg-card px-3.5 py-3 text-sm shadow-soft">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Users className="size-4" />
                </span>
                <span className="font-semibold text-foreground">
                  {selectedStudentIds.size} นักเรียน × {selectedAssignmentIds.size} งาน = {selectionCellCount} รายการ
                </span>
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  {/* Exactly the ONE bulk-status action the active mode
                      names — never a multi-button picker mixing statuses
                      that belong to a different mode. */}
                  {(mode === 'submitted' || mode === 'missing') && (
                    <Button
                      type="button"
                      variant={mode === 'submitted' ? 'success' : 'outline-destructive'}
                      size="sm"
                      disabled={bulkBusy || selectionCellCount === 0}
                      onClick={() => handleSelectionBulkAction(MODE_BULK_STATUS_ACTION[mode].status)}
                    >
                      {MODE_BULK_STATUS_ACTION[mode].label}
                    </Button>
                  )}
                  <Button type="button" variant="ghost" size="sm" onClick={clearSelection} disabled={bulkBusy}>
                    ล้างการเลือก
                  </Button>
                </div>
              </div>

              {/* ทั้งหมด mode's "สถานะงาน" group — the fix for this bug:
                  ทั้งหมด previously exposed the คะแนน (grading) group only,
                  with no way to bulk-mark submission status without first
                  switching to ส่งแล้ว/ขาดส่ง mode. Works across MULTIPLE
                  selected assignments at once (the SAME cross product
                  handleSelectionBulkAction already builds for ส่งแล้ว/
                  ขาดส่ง mode's own single button) — "8 นักเรียน × 3 งาน"
                  becomes one 24-item bulk write, never one request per
                  assignment. Marking "✓ ส่งแล้ว" only ever writes
                  `status`, never a score; marking "ขาดส่ง" never creates
                  or forces a score of 0 — see runBulkStatusUpdate. */}
              {mode === 'all' && selectionCellCount > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-semibold tracking-wide text-muted-foreground">
                    สถานะงาน:
                  </span>
                  <Button type="button" variant="success" size="sm" disabled={bulkBusy} onClick={() => handleSelectionBulkAction('submitted')}>
                    <CheckCircle2 className="size-3.5" />
                    ส่งแล้ว
                  </Button>
                  <Button
                    type="button"
                    variant="outline-destructive"
                    size="sm"
                    disabled={bulkBusy}
                    onClick={() => handleSelectionBulkAction('missing')}
                  >
                    ขาดส่ง
                  </Button>
                </div>
              )}

              {/* The bulk GRADING bar: ทั้งหมด ONLY — ส่งแล้ว/ขาดส่ง are
                  pure, score-free views and must never surface a score
                  input. Shows the submitted/ขาดส่ง split for EXACTLY this
                  selection × this one assignment column, so the teacher
                  sees up front how many of the selected students will
                  actually be graded. Requires exactly ONE selected
                  assignment (a score is meaningless without knowing which
                  assignment's max score it's bounded by) — with multiple
                  assignments selected, only the "สถานะงาน" group above
                  applies. */}
              {mode === 'all' && singleSelectedAssignment && selectedStudentIds.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-semibold tracking-wide text-muted-foreground">
                    คะแนน:
                  </span>
                  <span className="text-muted-foreground">
                    เลือกแล้ว {selectedStudentIds.size} คน · งาน: {singleSelectedAssignment.title} /{singleSelectedAssignment.maxScore} ·
                    ส่งแล้ว {selectionSubmittedMissingSplit.submittedCount} · ขาดส่ง {selectionSubmittedMissingSplit.missingCount}
                  </span>
                  <Label htmlFor="bulk-grade-score" className="sr-only">
                    คะแนน
                  </Label>
                  <Input
                    id="bulk-grade-score"
                    type="number"
                    min={0}
                    max={singleSelectedAssignment.maxScore}
                    value={bulkScoreDraft}
                    onChange={(e) => {
                      setBulkScoreDraft(e.target.value)
                      setBulkScoreError(null)
                    }}
                    placeholder="0"
                    className="h-8 w-20"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={handleBulkScoreFullMark} disabled={bulkBusy}>
                    เต็มคะแนน
                  </Button>
                  {/* Bulk grading NEVER touches a missing student by
                      default — both buttons act only on the submitted
                      subset of the current selection (filterSubmittedStudentIds),
                      hence both disabled once that subset is empty. */}
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleOpenBulkGradeConfirm}
                    disabled={bulkBusy || selectionSubmittedMissingSplit.submittedCount === 0}
                  >
                    ให้คะแนนคนที่ส่งแล้ว
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleBulkGradeSubmittedFullMarks}
                    disabled={bulkBusy || selectionSubmittedMissingSplit.submittedCount === 0}
                  >
                    เต็มคะแนนคนที่ส่งแล้ว
                  </Button>
                  {bulkScoreError && <span className="text-destructive">{bulkScoreError}</span>}
                </div>
              )}
            </div>
          )}

          {/* The concise, honest result of the LAST bulk status save
              (column quick action or the "สถานะงาน" bulk-bar group) —
              persistent and dismissible, never just a transient toast,
              exactly mirroring what the server actually did: how many
              changed, how many were already that status (unchanged), and
              how many failed, each failure named. Set fresh (to null)
              at the start of every runBulkStatusUpdate call, so a stale
              result from a previous action never lingers on screen. */}
          {bulkStatusResult && (
            <div className="rounded-2xl border border-border border-l-4 border-l-success bg-card px-3.5 py-2.5 text-sm shadow-soft">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <p className="font-semibold text-success">บันทึกสถานะสำเร็จ {bulkStatusResult.changedCount} รายการ</p>
                  <p className="text-muted-foreground">ไม่เปลี่ยนแปลง {bulkStatusResult.unchangedCount}</p>
                  <p className={bulkStatusResult.failedCount > 0 ? 'font-medium text-destructive' : 'text-muted-foreground'}>
                    ไม่สำเร็จ {bulkStatusResult.failedCount}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setBulkStatusResult(null)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="ปิด"
                >
                  <X className="size-4" />
                </button>
              </div>
              {bulkStatusResult.failures.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                  {bulkStatusResult.failures.map((f, i) => (
                    <li key={i}>
                      {f.studentName} · {f.assignmentTitle}: {f.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* The concise, honest result of the LAST bulk grading save
              ("ให้คะแนนคนที่ส่งแล้ว"/"เต็มคะแนนคนที่ส่งแล้ว" or a column
              quick action) — persistent and dismissible, never just a
              transient toast, mirroring the exact same pattern used for
              bulkStatusResult above: how many changed, how many already
              had that exact score (unchanged), and how many failed, each
              failure named. Set fresh (to null) at the start of every
              runBulkScoreUpdate call, so a stale result from a previous
              action never lingers on screen. */}
          {bulkScoreResult && (
            <div className="rounded-2xl border border-border border-l-4 border-l-success bg-card px-3.5 py-2.5 text-sm shadow-soft">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <p className="font-semibold text-success">ให้คะแนนสำเร็จ {bulkScoreResult.changedCount} คน</p>
                  <p className="text-muted-foreground">ไม่เปลี่ยนแปลง {bulkScoreResult.unchangedCount}</p>
                  <p className={bulkScoreResult.failedCount > 0 ? 'font-medium text-destructive' : 'text-muted-foreground'}>
                    ไม่สำเร็จ {bulkScoreResult.failedCount}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setBulkScoreResult(null)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="ปิด"
                >
                  <X className="size-4" />
                </button>
              </div>
              {bulkScoreResult.failures.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                  {bulkScoreResult.failures.map((f, i) => (
                    <li key={i}>
                      {f.studentName}: {f.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <div className="max-h-[70vh] overflow-auto rounded-xl">
                <table className="w-full border-separate border-spacing-0 text-left text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground">
                      <th className="sticky left-0 top-0 z-20 bg-card px-3 py-2.5 font-semibold border-b border-border">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            onChange={toggleSelectAllVisible}
                            className="size-4 shrink-0 cursor-pointer rounded border-input accent-primary focus-visible:ring-2 focus-visible:ring-primary/40"
                            aria-label="เลือกนักเรียนทั้งหมด"
                          />
                          ชื่อ-นามสกุล
                        </div>
                      </th>
                      {visibleAssignments.map((assignment) => (
                        <th
                          key={assignment.id}
                          className={cn(
                            'sticky top-0 z-10 min-w-28 border-b border-border bg-card px-2 py-2 text-center font-semibold transition-colors',
                            selectedAssignmentIds.has(assignment.id) && 'bg-primary/10',
                          )}
                        >
                          <div className="flex items-center justify-center gap-1">
                            <input
                              type="checkbox"
                              checked={selectedAssignmentIds.has(assignment.id)}
                              onChange={() => toggleAssignmentSelected(assignment.id)}
                              className="size-4 shrink-0 cursor-pointer rounded border-input accent-primary focus-visible:ring-2 focus-visible:ring-primary/40"
                              aria-label={`เลือกคอลัมน์ ${assignment.title}`}
                            />
                            <span className="truncate text-foreground" title={assignment.title}>
                              {assignment.title}
                            </span>
                            <RowActionsMenu
                              actions={[
                                { key: 'edit', label: 'แก้ไขงาน', onSelect: () => setEditingAssignment(assignment) },
                                { key: 'copy', label: 'คัดลอกไปห้องอื่น', onSelect: () => setCopyingAssignment(assignment) },
                                {
                                  key: 'view-detail',
                                  label: 'ดูรายละเอียด',
                                  onSelect: () => navigate(buildAssignmentDetailPath(subject.id, classroomId, assignment.id)),
                                },
                                {
                                  key: 'select-column',
                                  label: 'เลือกทั้งคอลัมน์',
                                  onSelect: () => toggleAssignmentSelected(assignment.id),
                                },
                                // The "ทั้งห้อง" STATUS quick actions shown
                                // here always match the currently active
                                // ส่งแล้ว/ขาดส่ง mode — never a status
                                // shortcut that belongs to a different mode
                                // than what's on screen. The 2 GRADING
                                // shortcuts below are ทั้งหมด-ONLY (grading
                                // never appears in ส่งแล้ว/ขาดส่ง, the same
                                // rule the matrix cells themselves follow)
                                // and always skip missing students by
                                // default.
                                ...(mode === 'submitted'
                                  ? [
                                      {
                                        key: 'mark-submitted',
                                        label: 'ส่งแล้วทั้งห้อง',
                                        disabled: bulkBusy,
                                        onSelect: () => handleColumnQuickAction(assignment, 'submitted'),
                                      },
                                    ]
                                  : []),
                                ...(mode === 'missing'
                                  ? [
                                      {
                                        key: 'mark-missing',
                                        label: 'ขาดส่งทั้งห้อง',
                                        disabled: bulkBusy,
                                        onSelect: () => handleColumnQuickAction(assignment, 'missing'),
                                      },
                                    ]
                                  : []),
                                ...(mode === 'all'
                                  ? [
                                      {
                                        key: 'grade-classroom',
                                        label: 'ให้คะแนนทั้งห้อง',
                                        disabled: bulkBusy,
                                        onSelect: () => handleGradeWholeClassroom(assignment),
                                      },
                                      {
                                        key: 'grade-classroom-full',
                                        label: 'เต็มคะแนนคนที่ส่งแล้วทั้งห้อง',
                                        disabled: bulkBusy,
                                        onSelect: () => handleGradeWholeClassroomFullMarks(assignment),
                                      },
                                    ]
                                  : []),
                                {
                                  key: 'archive',
                                  label: 'เก็บถาวรงาน',
                                  separatorBefore: true,
                                  disabled: assignment.isArchived,
                                  onSelect: () => setArchivingAssignment(assignment),
                                },
                                {
                                  key: 'delete',
                                  label: 'ลบงาน',
                                  destructive: true,
                                  disabled: checkingDeleteId === assignment.id,
                                  onSelect: () => handleDeleteMenuClick(assignment),
                                },
                              ]}
                            />
                          </div>
                          <div className="font-normal text-muted-foreground">/{assignment.maxScore}</div>
                          {assignment.dueDate && <div className="text-[10px] font-normal text-muted-foreground/80">{assignment.dueDate}</div>}
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
                      filteredRoster.map((student, rowIndex) => (
                        <tr
                          key={student.id}
                          className={cn(
                            'border-b border-border last:border-0 transition-colors hover:bg-muted/40',
                            selectedStudentIds.has(student.id) ? 'bg-primary/5' : rowIndex % 2 === 1 && 'bg-muted/20',
                          )}
                        >
                          <td
                            className={cn(
                              'sticky left-0 z-10 whitespace-nowrap bg-card px-3 py-2 font-medium text-foreground',
                              selectedStudentIds.has(student.id) && 'bg-primary/5',
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={selectedStudentIds.has(student.id)}
                                onChange={() => toggleStudentSelected(student.id)}
                                className="size-4 shrink-0 cursor-pointer rounded border-input accent-primary focus-visible:ring-2 focus-visible:ring-primary/40"
                                aria-label={`เลือก ${studentDisplayName(student)}`}
                              />
                              {studentDisplayName(student)}
                            </div>
                          </td>
                          {visibleAssignments.map((assignment) => {
                            const submission = submissionsByAssignment[assignment.id]?.[student.id]
                            const display = computeCellDisplay(mode, submission?.status ?? 'not_submitted', submission?.score ?? null)
                            return (
                              <td key={assignment.id} className="px-2 py-1.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => openTargetDialog(assignment, student)}
                                  title={cellTitle(display)}
                                  className="inline-flex h-8 min-w-14 items-center justify-center gap-1 rounded-full px-2 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                                >
                                  <CellVisual display={display} maxScore={assignment.maxScore} />
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
        </>
      )}

      <AssignmentDialog open={createOpen} onOpenChange={setCreateOpen} subjectId={subject.id} classroomId={classroomId} onSaved={refresh} />

      {editingAssignment && (
        <AssignmentDialog
          open={Boolean(editingAssignment)}
          onOpenChange={(open) => !open && setEditingAssignment(null)}
          subjectId={subject.id}
          classroomId={classroomId}
          assignment={editingAssignment}
          onSaved={() => {
            setEditingAssignment(null)
            refresh()
          }}
        />
      )}

      {copyingAssignment && (
        <CopyAssignmentDialog
          open={Boolean(copyingAssignment)}
          onOpenChange={(open) => !open && setCopyingAssignment(null)}
          assignment={copyingAssignment}
          onCopied={handleCopied}
        />
      )}

      {archivingAssignment && (
        <ConfirmDialog
          open={Boolean(archivingAssignment)}
          onOpenChange={(open) => !open && setArchivingAssignment(null)}
          title="เก็บถาวรงาน"
          description={`เก็บถาวร "${archivingAssignment.title}"?\nงานและคะแนนของนักเรียนจะยังคงอยู่ในระบบ`}
          confirmLabel="เก็บถาวร"
          onConfirm={handleArchiveAssignment}
        />
      )}

      {deletingAssignment && (
        <ConfirmDialog
          open={Boolean(deletingAssignment)}
          onOpenChange={(open) => !open && setDeletingAssignment(null)}
          title={deletingAssignment.hasSubmissions ? 'ลบงานและข้อมูลนักเรียน?' : 'ลบงานนี้?'}
          description={
            deletingAssignment.hasSubmissions
              ? 'งานนี้มีข้อมูลการส่งงานหรือคะแนนของนักเรียน\nหากลบงาน ข้อมูลการส่งงาน คะแนน สถานะ และไฟล์งานที่เกี่ยวข้องจะถูกลบด้วย\nและไม่สามารถกู้คืนได้'
              : 'เมื่อลบแล้วจะไม่สามารถกู้คืนได้'
          }
          confirmLabel={deletingAssignment.hasSubmissions ? 'ลบงานและข้อมูลทั้งหมด' : 'ลบงาน'}
          destructive
          onConfirm={handleDeletePermanently}
        />
      )}

      {pendingBulkGrade && (
        <ConfirmDialog
          open={Boolean(pendingBulkGrade)}
          onOpenChange={(open) => !open && setPendingBulkGrade(null)}
          title="ยืนยันการให้คะแนน"
          description={`กำลังให้คะแนน ${pendingBulkGrade.score}/${pendingBulkGrade.assignment.maxScore} แก่นักเรียน ${pendingBulkGrade.studentIds.length} คน`}
          confirmLabel="ให้คะแนน"
          onConfirm={handleConfirmBulkGrade}
        />
      )}

      {target && (
        <Dialog open={Boolean(target)} onOpenChange={(open) => !open && setTarget(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>บันทึกการส่งงาน</DialogTitle>
              <DialogDescription>
                {studentDisplayName(target.student)} · {target.assignment.title}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>สถานะการส่งงาน</Label>
                <div className="flex flex-wrap gap-1.5">
                  {STATUS_ACTIONS.map((action) => (
                    <button
                      key={action.key}
                      type="button"
                      onClick={() => setStatusDraft(action.key)}
                      data-active={statusDraft === action.key}
                      className="rounded-full border border-input px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 data-[active=true]:border-transparent data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">สถานะปัจจุบัน: {SUBMISSION_CELL_STATE_LABEL[computeSubmissionCellState(statusDraft, null)]}</p>
              </div>

              {/* Grading exists ONLY in ทั้งหมด — the score field never
                  appears while ส่งแล้ว/ขาดส่ง is active, keeping those 2
                  views purely about submission status. */}
              {mode === 'all' && (
                <div className="space-y-1.5">
                  <Label htmlFor="submission-check-score">คะแนน (เต็ม {target.assignment.maxScore})</Label>
                  <Input
                    id="submission-check-score"
                    type="number"
                    min={0}
                    max={target.assignment.maxScore}
                    value={scoreDraft}
                    onChange={(e) => {
                      setScoreDraft(e.target.value)
                      setTargetError(null)
                    }}
                    placeholder="เว้นว่าง = ยังไม่ให้คะแนน"
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground">เว้นว่างไว้เพื่อตรวจทีหลัง — จะไม่ถูกนับเป็นคะแนน 0</p>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="submission-check-note">หมายเหตุ (ถ้ามี)</Label>
                <Textarea
                  id="submission-check-note"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  className="min-h-14"
                  placeholder="บันทึกเพิ่มเติมสำหรับงานนี้ (ไม่บังคับ)"
                />
              </div>

              {targetError && <p className="text-sm text-destructive">{targetError}</p>}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setTarget(null)} disabled={savingTarget}>
                ยกเลิก
              </Button>
              <Button type="button" onClick={handleSaveTarget} disabled={savingTarget}>
                {savingTarget ? 'กำลังบันทึก...' : 'บันทึก'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

/**
 * A single counter card for the currently active mode. Most modes pass a
 * single mathematically honest ITEM count ("ส่งแล้ว 198 รายการ"); ทั้งหมด
 * mode is the one exception and passes a combined submitted/ขาดส่ง-vs-
 * expected-total label instead, since it has no single count of its own.
 */
function SummaryStat({ label, tone }: { label: string; tone: 'warning' | 'success' }) {
  const toneClass = {
    warning: 'border-destructive/25 bg-destructive/5 text-destructive',
    success: 'border-success/25 bg-success/5 text-success',
  }[tone]
  const Icon = tone === 'warning' ? AlertTriangle : CheckCircle2

  return (
    <div className={cn('flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 text-sm font-bold tracking-tight', toneClass)}>
      <Icon className="size-4 shrink-0" />
      {label}
    </div>
  )
}

/**
 * The tooltip text for ONE cell — mirrors CellVisual's own per-kind
 * split exactly, so a teacher hovering a cell never sees a hint at
 * information the cell itself doesn't show (no score hint under
 * ส่งแล้ว/ขาดส่ง mode, no "does not match" hint under ทั้งหมด since it
 * never renders a non-matching cell there).
 */
function cellTitle(display: CellDisplay): string {
  if (display.kind === 'missing') return 'ขาดส่ง'
  if (display.kind === 'submitted-plain') return 'ส่งแล้ว'
  if (display.kind === 'submitted') return display.score === null ? 'ส่งแล้ว — ยังไม่มีคะแนน' : `ส่งแล้ว — คะแนน ${display.score}`
  return 'ไม่ตรงกับโหมดนี้'
}

/**
 * ONE cell rendering, dispatching on computeCellDisplay's own per-mode
 * `kind` — this is the visual half of the fix that stops grading UI
 * from leaking into ส่งแล้ว/ขาดส่ง. `{kind: 'submitted'}` is ONLY ever
 * produced in ทั้งหมด mode and is the ONLY kind that ever shows a score:
 * `null` (no score entered yet) renders as the placeholder "—", and an
 * explicit `0` renders as the literal "0/{maxScore}" — the two are never
 * conflated. `{kind: 'submitted-plain'}` (ส่งแล้ว mode) renders a BARE ✓
 * — no score, no "/max", no placeholder, ever. `{kind: 'missing'}`
 * renders red "ขาดส่ง" and nothing else. `{kind: 'blank'}` (a
 * non-matching cell in ส่งแล้ว/ขาดส่ง mode) renders truly empty — never a
 * "—" placeholder, which would read as its own third visual state.
 */
function CellVisual({ display, maxScore }: { display: CellDisplay; maxScore: number }) {
  if (display.kind === 'missing') {
    return (
      <span className="inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
        ขาดส่ง
      </span>
    )
  }
  if (display.kind === 'submitted-plain') {
    return (
      <span className="inline-flex size-6 items-center justify-center rounded-full bg-success/10">
        <CheckCircle2 className="size-4 shrink-0 text-success" />
      </span>
    )
  }
  if (display.kind === 'submitted') {
    return (
      <span className="inline-flex items-center gap-1.5">
        <CheckCircle2 className="size-4 shrink-0 text-success" />
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums',
            display.score === null ? 'text-muted-foreground' : 'bg-success/10 text-success',
          )}
        >
          {display.score === null ? '—' : `${display.score}/${maxScore}`}
        </span>
      </span>
    )
  }
  return null
}
