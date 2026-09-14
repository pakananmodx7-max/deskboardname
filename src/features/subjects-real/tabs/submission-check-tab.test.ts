import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./submission-check-tab.tsx', import.meta.url), 'utf-8')
}

// ==================================================
// SubmissionCheckTab (ตรวจสอบงาน) — source-text guards, the same
// convention every other real, Supabase-backed tab in this codebase uses
// (see grades-tab.test.ts) since vitest.config.ts runs in a `node`
// environment with no DOM. The underlying pure logic
// (computeSubmissionCellState, computeSubmissionCheckTally,
// filterStudentsBySubmissionCheckState, searchAssignmentsByTitle) is
// covered with REAL, executed unit tests in
// src/services/assignment-service.test.ts — this file only pins down
// how the component wires that logic together.
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

  it('never writes to a new/different table — the only mutation is setSubmissionScore, the exact function GradesTab and the assignment detail page already use', () => {
    expect(source).toContain("from '@/services/assignment-service'")
    expect(source).toContain('setSubmissionScore(assignment.id, student.id, score, currentStatus)')
    expect(source).not.toMatch(/\.from\('assignment_submissions'\)/) // no raw Supabase query in the component itself
  })
})

describe('SubmissionCheckTab — cell rendering: submitted-but-ungraded is never score 0', () => {
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

  it('submitted_ungraded renders a green check (CheckCircle2) with NO score text next to it — visually distinct from the graded "✓ score/max" branch', () => {
    const cellFn = source.slice(source.indexOf('function SubmissionCellVisual'))
    const ungradedBranch = cellFn.slice(cellFn.indexOf("state === 'submitted_ungraded'"), cellFn.indexOf("state === 'late_ungraded'"))
    expect(ungradedBranch).toContain('CheckCircle2')
    expect(ungradedBranch).not.toMatch(/\{score\}/)
  })

  it('late_ungraded gets its own distinct (amber/warning) visual, not conflated with submitted_ungraded', () => {
    const cellFn = source.slice(source.indexOf('function SubmissionCellVisual'))
    const lateBranch = cellFn.slice(cellFn.indexOf("state === 'late_ungraded'"), cellFn.indexOf("state === 'missing'"))
    expect(lateBranch).toContain('Clock3')
    expect(lateBranch).toContain('text-warning-foreground')
  })

  it('the tooltip/label text comes from SUBMISSION_CELL_STATE_LABEL — includes the exact required "ส่งแล้ว · รอตรวจ" wording, never invented copy', () => {
    expect(source).toContain('title={SUBMISSION_CELL_STATE_LABEL[state]}')
  })
})

describe('SubmissionCheckTab — clicking a submitted ✓ cell opens the grading dialog; not_submitted/missing cells do not', () => {
  const source = readSource()

  it('a cell is clickable (button not disabled) exactly when isSubmissionCellGradable(state) is true', () => {
    expect(source).toContain('const gradable = isSubmissionCellGradable(state)')
    expect(source).toContain('disabled={!gradable}')
    expect(source).toContain('onClick={() => openGradingDialog(assignment, student)}')
  })

  it('openGradingDialog itself re-checks isSubmissionCellGradable and refuses to open for a non-gradable state (defense in depth, not just a disabled button)', () => {
    const fn = source.slice(source.indexOf('function openGradingDialog'), source.indexOf('async function handleSaveScore'))
    expect(fn).toContain('if (!isSubmissionCellGradable(state)) return')
  })

  it('opening the dialog pre-fills the score input from the CURRENT score — never resets an existing score to blank/0', () => {
    const fn = source.slice(source.indexOf('function openGradingDialog'), source.indexOf('async function handleSaveScore'))
    expect(fn).toMatch(/setScoreDraft\(submission\?\.score !== null && submission\?\.score !== undefined \? String\(submission\.score\) : ''\)/)
  })
})

describe('SubmissionCheckTab — the grading dialog: student, assignment, status, max score, score input, Save', () => {
  const source = readSource()
  const dialogBlock = source.slice(source.indexOf('{gradingTarget && ('), source.indexOf('function SummaryStat'))

  it('shows the student name and assignment title', () => {
    expect(dialogBlock).toContain('{studentDisplayName(gradingTarget.student)} · {gradingTarget.assignment.title}')
  })

  it('shows the current submission status label (derived, never a raw enum value)', () => {
    expect(dialogBlock).toContain('SUBMISSION_CELL_STATE_LABEL[')
  })

  it('shows the max score', () => {
    expect(dialogBlock).toContain('คะแนน (เต็ม {gradingTarget.assignment.maxScore})')
  })

  it('has a numeric score input bounded to [0, maxScore], matching parseScoreInput\'s own validation range', () => {
    expect(dialogBlock).toContain('type="number"')
    expect(dialogBlock).toContain('min={0}')
    expect(dialogBlock).toContain('max={gradingTarget.assignment.maxScore}')
  })

  it('explicitly tells the teacher that leaving it blank is not a score of 0', () => {
    expect(dialogBlock).toContain('เว้นว่างไว้เพื่อตรวจทีหลัง — จะไม่ถูกนับเป็นคะแนน 0')
  })

  it('has a Save button wired to handleSaveScore', () => {
    expect(dialogBlock).toContain('onClick={handleSaveScore}')
  })
})

describe('SubmissionCheckTab — saving a score reuses the exact production write path and its transition rule', () => {
  const source = readSource()
  const fn = source.slice(source.indexOf('async function handleSaveScore'), source.indexOf('function SummaryStat'))

  it('validates the raw input with parseScoreInput before writing anything — blank stays a valid, non-error value', () => {
    expect(fn).toContain('parseScoreInput(scoreDraft, assignment.maxScore)')
    expect(fn).toContain('if (validationError)')
  })

  it('calls the exact same setSubmissionScore(assignmentId, studentId, score, currentStatus) as GradesTab and the assignment detail page', () => {
    expect(fn).toContain('await setSubmissionScore(assignment.id, student.id, score, currentStatus)')
  })

  it('applies nextStatusAfterScore locally after a successful save, matching GradesTab\'s own optimistic-update shape exactly', () => {
    expect(fn).toContain('nextStatusAfterScore(currentStatus, score)')
  })

  it('a save error is surfaced inline (scoreError) and the dialog stays open — no silent failure, no false-success toast', () => {
    expect(fn).toContain('catch (err)')
    expect(fn).toContain('setScoreError(toFriendlyErrorMessage(err')
    expect(fn).not.toMatch(/catch \(err\) \{\s*setGradingTarget\(null\)/)
  })

  it('closes the dialog and toasts ONLY on success', () => {
    const tryBlock = fn.slice(fn.indexOf('try {'), fn.indexOf('} catch'))
    expect(tryBlock).toContain('setGradingTarget(null)')
    expect(tryBlock).toContain('toast(')
  })
})

describe('SubmissionCheckTab — summary counters and filters', () => {
  const source = readSource()

  it('renders exactly the 4 required counters: ส่งแล้ว, รอตรวจ, ตรวจแล้ว, ยังไม่ส่ง', () => {
    expect(source).toContain('label="ส่งแล้ว" value={tally.submitted}')
    expect(source).toContain('label="รอตรวจ" value={tally.awaitingReview}')
    expect(source).toContain('label="ตรวจแล้ว" value={tally.graded}')
    expect(source).toContain('label="ยังไม่ส่ง" value={tally.notSubmitted}')
  })

  it('the tally and filter both come from the shared pure functions, computed over the CURRENTLY VISIBLE (searched) assignment columns', () => {
    expect(source).toContain('computeSubmissionCheckTally(')
    expect(source).toContain('filterStudentsBySubmissionCheckState(roster, visibleAssignmentIds, submissionsByAssignment, filter)')
  })

  it('renders the filter buttons from SUBMISSION_CHECK_FILTERS (ทั้งหมด/รอตรวจ/ตรวจแล้ว/ยังไม่ส่ง) — no separate, hand-typed filter list', () => {
    expect(source).toContain('SUBMISSION_CHECK_FILTERS.map((f) =>')
  })

  it('has an optional assignment search box that only appears once there are enough assignments to make the matrix wide', () => {
    expect(source).toContain('assignments.length > 4 &&')
    expect(source).toContain('ค้นหางาน...')
    expect(source).toContain('searchAssignmentsByTitle(assignments, assignmentQuery)')
  })
})

describe('SubmissionCheckTab — layout: sticky columns/headers, horizontally scrollable', () => {
  const source = readSource()

  it('the student-name column is sticky left, the assignment header row is sticky top, inside a scrollable container', () => {
    expect(source).toContain('sticky left-0 top-0 z-20 bg-card')
    expect(source).toContain('sticky top-0 z-10 bg-card')
    expect(source).toContain('sticky left-0 z-10 whitespace-nowrap bg-card')
    expect(source).toContain('overflow-auto')
  })
})
