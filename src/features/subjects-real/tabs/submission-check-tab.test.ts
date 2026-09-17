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

describe('SubmissionCheckTab — cell rendering: grading (score) is exclusive to ทั้งหมด, ส่งแล้ว/ขาดส่ง are pure score-free views', () => {
  const source = readSource()

  it('computes each cell\'s display via computeCellDisplay(mode, status, score) — status/score straight from the fetched submission, never defaulted to 0', () => {
    const cellFn = source.slice(source.indexOf('function CellVisual'))
    expect(cellFn).toContain('display.kind === ')
    expect(source).toContain("const display = computeCellDisplay(mode, submission?.status ?? 'not_submitted', submission?.score ?? null)")
  })

  it('REGRESSION — the ONLY kind that ever renders a score is {kind: submitted} (produced exclusively in ทั้งหมด mode) — a null score renders the "—" placeholder, never a literal 0, and an explicit 0 renders the literal "0/{maxScore}", never "—"', () => {
    const cellFn = source.slice(source.indexOf('function CellVisual'), source.indexOf('function CellVisual') + 1200)
    expect(cellFn).toContain('CheckCircle2')
    expect(cellFn).toContain("display.score === null ? '—' : `${display.score}/${maxScore}`")
    expect(cellFn).not.toContain('score ?? 0')
  })

  it('REGRESSION — {kind: submitted-plain} (ส่งแล้ว mode\'s matching cell) renders a BARE ✓ — no score, no "/max", no "—" placeholder in that branch', () => {
    const cellFn = source.slice(source.indexOf('function CellVisual'))
    const plainBranch = cellFn.slice(cellFn.indexOf("display.kind === 'submitted-plain'"), cellFn.indexOf("display.kind === 'submitted'"))
    expect(plainBranch).toContain('CheckCircle2')
    expect(plainBranch).not.toContain('maxScore')
    expect(plainBranch).not.toContain("'—'")
  })

  it('missing renders ONLY "ขาดส่ง" — no score field, no CheckCircle2, no placeholder', () => {
    const cellFn = source.slice(source.indexOf('function CellVisual'))
    const missingBranch = cellFn.slice(cellFn.indexOf("display.kind === 'missing'"), cellFn.indexOf("display.kind === 'submitted-plain'"))
    expect(missingBranch).toContain('ขาดส่ง')
    expect(missingBranch).not.toContain('CheckCircle2')
  })

  it('REGRESSION — a non-matching ("blank") cell in ส่งแล้ว/ขาดส่ง mode renders truly empty — no "—" placeholder, which would read as its own third visual state', () => {
    const cellFn = source.slice(source.indexOf('function CellVisual'))
    expect(cellFn).toContain('return null')
  })

  it('the tooltip/label text comes from cellTitle and reads "ขาดส่ง"/ส่งแล้ว copy for their own matching cells — never "ตรวจแล้ว"/"รอตรวจ"/awaiting-review copy', () => {
    expect(source).toContain('title={cellTitle(display)}')
    const titleFn = source.slice(source.indexOf('function cellTitle'), source.indexOf('function CellVisual'))
    expect(titleFn).toContain("return 'ขาดส่ง'")
    expect(titleFn).toContain('ส่งแล้ว')
    expect(source).not.toContain('รอตรวจ')
    expect(source).not.toContain('ตรวจแล้ว')
  })

  it('REGRESSION — cell display is computed with the CURRENT mode as its first argument — this is exactly what stops score UI from leaking into ส่งแล้ว/ขาดส่ง (the mode decides which CellDisplay kind is even possible)', () => {
    expect(source).toContain('computeCellDisplay(mode, submission?.status')
  })

  it('REGRESSION — CellDisplay has exactly 4 kinds: submitted (scored, ทั้งหมด-only), submitted-plain (ส่งแล้ว), missing, and an implicit "blank" (non-matching cell in a narrow mode, handled by the trailing `return null` — never a "score"-named kind', () => {
    expect(source).not.toContain("kind === 'score'")
    expect(source).toContain("kind === 'submitted-plain'")
    const cellFn = source.slice(source.indexOf('function CellVisual'))
    expect(cellFn.trim().endsWith('return null\n}')).toBe(true) // the blank/non-matching fallthrough
  })

  it('CellDisplay/computeCellDisplay are imported from the shared assignment-service.ts, never re-implemented in this component', () => {
    expect(source).toContain('computeCellDisplay,')
    expect(source).toContain('type CellDisplay,')
    expect(source).toContain("from '@/services/assignment-service'")
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

describe('SubmissionCheckTab — exactly 3 modes (ทั้งหมด/ส่งแล้ว/ขาดส่ง), ONE mathematically-honest item counter per mode, no separate "ให้คะแนน" mode and no "รอตรวจ"/"ตรวจแล้ว"/awaiting-review bucket anywhere', () => {
  const source = readSource()

  it('REGRESSION — there is no separate score-only mode anywhere: no "score" key in SUBMISSION_CHECK_MODES, no "ให้คะแนน" mode label, no mode-gated score bar', () => {
    expect(source).not.toMatch(/key: 'score'/)
    expect(source).not.toContain("mode === 'score'")
    expect(source).not.toContain("{ key: 'score', label: 'ให้คะแนน' }")
  })

  it('renders ONE counter matching the active mode, built from SUBMISSION_CHECK_MODE_COUNT_LABEL + an ITEM count for the 2 narrow modes — never a 3-way split into unrelated buckets', () => {
    expect(source).toContain('label={`${SUBMISSION_CHECK_MODE_COUNT_LABEL[mode]} ${modeItemCount} รายการ`}')
    expect(source).not.toContain('รอตรวจ')
    expect(source).not.toContain('ตรวจแล้ว')
    expect(source).not.toMatch(/tally\.awaitingReview|tally\.checked\b|modeItemCount\.checked/)
  })

  it('REGRESSION — ทั้งหมด mode renders its OWN combined ส่งแล้ว/ขาดส่ง-vs-expected-total summary, computed from computeModeItemCount(...,\'submitted\')/(...,\'missing\') + computeExpectedItemCount, never the single-mode counter', () => {
    expect(source).toContain("mode === 'all' ?")
    expect(source).toContain("computeModeItemCount(rosterIds, visibleAssignmentIds, submissionsByAssignment, 'submitted')")
    expect(source).toContain("computeModeItemCount(rosterIds, visibleAssignmentIds, submissionsByAssignment, 'missing')")
    expect(source).toContain('computeExpectedItemCount(rosterIds, visibleAssignmentIds)')
    expect(source).toContain('ส่งแล้ว ${modeSubmittedCount} · ขาดส่ง ${modeMissingCount} จาก ${modeExpectedCount} รายการ')
  })

  it('the counter and the row filter both come from the shared pure mode functions, computed over the CURRENTLY VISIBLE (searched) assignment columns', () => {
    expect(source).toContain('computeModeItemCount(')
    expect(source).toContain('filterStudentsByCheckMode(roster, visibleAssignmentIds, submissionsByAssignment, mode)')
  })

  it('renders the mode toggle buttons from SUBMISSION_CHECK_MODES — no separate, hand-typed mode list, and no "รอตรวจ"/"ตรวจแล้ว" mode option', () => {
    expect(source).toContain('SUBMISSION_CHECK_MODES.map((m) =>')
    expect(source).toContain('onClick={() => setMode(m.key)}')
  })

  it('REGRESSION — defaults to ทั้งหมด mode on first load — the full classroom overview, not a narrowed filter', () => {
    expect(source).toContain("useState<SubmissionCheckMode>('all')")
  })

  it('has an optional assignment search box that only appears once there are enough assignments to make the matrix wide', () => {
    expect(source).toContain('assignments.length > 4 &&')
    expect(source).toContain('ค้นหางาน...')
    expect(source).toContain('searchAssignmentsByTitle(assignments, assignmentQuery)')
  })
})

describe('SubmissionCheckTab — green ✓ IS "ส่งแล้ว": no separate reviewed/checked/"ตรวจแล้ว" state, score stays fully optional', () => {
  const source = readSource()

  it('a submitted (including Hermes-marked) cell with no score renders the green ✓ directly — clicking it opens the SAME dialog as any other cell, never a forced/mandatory score step', () => {
    expect(source).toContain('onClick={() => openTargetDialog(assignment, student)}')
    const saveFn = source.slice(source.indexOf('async function handleSaveTarget'), source.indexOf('async function handleArchiveAssignment'))
    expect(saveFn).not.toMatch(/if \(!scoreDraft\)/)
    expect(saveFn).not.toMatch(/scoreDraft is required/i)
  })

  it('never reintroduces a reviewed/checked concept distinct from status/score — no reviewedAt, no setSubmissionReviewed/bulkSetSubmissionsReviewed, no "checked"/"รอตรวจ" mode or cell kind, no "ตรวจแล้ว" label or bulk-mark action anywhere', () => {
    expect(source).not.toMatch(/reviewedAt/)
    expect(source).not.toContain('setSubmissionReviewed')
    expect(source).not.toContain('bulkSetSubmissionsReviewed')
    expect(source).not.toContain("kind === 'checked'")
    expect(source).not.toContain("mode === 'checked'")
    expect(source).not.toContain('ตรวจแล้ว')
    expect(source).not.toContain('รอตรวจ')
    expect(source).not.toContain('runBulkReviewUpdate')
  })

  it('bulk STATUS actions only ever write `status` — the optimistic update spreads `existing` and overrides only `status`; the sole `score:` reference left is the untouched `null` default on a brand-new local record, and setSubmissionScore is never called from that path', () => {
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

describe('SubmissionCheckTab — three ways to select students: individual, all visible, entire classroom', () => {
  const source = readSource()

  it('a per-student checkbox and a "select all visible" header checkbox already exist (covered above) — "select entire classroom" is a THIRD, distinct action that ignores the current status filter', () => {
    const fn = source.slice(source.indexOf('function handleSelectEntireClassroom'), source.indexOf('async function runBulkStatusUpdate'))
    expect(fn).toContain('setSelectedStudentIds(new Set(roster.map((s) => s.id)))')
    expect(fn).not.toContain('filteredRoster')
  })

  it('the button is labeled "เลือกทั้งห้อง" with the full roster count, disabled only when the roster is empty', () => {
    expect(source).toContain('เลือกทั้งห้อง ({roster.length})')
    expect(source).toContain('onClick={handleSelectEntireClassroom}')
    expect(source).toContain('disabled={roster.length === 0}')
  })
})

describe('SubmissionCheckTab — bulk grading controls: exactly one assignment selected + one or more students, ALWAYS skipping missing students by default', () => {
  const source = readSource()

  it('imports the bulk score write path (score-bulk-service.ts), the bulk score validator (parseBulkScoreInput), and the submitted-only gate (filterSubmittedStudentIds) — never a raw write or a re-implemented validator', () => {
    expect(source).toContain("from '@/services/score-bulk-service'")
    expect(source).toContain('bulkSetAssignmentScores')
    expect(source).toContain('buildBulkScoreUpdates')
    expect(source).toContain('parseBulkScoreInput')
    expect(source).toContain('filterSubmittedStudentIds')
  })

  it('singleSelectedAssignment is derived ONLY when exactly one assignment is selected — the bulk grading bar has no meaning across multiple assignment columns', () => {
    expect(source).toContain('selectedAssignmentIds.size === 1 ? Array.from(selectedAssignmentIds)[0] : null')
    expect(source).toContain('singleSelectedAssignment && selectedStudentIds.size > 0')
  })

  it('REGRESSION — the grading bar is gated behind ทั้งหมด mode ONLY — it never renders in ส่งแล้ว/ขาดส่ง, and there is no separate "score" mode either', () => {
    expect(source).toContain("{mode === 'all' && singleSelectedAssignment && selectedStudentIds.size > 0 && (")
    expect(source).not.toMatch(/mode === 'score'/)
  })

  it('REGRESSION — shows the submitted/ขาดส่ง split for the current selection × the one selected assignment, via computeSubmittedMissingSplit', () => {
    expect(source).toContain('computeSubmittedMissingSplit(Array.from(selectedStudentIds), singleSelectedAssignmentId, submissionsByAssignment)')
    expect(source).toContain('ส่งแล้ว {selectionSubmittedMissingSplit.submittedCount} · ขาดส่ง {selectionSubmittedMissingSplit.missingCount}')
  })

  it('changing the selected assignment resets the score draft — a score typed for one assignment\'s max never silently carries over to another', () => {
    const fn = source.slice(source.indexOf('useEffect(() => {\n    // A score typed'), source.indexOf('[singleSelectedAssignmentId])') + 30)
    expect(fn).toContain("setBulkScoreDraft('')")
    expect(fn).toContain('setBulkScoreError(null)')
  })

  it('"เต็มคะแนน" quick-fills the draft with the selected assignment\'s own max score', () => {
    const fn = source.slice(source.indexOf('function handleBulkScoreFullMark'), source.indexOf('function handleOpenBulkGradeConfirm'))
    expect(fn).toContain('setBulkScoreDraft(String(singleSelectedAssignment.maxScore))')
  })

  it('validates via parseBulkScoreInput before opening the confirmation step — blank/negative/over-max are all rejected inline, never silently coerced', () => {
    const fn = source.slice(source.indexOf('function handleOpenBulkGradeConfirm'), source.indexOf('function handleBulkGradeSubmittedFullMarks'))
    expect(fn).toContain('parseBulkScoreInput(bulkScoreDraft, singleSelectedAssignment.maxScore)')
    expect(fn).toContain('if (validationError || value === null)')
    expect(fn).toContain('setBulkScoreError(')
  })

  it('REGRESSION — "ให้คะแนนคนที่ส่งแล้ว" (handleOpenBulkGradeConfirm) narrows the selection to submitted students via filterSubmittedStudentIds BEFORE opening the confirmation dialog — missing students in the same selection are excluded, never scored', () => {
    const fn = source.slice(source.indexOf('function handleOpenBulkGradeConfirm'), source.indexOf('function handleBulkGradeSubmittedFullMarks'))
    expect(fn).toContain('filterSubmittedStudentIds(')
    expect(fn).toContain('Array.from(selectedStudentIds)')
    expect(fn).toContain('singleSelectedAssignment.id')
    expect(fn).toContain('setPendingBulkGrade({ assignment: singleSelectedAssignment, studentIds: submittedStudentIds, score: value })')
    expect(fn).not.toContain('studentIds: Array.from(selectedStudentIds)')
  })

  it('REGRESSION — "เต็มคะแนนคนที่ส่งแล้ว" (handleBulkGradeSubmittedFullMarks) ALSO narrows to submitted students via the SAME filterSubmittedStudentIds gate before opening the SAME confirmation dialog with the max score', () => {
    const fn = source.slice(source.indexOf('function handleBulkGradeSubmittedFullMarks'), source.indexOf('async function runBulkScoreUpdate'))
    expect(fn).toContain('filterSubmittedStudentIds(')
    expect(fn).toContain('setPendingBulkGrade({ assignment: singleSelectedAssignment, studentIds: submittedStudentIds, score: singleSelectedAssignment.maxScore })')
  })

  it('both grading buttons are disabled once the submitted subset of the current selection is empty — clicking them can never assign a score to a purely-missing selection', () => {
    expect(source).toContain('disabled={bulkBusy || selectionSubmittedMissingSplit.submittedCount === 0}')
    expect(source).toContain('ให้คะแนนคนที่ส่งแล้ว')
    expect(source).toContain('เต็มคะแนนคนที่ส่งแล้ว')
  })

  it('the confirmation dialog text is exactly "กำลังให้คะแนน X/max แก่นักเรียน N คน" — N already reflects the submitted-only student list, not the wider selection', () => {
    expect(source).toContain(
      'description={`กำลังให้คะแนน ${pendingBulkGrade.score}/${pendingBulkGrade.assignment.maxScore} แก่นักเรียน ${pendingBulkGrade.studentIds.length} คน`}',
    )
    expect(source).toContain('title="ยืนยันการให้คะแนน"')
  })

  it('runBulkScoreUpdate builds updates via buildBulkScoreUpdates and makes exactly ONE bulkSetAssignmentScores call for the whole batch — never one request per student', () => {
    const fn = source.slice(source.indexOf('async function runBulkScoreUpdate'), source.indexOf('async function handleConfirmBulkGrade'))
    expect(fn).toContain('buildBulkScoreUpdates(studentIds, assignmentId, score)')
    expect(fn).toContain('await bulkSetAssignmentScores(updates)')
    expect(fn).not.toMatch(/updates\.map\(.*await/)
    expect(fn).not.toMatch(/for \(const .* of updates\)[\s\S]{0,80}await/)
  })

  it('after a successful write, the matrix is RE-FETCHED from the real source of truth (await refresh()) — not just an optimistic local patch', () => {
    const fn = source.slice(source.indexOf('async function runBulkScoreUpdate'), source.indexOf('async function handleConfirmBulkGrade'))
    const resultIndex = fn.indexOf('const result = await bulkSetAssignmentScores(updates)')
    const refreshIndex = fn.indexOf('await refresh()')
    expect(resultIndex).toBeGreaterThan(-1)
    expect(refreshIndex).toBeGreaterThan(resultIndex)
  })

  it('reports changed/unchanged/failed counts via toast, distinct from the all-success message', () => {
    const fn = source.slice(source.indexOf('async function runBulkScoreUpdate'), source.indexOf('async function handleConfirmBulkGrade'))
    expect(fn).toContain('if (result.failedCount === 0)')
    expect(fn).toMatch(/ให้คะแนนแล้ว \$\{result\.changedCount \+ result\.unchangedCount\}\/\$\{result\.requestedCount\} คน/)
    expect(fn).toMatch(/ไม่สำเร็จ \$\{result\.failedCount\} คน/)
  })

  it('a partial failure sets bulkGradeFailures (named per student, with the server\'s own message) — this is what makes "partial failures must be visible" true beyond a transient toast', () => {
    const fn = source.slice(source.indexOf('async function runBulkScoreUpdate'), source.indexOf('async function handleConfirmBulkGrade'))
    expect(fn).toContain('setBulkGradeFailures(')
    expect(fn).toContain('result.failures.map((f) =>')
    expect(fn).toContain('studentDisplayName(student)')
  })

  it('the failures panel is a persistent, dismissible inline box (not just a toast), rendered only when bulkGradeFailures is non-empty', () => {
    expect(source).toContain('bulkGradeFailures.length > 0 &&')
    expect(source).toContain('ให้คะแนนไม่สำเร็จ {bulkGradeFailures.length} คน')
    expect(source).toContain('onClick={() => setBulkGradeFailures([])}')
  })

  it('handleConfirmBulkGrade closes the dialog THEN runs the write — the dialog is never left open during the write', () => {
    const fn = source.slice(source.indexOf('async function handleConfirmBulkGrade'), source.indexOf('function handleGradeWholeClassroom'))
    const closeIndex = fn.indexOf('setPendingBulkGrade(null)')
    const runIndex = fn.indexOf('await runBulkScoreUpdate(studentIds, assignment.id, score)')
    expect(closeIndex).toBeGreaterThan(-1)
    expect(runIndex).toBeGreaterThan(closeIndex)
  })

  it('individual per-cell score editing is completely untouched — the dialog\'s own handleSaveTarget still calls setSubmissionScore directly, never routed through the bulk path', () => {
    expect(source).toContain('await setSubmissionScore(assignment.id, student.id, score, effectiveStatus)')
  })
})

describe('SubmissionCheckTab — assignment header menu: ให้คะแนนทั้งห้อง / เต็มคะแนนคนที่ส่งแล้วทั้งห้อง shortcuts into the same bulk grading path', () => {
  const source = readSource()
  const headerBlock = source.slice(source.indexOf('{visibleAssignments.map((assignment) => ('), source.indexOf('</tr>\n                  </thead>'))
  const menuBlock = headerBlock.slice(headerBlock.indexOf('actions={['), headerBlock.indexOf(']}\n                            />'))

  it('both grading menu items exist, positioned after the status quick actions and before archive/delete', () => {
    const missingIdx = menuBlock.indexOf("label: 'ขาดส่งทั้งห้อง'")
    const gradeIdx = menuBlock.indexOf("label: 'ให้คะแนนทั้งห้อง'")
    const gradeFullIdx = menuBlock.indexOf("label: 'เต็มคะแนนคนที่ส่งแล้วทั้งห้อง'")
    const archiveIdx = menuBlock.indexOf("label: 'เก็บถาวรงาน'")
    expect(gradeIdx).toBeGreaterThan(missingIdx)
    expect(gradeFullIdx).toBeGreaterThan(gradeIdx)
    expect(archiveIdx).toBeGreaterThan(gradeFullIdx)
  })

  it('"ให้คะแนนทั้งห้อง" selects this ONE assignment plus the entire roster, letting the teacher type a score in the same sticky bar — no separate write path', () => {
    const fn = source.slice(source.indexOf('function handleGradeWholeClassroom('), source.indexOf('function handleGradeWholeClassroomFullMarks'))
    expect(fn).toContain('setSelectedAssignmentIds(new Set([assignment.id]))')
    expect(fn).toContain('setSelectedStudentIds(new Set(roster.map((s) => s.id)))')
    expect(fn).not.toContain('bulkSetAssignmentScores')
  })

  it('REGRESSION — "เต็มคะแนนคนที่ส่งแล้วทั้งห้อง" pre-fills the max score and goes straight to the SAME required confirmation dialog, but ONLY for students who actually submitted this assignment — filterSubmittedStudentIds runs over the WHOLE roster before the write, so selecting the whole classroom never grades a missing student', () => {
    const fn = source.slice(source.indexOf('function handleGradeWholeClassroomFullMarks'), source.indexOf('function openTargetDialog'))
    expect(fn).toContain('filterSubmittedStudentIds(allStudentIds, assignment.id, submissionsByAssignment)')
    expect(fn).toContain('setBulkScoreDraft(String(assignment.maxScore))')
    expect(fn).toContain('setPendingBulkGrade({ assignment, studentIds: submittedStudentIds, score: assignment.maxScore })')
    expect(fn).not.toContain('studentIds: allStudentIds')
    expect(fn).not.toContain('bulkSetAssignmentScores')
    expect(fn).not.toContain('runBulkScoreUpdate(')
  })

  it('menu items are disabled while a bulk action is in flight, same as the existing ทั้งห้อง status shortcuts', () => {
    expect(menuBlock).toMatch(/label: 'ให้คะแนนทั้งห้อง',\s*disabled: bulkBusy/)
    expect(menuBlock).toMatch(/label: 'เต็มคะแนนคนที่ส่งแล้วทั้งห้อง',\s*disabled: bulkBusy/)
  })

  it('REGRESSION — the STATUS quick actions (ส่งแล้วทั้งห้อง/ขาดส่งทั้งห้อง) stay gated behind their own matching ส่งแล้ว/ขาดส่ง mode, and the 2 GRADING shortcuts are gated behind ทั้งหมด mode ONLY — grading never appears in ส่งแล้ว/ขาดส่ง, matching the matrix cells\' own rule', () => {
    expect(menuBlock).toContain("...(mode === 'submitted'")
    expect(menuBlock).toContain("...(mode === 'missing'")
    expect(menuBlock).toContain("...(mode === 'all'")
    expect(menuBlock).not.toContain("...(mode === 'score'")
    // the mark-submitted item lives INSIDE the mode === 'submitted' branch, not unconditionally
    const submittedBranch = menuBlock.slice(menuBlock.indexOf("...(mode === 'submitted'"), menuBlock.indexOf("...(mode === 'missing'"))
    expect(submittedBranch).toContain("label: 'ส่งแล้วทั้งห้อง'")
    const missingBranch = menuBlock.slice(menuBlock.indexOf("...(mode === 'missing'"), menuBlock.indexOf("...(mode === 'all'"))
    expect(missingBranch).toContain("label: 'ขาดส่งทั้งห้อง'")
    // the grading items live INSIDE the mode === 'all' branch, not unconditionally
    const allBranch = menuBlock.slice(menuBlock.indexOf("...(mode === 'all'"), menuBlock.indexOf("key: 'archive'"))
    expect(allBranch).toContain("key: 'grade-classroom'")
    expect(allBranch).toContain("key: 'grade-classroom-full'")
  })
})

describe('SubmissionCheckTab — the ONE bulk-status action button matches the active mode exactly', () => {
  const source = readSource()

  it('MODE_BULK_STATUS_ACTION maps ส่งแล้ว mode to a "submitted" write and ขาดส่ง mode to a "missing" write — no multi-button status picker in the bulk bar', () => {
    expect(source).toContain("submitted: { status: 'submitted', label: 'ทำเครื่องหมายว่าส่งแล้ว' }")
    expect(source).toContain("missing: { status: 'missing', label: 'ทำเครื่องหมายว่าขาดส่ง' }")
  })

  it('the bulk-status button renders only in ส่งแล้ว/ขาดส่ง mode — never in ให้คะแนน mode', () => {
    expect(source).toContain("(mode === 'submitted' || mode === 'missing') &&")
    expect(source).toContain('onClick={() => handleSelectionBulkAction(MODE_BULK_STATUS_ACTION[mode].status)}')
  })

  it('never renders a 3-button STATUS_ACTIONS picker in the selection bar (that stays exclusive to the per-cell dialog)', () => {
    const selectionBarBlock = source.slice(
      source.indexOf('{(selectedStudentIds.size > 0 || selectedAssignmentIds.size > 0) && ('),
      source.indexOf('{bulkGradeFailures.length > 0 &&'),
    )
    expect(selectionBarBlock).not.toContain('STATUS_ACTIONS.map((action) =>')
  })
})
