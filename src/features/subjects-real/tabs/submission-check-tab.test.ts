import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./submission-check-tab.tsx', import.meta.url), 'utf-8')
}

// ==================================================
// SubmissionCheckTab (ตรวจสอบงาน) — the spreadsheet-style student ×
// assignment workspace. Source-text guards, the same convention every
// other real, Supabase-backed tab in this codebase uses (see
// grades-tab.test.ts) since vitest.config.ts runs in a `node`
// environment with no DOM. The underlying pure logic
// (computeSubmissionCellState, computeSubmissionCheckTally,
// filterStudentsBySubmissionCheckState, searchAssignmentsByTitle,
// buildBulkSubmissionStatusUpdates, chunking/aggregation) is covered
// with REAL, executed unit tests in src/services/assignment-service.test.ts
// and src/services/submission-bulk-service.test.ts — this file only
// pins down how the component wires that logic together.
// ==================================================

describe('SubmissionCheckTab — reuses the exact real data model, never mock data', () => {
  const source = readSource()

  it('reads assignments/students/submissions through the SAME service calls as GradesTab — getAssignments/getSubmissions/getStudentsByClassroom, no new query shape', () => {
    expect(source).toContain('getAssignments(subject.id, classroomId)')
    expect(source).toContain('getSubmissions(a.id)')
    expect(source).toContain('getStudentsByClassroom(classroomId)')
  })

  it('never imports from src/demo/* or any *-demo module — this tab is real-data-only', () => {
    expect(source).not.toMatch(/from '@\/demo/)
    expect(source).not.toMatch(/-demo['"]/)
    expect(source).not.toMatch(/useDemoClassroom/)
  })

  it('derives the roster via the shared deriveGradeRoster — same archived-but-has-history inclusion rule as คะแนน, not a re-invented one', () => {
    expect(source).toContain('deriveGradeRoster(students, submissionsByAssignment)')
  })

  it('single-cell edits reuse the exact existing production write functions — setSubmissionStatus/setSubmissionScore/setSubmissionNote — never a raw query on assignment_submissions in the component itself', () => {
    expect(source).toContain("from '@/services/assignment-service'")
    expect(source).toContain('await setSubmissionStatus(assignment.id, student.id, statusDraft)')
    expect(source).toContain('await setSubmissionScore(assignment.id, student.id, score, effectiveStatus)')
    expect(source).toContain('await setSubmissionNote(assignment.id, student.id, noteDraft)')
    expect(source).not.toMatch(/\.from\('assignment_submissions'\)/)
  })
})

describe('SubmissionCheckTab — "+ สร้างงาน": create assignment inline, no navigation, new column appears', () => {
  const source = readSource()

  it('has a prominent "+ สร้างงาน" button that opens the create dialog', () => {
    expect(source).toContain('setCreateOpen(true)')
    expect(source).toContain('สร้างงาน')
  })

  it('reuses the EXACT existing AssignmentDialog (same production createAssignment/updateAssignment logic) — never a re-implemented create form', () => {
    expect(source).toContain("from '@/features/subjects-real/assignment-dialog'")
    expect(source).toContain('<AssignmentDialog open={createOpen} onOpenChange={setCreateOpen} subjectId={subject.id} classroomId={classroomId} onSaved={refresh} />')
  })

  it('never calls navigate for the create flow — the teacher stays on this page (a real navigate() call exists elsewhere, for "ดูรายละเอียด")', () => {
    expect(source).toContain('onClick={() => setCreateOpen(true)}')
    const createDialogLine = source.slice(
      source.indexOf('<AssignmentDialog open={createOpen}'),
      source.indexOf('\n', source.indexOf('<AssignmentDialog open={createOpen}')),
    )
    expect(createDialogLine).toContain('onSaved={refresh}')
    expect(createDialogLine).not.toMatch(/navigate\(/)
  })

  it('onSaved is refresh — the same refetch that builds the visible columns, so a newly created assignment appears as a new column with no separate "add column" code path', () => {
    const dialogBlock = source.slice(source.indexOf('<AssignmentDialog open={createOpen}'))
    expect(dialogBlock).toContain('onSaved={refresh}')
  })
})

describe('SubmissionCheckTab — cell rendering: green ✓ = ตรวจแล้ว, never score 0, no "รอตรวจ"/awaiting-review treatment', () => {
  const source = readSource()

  it('computes each cell\'s state via computeSubmissionCellState(status, score) — status/score straight from the fetched submission, never defaulted to 0', () => {
    const cellFn = source.slice(source.indexOf('function SubmissionCellVisual'))
    expect(cellFn).toContain('state === ')
    expect(source).toContain(
      "const state = computeSubmissionCellState(submission?.status ?? 'not_submitted', submission?.score ?? null)",
    )
  })

  it('the graded branch renders the REAL score, never a literal 0 fallback for a null score', () => {
    const cellFn = source.slice(source.indexOf('function SubmissionCellVisual'), source.indexOf('function SubmissionCellVisual') + 800)
    expect(cellFn).toMatch(/if \(state === 'graded'\)/)
    expect(cellFn).toContain('{score}/{maxScore}')
    expect(cellFn).not.toContain('score ?? 0')
  })

  it('"submitted" (covering both submitted and late statuses with no score) renders a green check (CheckCircle2) with NO score text next to it — visually distinct from the graded "score/max" branch, and with NO separate amber/"awaiting" treatment for late', () => {
    const cellFn = source.slice(source.indexOf('function SubmissionCellVisual'))
    const submittedBranch = cellFn.slice(cellFn.indexOf("state === 'submitted'"), cellFn.indexOf("state === 'missing'"))
    expect(submittedBranch).toContain('CheckCircle2')
    expect(submittedBranch).not.toMatch(/\{score\}/)
    expect(cellFn).not.toContain("state === 'submitted_ungraded'")
    expect(cellFn).not.toContain("state === 'late_ungraded'")
    expect(cellFn).not.toContain('สาย')
    expect(cellFn).not.toContain('Clock3')
  })

  it('missing renders "ขาดส่ง", not_submitted renders a neutral "—"', () => {
    const cellFn = source.slice(source.indexOf('function SubmissionCellVisual'))
    const missingBranch = cellFn.slice(cellFn.indexOf("state === 'missing'"))
    expect(missingBranch).toContain('ขาดส่ง')
    expect(cellFn).toContain('return <span className="text-muted-foreground">—</span>')
  })

  it('the tooltip/label text comes from SUBMISSION_CELL_STATE_LABEL and reads "ตรวจแล้ว" for a checked cell — never "รอตรวจ"/awaiting-review copy', () => {
    expect(source).toContain('title={SUBMISSION_CELL_STATE_LABEL[state]}')
    expect(source).not.toContain('รอตรวจ')
  })
})

describe('SubmissionCheckTab — every cell (including not_submitted/missing) is clickable, opening the dialog', () => {
  const source = readSource()

  it('every cell button calls openTargetDialog unconditionally — no disabled/gradable gate on the click target itself', () => {
    const cellBlock = source.slice(source.indexOf('return (\n                              <td key={assignment.id} className="px-2 py-1.5'), source.indexOf('</td>\n                            )\n                          })}'))
    expect(cellBlock).toContain('onClick={() => openTargetDialog(assignment, student)}')
    expect(cellBlock).not.toContain('disabled=')
  })

  it('opening the dialog pre-fills status/score/note from the CURRENT submission — never resets an existing value to blank/0', () => {
    const fn = source.slice(source.indexOf('function openTargetDialog'), source.indexOf('async function handleSaveTarget'))
    expect(fn).toContain("setStatusDraft(submission?.status ?? 'not_submitted')")
    expect(fn).toMatch(/setScoreDraft\(submission\?\.score !== null && submission\?\.score !== undefined \? String\(submission\.score\) : ''\)/)
    expect(fn).toContain("setNoteDraft(submission?.note ?? '')")
  })
})

describe('SubmissionCheckTab — the dialog: student, assignment, status actions (submitted/late/missing), score, note, Save', () => {
  const source = readSource()
  const dialogBlock = source.slice(source.indexOf('{target && ('), source.indexOf('function SummaryStat'))

  it('shows the student name and assignment title', () => {
    expect(dialogBlock).toContain('{studentDisplayName(target.student)} · {target.assignment.title}')
  })

  it('allows marking submitted, late, and missing via 3 explicit status buttons — STATUS_ACTIONS, no invented 4th status', () => {
    expect(source).toContain("{ key: 'submitted', label: 'ส่งแล้ว' }")
    expect(source).toContain("{ key: 'late', label: 'ส่งช้า' }")
    expect(source).toContain("{ key: 'missing', label: 'ขาดส่ง' }")
    expect(dialogBlock).toContain('STATUS_ACTIONS.map((action) =>')
    expect(dialogBlock).toContain('onClick={() => setStatusDraft(action.key)}')
  })

  it('shows the max score and a numeric score input bounded to [0, maxScore], matching parseScoreInput\'s own validation range', () => {
    expect(dialogBlock).toContain('คะแนน (เต็ม {target.assignment.maxScore})')
    expect(dialogBlock).toContain('type="number"')
    expect(dialogBlock).toContain('min={0}')
    expect(dialogBlock).toContain('max={target.assignment.maxScore}')
  })

  it('explicitly tells the teacher that leaving the score blank is not a score of 0', () => {
    expect(dialogBlock).toContain('เว้นว่างไว้เพื่อตรวจทีหลัง — จะไม่ถูกนับเป็นคะแนน 0')
  })

  it('has an optional note field, reusing setSubmissionNote', () => {
    expect(dialogBlock).toContain('id="submission-check-note"')
    expect(dialogBlock).toContain('value={noteDraft}')
  })

  it('has a Save button wired to handleSaveTarget', () => {
    expect(dialogBlock).toContain('onClick={handleSaveTarget}')
  })
})

describe('SubmissionCheckTab — saving the dialog: status/score/note each go through their own existing production function, only when changed', () => {
  const source = readSource()
  const fn = source.slice(source.indexOf('async function handleSaveTarget'), source.indexOf('async function handleArchiveAssignment'))

  it('validates the raw score input with parseScoreInput before writing anything — blank stays a valid, non-error value', () => {
    expect(fn).toContain('parseScoreInput(scoreDraft, assignment.maxScore)')
    expect(fn).toContain('if (validationError)')
  })

  it('writes status ONLY when the teacher actually changed it', () => {
    expect(fn).toContain('if (statusDraft !== originalStatus)')
    expect(fn).toContain('await setSubmissionStatus(assignment.id, student.id, statusDraft)')
  })

  it('writes score ONLY when it changed, passing the up-to-date effectiveStatus (so a just-picked status is never silently overridden by a stale one)', () => {
    expect(fn).toContain('if (score !== originalScore)')
    expect(fn).toContain('await setSubmissionScore(assignment.id, student.id, score, effectiveStatus)')
    expect(fn).toContain('nextStatusAfterScore(effectiveStatus, score)')
  })

  it('writes the note ONLY when it changed', () => {
    expect(fn).toContain('if (noteDraft !== originalNote)')
    expect(fn).toContain('await setSubmissionNote(assignment.id, student.id, noteDraft)')
  })

  it('a save error is surfaced inline (targetError) and the dialog stays open — no silent failure, no false-success toast', () => {
    expect(fn).toContain('catch (err)')
    expect(fn).toContain('setTargetError(toFriendlyErrorMessage(err')
    expect(fn).not.toMatch(/catch \(err\) \{\s*setTarget\(null\)/)
  })

  it('closes the dialog and toasts ONLY on success', () => {
    const tryBlock = fn.slice(fn.indexOf('try {'), fn.indexOf('} catch'))
    expect(tryBlock).toContain('setTarget(null)')
    expect(tryBlock).toContain("toast('บันทึกแล้ว')")
  })
})

describe('SubmissionCheckTab — bulk actions never send one request per student', () => {
  const source = readSource()

  it('imports bulkMarkSubmissionStatus and buildBulkSubmissionStatusUpdates from submission-bulk-service.ts — the SAME mark_submission_status_bulk path Hermes uses', () => {
    expect(source).toContain("from '@/services/submission-bulk-service'")
    expect(source).toContain('bulkMarkSubmissionStatus')
    expect(source).toContain('buildBulkSubmissionStatusUpdates')
  })

  it('runBulkStatusUpdate is the ONE place any bulk write happens — builds the full cross product, then makes exactly one bulkMarkSubmissionStatus call for the whole batch (chunking happens inside that shared service, not per-student here)', () => {
    const fn = source.slice(source.indexOf('async function runBulkStatusUpdate'), source.indexOf('function handleColumnQuickAction'))
    expect(fn).toContain('buildBulkSubmissionStatusUpdates(studentIds, assignmentIds, status)')
    expect(fn).toContain('await bulkMarkSubmissionStatus(updates)')
    expect(fn).not.toMatch(/updates\.map\(.*await/)
    expect(fn).not.toMatch(/for \(const .* of updates\)[\s\S]{0,80}await (setSubmissionStatus|callTeacherAgentTool)/)
  })

  it('a column\'s "ส่งแล้วทั้งห้อง"/"ขาดส่งทั้งห้อง" quick actions target the WHOLE roster for that ONE assignment, via runBulkStatusUpdate — not a per-student loop', () => {
    const fn = source.slice(source.indexOf('function handleColumnQuickAction'), source.indexOf('function handleSelectionBulkAction'))
    expect(fn).toContain('runBulkStatusUpdate(')
    expect(fn).toContain('roster.map((s) => s.id)')
    expect(fn).toContain('[assignment.id]')
  })

  it('the multi-select bulk bar targets exactly the selected students × selected assignments, via the SAME runBulkStatusUpdate', () => {
    const fn = source.slice(source.indexOf('function handleSelectionBulkAction'), source.indexOf('function openTargetDialog'))
    expect(fn).toContain('runBulkStatusUpdate(Array.from(selectedStudentIds), Array.from(selectedAssignmentIds), status)')
  })

  it('partial failures update local state for only the NON-failed items — a failed pair is never optimistically shown as changed', () => {
    const fn = source.slice(source.indexOf('async function runBulkStatusUpdate'), source.indexOf('function handleColumnQuickAction'))
    expect(fn).toContain('const failedKeys = new Set(result.failures.map(')
    expect(fn).toContain('if (failedKeys.has(')
  })

  it('reports partial failures to the teacher via toast, distinct from the all-success message', () => {
    const fn = source.slice(source.indexOf('async function runBulkStatusUpdate'), source.indexOf('function handleColumnQuickAction'))
    expect(fn).toContain('if (result.failedCount === 0)')
    expect(fn).toMatch(/ไม่สำเร็จ \$\{result\.failedCount\} รายการ/)
  })
})

describe('SubmissionCheckTab — select multiple students (rows) and assignments (columns)', () => {
  const source = readSource()

  it('has a row checkbox per student and a "select all visible" checkbox in the header', () => {
    expect(source).toContain('checked={selectedStudentIds.has(student.id)}')
    expect(source).toContain('onChange={() => toggleStudentSelected(student.id)}')
    expect(source).toContain('checked={allVisibleSelected}')
    expect(source).toContain('onChange={toggleSelectAllVisible}')
  })

  it('has a column checkbox per assignment header, plus a "เลือกทั้งคอลัมน์" menu item doing the exact same toggle', () => {
    expect(source).toContain('checked={selectedAssignmentIds.has(assignment.id)}')
    expect(source).toContain('onChange={() => toggleAssignmentSelected(assignment.id)}')
    expect(source).toContain("label: 'เลือกทั้งคอลัมน์'")
    expect(source).toContain('onSelect: () => toggleAssignmentSelected(assignment.id)')
  })

  it('shows the exact "N นักเรียน × M งาน = X รายการ" summary once anything is selected', () => {
    expect(source).toContain('{selectedStudentIds.size} นักเรียน × {selectedAssignmentIds.size} งาน = {selectionCellCount} รายการ')
    expect(source).toContain('selectionCellCount = selectedStudentIds.size * selectedAssignmentIds.size')
  })

  it('the bulk action buttons are disabled until the cross product is non-empty (both a student AND an assignment are selected)', () => {
    expect(source).toContain('disabled={bulkBusy || selectionCellCount === 0}')
  })

  it('selection resets when the roster or visible assignment set changes shape — never targets a stale row/column', () => {
    const fn = source.slice(source.indexOf('const rosterKey ='), source.indexOf('function toggleStudentSelected'))
    expect(fn).toContain('setSelectedStudentIds(new Set())')
    expect(fn).toContain('setSelectedAssignmentIds(new Set())')
    expect(fn).toContain('}, [rosterKey, assignmentIdsKey])')
  })
})

describe('SubmissionCheckTab — assignment column header: title, max score, due date, compact "..." menu', () => {
  const source = readSource()
  const headerBlock = source.slice(source.indexOf('{visibleAssignments.map((assignment) => ('), source.indexOf('</tr>\n                  </thead>'))

  it('shows the assignment title, max score, and optional due date', () => {
    expect(headerBlock).toContain('{assignment.title}')
    expect(headerBlock).toContain('/{assignment.maxScore}')
    expect(headerBlock).toContain('assignment.dueDate &&')
  })

  it('uses the existing RowActionsMenu primitive for the compact "..." menu — no bespoke dropdown', () => {
    expect(headerBlock).toContain('<RowActionsMenu')
  })

  it('the menu offers แก้ไขงาน, ดูรายละเอียด, เลือกทั้งคอลัมน์, ส่งแล้วทั้งห้อง, ขาดส่งทั้งห้อง, then เก็บถาวรงาน/ลบงาน separated and destructive-marked — no invented destructive action', () => {
    const menuBlock = headerBlock.slice(headerBlock.indexOf('actions={['), headerBlock.indexOf(']}\n                            />'))
    const editIdx = menuBlock.indexOf("label: 'แก้ไขงาน'")
    const viewDetailIdx = menuBlock.indexOf("label: 'ดูรายละเอียด'")
    const selectColIdx = menuBlock.indexOf("label: 'เลือกทั้งคอลัมน์'")
    const submittedIdx = menuBlock.indexOf("label: 'ส่งแล้วทั้งห้อง'")
    const missingIdx = menuBlock.indexOf("label: 'ขาดส่งทั้งห้อง'")
    const archiveIdx = menuBlock.indexOf("label: 'เก็บถาวรงาน'")
    const deleteIdx = menuBlock.indexOf("label: 'ลบงาน'")
    expect(editIdx).toBeGreaterThan(-1)
    expect(viewDetailIdx).toBeGreaterThan(editIdx)
    expect(selectColIdx).toBeGreaterThan(viewDetailIdx)
    expect(submittedIdx).toBeGreaterThan(selectColIdx)
    expect(missingIdx).toBeGreaterThan(submittedIdx)
    expect(archiveIdx).toBeGreaterThan(missingIdx)
    expect(deleteIdx).toBeGreaterThan(archiveIdx)

    const archiveAction = menuBlock.slice(archiveIdx, deleteIdx)
    expect(archiveAction).toContain('separatorBefore: true')
    const deleteAction = menuBlock.slice(deleteIdx)
    expect(deleteAction).toContain('destructive: true')
  })

  it('ดูรายละเอียด navigates to the existing real assignment detail route via buildAssignmentDetailPath — no new route invented', () => {
    expect(source).toContain("from '@/features/subjects-shared/subject-classroom-nav'")
    expect(source).toContain('buildAssignmentDetailPath(subject.id, classroomId, assignment.id)')
    expect(source).toContain('const navigate = useNavigate()')
  })

  it('archive/delete reuse the EXACT same functions and confirm-dialog flow as the งาน tab (assignments-tab.tsx) — archiveAssignment, hasAssignmentSubmissions + deleteAssignmentPermanently, both behind ConfirmDialog — no new destructive behavior invented', () => {
    expect(source).toContain("from '@/components/ui/confirm-dialog'")
    expect(source).toContain('await archiveAssignment(archivingAssignment.id)')
    expect(source).toContain('const hasSubmissions = await hasAssignmentSubmissions(assignment.id)')
    expect(source).toContain('await deleteAssignmentPermanently(assignment.id)')
  })
})

describe('SubmissionCheckTab — summary counters and filters: no "รอตรวจ"/awaiting-review bucket anywhere', () => {
  const source = readSource()

  it('renders exactly the 3 required counters: ตรวจแล้ว, ให้คะแนนแล้ว, ยังไม่ส่ง — no separate "รอตรวจ"/"ส่งแล้ว" split', () => {
    expect(source).toContain('label="ตรวจแล้ว" value={tally.checked}')
    expect(source).toContain('label="ให้คะแนนแล้ว" value={tally.graded}')
    expect(source).toContain('label="ยังไม่ส่ง" value={tally.notSubmitted}')
    expect(source).not.toContain('รอตรวจ')
    expect(source).not.toMatch(/tally\.awaitingReview|tally\.submitted\b/)
  })

  it('the tally and filter both come from the shared pure functions, computed over the CURRENTLY VISIBLE (searched) assignment columns', () => {
    expect(source).toContain('computeSubmissionCheckTally(')
    expect(source).toContain('filterStudentsBySubmissionCheckState(roster, visibleAssignmentIds, submissionsByAssignment, filter)')
  })

  it('renders the filter buttons from SUBMISSION_CHECK_FILTERS (ทั้งหมด/ตรวจแล้ว/ให้คะแนนแล้ว/ยังไม่ส่ง) — no separate, hand-typed filter list, and no "รอตรวจ" filter option', () => {
    expect(source).toContain('SUBMISSION_CHECK_FILTERS.map((f) =>')
  })

  it('has an optional assignment search box that only appears once there are enough assignments to make the matrix wide', () => {
    expect(source).toContain('assignments.length > 4 &&')
    expect(source).toContain('ค้นหางาน...')
    expect(source).toContain('searchAssignmentsByTitle(assignments, assignmentQuery)')
  })
})

describe('SubmissionCheckTab — green ✓ IS "ตรวจแล้ว": no separate reviewed/checked state, score stays fully optional', () => {
  const source = readSource()

  it('a submitted (including Hermes-marked) cell with no score renders the green ✓ directly — clicking it opens the SAME dialog as any other cell, never a forced/mandatory score step', () => {
    expect(source).toContain('onClick={() => openTargetDialog(assignment, student)}')
    const saveFn = source.slice(source.indexOf('async function handleSaveTarget'), source.indexOf('async function handleArchiveAssignment'))
    expect(saveFn).not.toMatch(/if \(!scoreDraft\)/)
    expect(saveFn).not.toMatch(/scoreDraft is required/i)
  })

  it('never reintroduces a reviewed/checked concept distinct from status — no reviewedAt, no setSubmissionReviewed/bulkSetSubmissionsReviewed, no "checked" cell state, no separate "ตรวจแล้ว" bulk-mark action', () => {
    expect(source).not.toMatch(/reviewedAt/)
    expect(source).not.toContain('setSubmissionReviewed')
    expect(source).not.toContain('bulkSetSubmissionsReviewed')
    expect(source).not.toContain("state === 'checked'")
    expect(source).not.toContain("label: 'ตรวจแล้วทั้งห้อง'")
    expect(source).not.toContain('runBulkReviewUpdate')
  })

  it('bulk actions only ever write `status` — the optimistic update spreads `existing` and overrides only `status`; the sole `score:` reference left is the untouched `null` default on a brand-new local record, and setSubmissionScore is never called from a bulk path', () => {
    const fn = source.slice(source.indexOf('async function runBulkStatusUpdate'), source.indexOf('function handleColumnQuickAction'))
    const scoreMatches = fn.match(/score:/g) ?? []
    const scoreNullMatches = fn.match(/score: null/g) ?? []
    expect(scoreMatches.length).toBeGreaterThan(0)
    expect(scoreMatches.length).toBe(scoreNullMatches.length)
    expect(fn).toContain('{ ...existing, status: update.status }')
    expect(fn).not.toContain('setSubmissionScore')
  })
})

describe('SubmissionCheckTab — layout: sticky columns/headers, horizontally scrollable, compact rows', () => {
  const source = readSource()

  it('the student-name column is sticky left, the assignment header row is sticky top, inside a scrollable container', () => {
    expect(source).toContain('sticky left-0 top-0 z-20 bg-card')
    expect(source).toContain('sticky top-0 z-10')
    expect(source).toContain('sticky left-0 z-10 whitespace-nowrap bg-card')
    expect(source).toContain('overflow-auto')
  })

  it('uses compact cell padding (px-2 py-1.5) rather than large card-like spacing, supporting many rows/columns comfortably', () => {
    expect(source).toContain('px-2 py-1.5')
  })
})
