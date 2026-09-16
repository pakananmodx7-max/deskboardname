import { Check, CheckCircle2, Clock3, Plus, Search, Users } from 'lucide-react'
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
import { buildAssignmentDetailPath } from '@/features/subjects-shared/subject-classroom-nav'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import {
  SUBMISSION_CELL_STATE_LABEL,
  SUBMISSION_CHECK_FILTERS,
  archiveAssignment,
  computeSubmissionCellState,
  computeSubmissionCheckTally,
  deleteAssignmentPermanently,
  deriveGradeRoster,
  filterStudentsBySubmissionCheckState,
  getAssignments,
  getSubmissions,
  hasAssignmentSubmissions,
  nextStatusAfterScore,
  parseScoreInput,
  searchAssignmentsByTitle,
  setSubmissionNote,
  setSubmissionScore,
  setSubmissionStatus,
  type SubmissionCheckFilter,
} from '@/services/assignment-service'
import { getStudentsByClassroom } from '@/services/student-service'
import { bulkMarkSubmissionStatus, buildBulkSubmissionStatusUpdates } from '@/services/submission-bulk-service'
import type { Assignment, AssignmentSubmission, SubmissionStatus } from '@/types/assignment'
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
 * no mock data, no invented database status. Cell state is a pure
 * DISPLAY derivation of the existing (status, score) pair — see
 * assignment-service.ts's computeSubmissionCellState (score !== null
 * always wins; a submitted-but-ungraded cell is never treated as 0).
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

  const [filter, setFilter] = useState<SubmissionCheckFilter>('all')
  const [assignmentQuery, setAssignmentQuery] = useState('')

  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set())
  const [selectedAssignmentIds, setSelectedAssignmentIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null)
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

  /**
   * The one place any bulk status change actually runs — column quick
   * actions ("ส่งแล้วทั้งห้อง"/"ขาดส่งทั้งห้อง") and the multi-select bulk
   * bar both call this with their own (studentIds, assignmentIds) pair.
   * Applies the SAME optimistic local update to every update that did
   * NOT come back as a failure, so the matrix reflects the real result
   * (partial failures included) without a full refetch.
   */
  async function runBulkStatusUpdate(studentIds: string[], assignmentIds: string[], status: SubmissionStatus) {
    if (studentIds.length === 0 || assignmentIds.length === 0) return
    const updates = buildBulkSubmissionStatusUpdates(studentIds, assignmentIds, status)
    setBulkBusy(true)
    try {
      const result = await bulkMarkSubmissionStatus(updates)
      const failedKeys = new Set(result.failures.map((f) => `${f.assignmentId}:${f.studentId}`))
      setSubmissionsByAssignment((prev) => {
        const next = { ...prev }
        for (const update of updates) {
          if (failedKeys.has(`${update.assignmentId}:${update.studentId}`)) continue
          const existing = next[update.assignmentId]?.[update.studentId] ?? {
            studentId: update.studentId,
            status: 'not_submitted' as const,
            score: null,
            note: null,
          }
          next[update.assignmentId] = {
            ...next[update.assignmentId],
            [update.studentId]: { ...existing, status: update.status },
          }
        }
        return next
      })

      if (result.failedCount === 0) {
        toast(`อัปเดตสถานะ ${result.requestedCount} รายการแล้ว`)
      } else {
        toast(
          `อัปเดตสำเร็จ ${result.requestedCount - result.failedCount}/${result.requestedCount} รายการ — ไม่สำเร็จ ${result.failedCount} รายการ`,
        )
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
        <p className="text-sm text-muted-foreground">
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

          {(selectedStudentIds.size > 0 || selectedAssignmentIds.size > 0) && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
              <Users className="size-4 shrink-0 text-primary" />
              <span className="font-medium">
                {selectedStudentIds.size} นักเรียน × {selectedAssignmentIds.size} งาน = {selectionCellCount} รายการ
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                {STATUS_ACTIONS.map((action) => (
                  <Button
                    key={action.key}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={bulkBusy || selectionCellCount === 0}
                    onClick={() => handleSelectionBulkAction(action.key)}
                  >
                    {action.label}
                  </Button>
                ))}
                <Button type="button" variant="ghost" size="sm" onClick={clearSelection} disabled={bulkBusy}>
                  ล้างการเลือก
                </Button>
              </div>
            </div>
          )}

          <Card>
            <CardContent className="p-0">
              <div className="max-h-[70vh] overflow-auto rounded-md">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="sticky left-0 top-0 z-20 bg-card px-3 py-3 font-medium">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            onChange={toggleSelectAllVisible}
                            className="size-4 rounded border-input"
                            aria-label="เลือกนักเรียนทั้งหมด"
                          />
                          ชื่อ-นามสกุล
                        </div>
                      </th>
                      {visibleAssignments.map((assignment) => (
                        <th key={assignment.id} className="sticky top-0 z-10 min-w-28 bg-card px-2 py-2 text-center font-medium">
                          <div className="flex items-center justify-center gap-1">
                            <input
                              type="checkbox"
                              checked={selectedAssignmentIds.has(assignment.id)}
                              onChange={() => toggleAssignmentSelected(assignment.id)}
                              className="size-4 shrink-0 rounded border-input"
                              aria-label={`เลือกคอลัมน์ ${assignment.title}`}
                            />
                            <span className="truncate" title={assignment.title}>
                              {assignment.title}
                            </span>
                            <RowActionsMenu
                              actions={[
                                { key: 'edit', label: 'แก้ไขงาน', onSelect: () => setEditingAssignment(assignment) },
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
                                {
                                  key: 'mark-submitted',
                                  label: 'ส่งแล้วทั้งห้อง',
                                  disabled: bulkBusy,
                                  onSelect: () => handleColumnQuickAction(assignment, 'submitted'),
                                },
                                {
                                  key: 'mark-missing',
                                  label: 'ขาดส่งทั้งห้อง',
                                  disabled: bulkBusy,
                                  onSelect: () => handleColumnQuickAction(assignment, 'missing'),
                                },
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
                          <div className="font-normal">/{assignment.maxScore}</div>
                          {assignment.dueDate && <div className="text-[10px] font-normal">{assignment.dueDate}</div>}
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
                          <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-3 py-2 font-medium">
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={selectedStudentIds.has(student.id)}
                                onChange={() => toggleStudentSelected(student.id)}
                                className="size-4 shrink-0 rounded border-input"
                                aria-label={`เลือก ${studentDisplayName(student)}`}
                              />
                              {studentDisplayName(student)}
                            </div>
                          </td>
                          {visibleAssignments.map((assignment) => {
                            const submission = submissionsByAssignment[assignment.id]?.[student.id]
                            const state = computeSubmissionCellState(submission?.status ?? 'not_submitted', submission?.score ?? null)
                            return (
                              <td key={assignment.id} className="px-2 py-1.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => openTargetDialog(assignment, student)}
                                  title={SUBMISSION_CELL_STATE_LABEL[state]}
                                  className="inline-flex h-8 min-w-14 items-center justify-center gap-1 rounded-md px-2 text-sm transition-colors hover:bg-accent"
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
                      className="rounded-md border border-input px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors data-[active=true]:border-transparent data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">สถานะปัจจุบัน: {SUBMISSION_CELL_STATE_LABEL[computeSubmissionCellState(statusDraft, null)]}</p>
              </div>

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
 * The 5 visual states from the spec: neutral "—" (not submitted), a
 * green check with no score (submitted, awaiting review — NEVER shown
 * as/confused with 0), an amber "สาย" for a late-but-ungraded
 * submission, a muted "ขาดส่ง" tag, and a check + score (e.g. "8/10")
 * once grading is complete.
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
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-warning-foreground">
        <Clock3 className="size-3.5" />
        สาย
      </span>
    )
  }
  if (state === 'missing') {
    return <span className="text-xs font-medium text-destructive">ขาดส่ง</span>
  }
  return <span className="text-muted-foreground">—</span>
}
