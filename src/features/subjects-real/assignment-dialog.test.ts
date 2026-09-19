import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./assignment-dialog.tsx', import.meta.url), 'utf-8')
}

// ==================================================
// AssignmentDialog — "ห้องที่ใช้" cross-classroom create picker. Restores
// the "create once, distribute to other classrooms" workflow into the
// normal "+ สร้างงาน" create dialog, reusing the EXACT SAME production
// copyAssignmentToClassrooms/getSubjectClassrooms this codebase already
// has for "คัดลอกไปห้องอื่น" — never a second, reimplemented copy path.
// Source-text guards, the same convention every other real tab/dialog in
// this codebase uses (see assignments-tab.test.ts, submission-check-tab.test.ts)
// since vitest.config.ts runs in a `node` environment with no DOM.
// ==================================================

describe('AssignmentDialog — reuses existing production functions, never a new copy implementation', () => {
  const source = readSource()

  it('imports copyAssignmentToClassrooms from the SAME assignment-service.ts used by "คัดลอกไปห้องอื่น" — no new service module', () => {
    expect(source).toContain("from '@/services/assignment-service'")
    expect(source).toContain('copyAssignmentToClassrooms')
  })

  it('lists same-subject classroom targets via getSubjectClassrooms — the exact function getAssignmentCopyTargets itself calls, never a differently-scoped query', () => {
    expect(source).toContain("from '@/services/subject-service'")
    expect(source).toContain('getSubjectClassrooms(subjectId)')
  })

  it('resolves the subject\'s display name via the existing getSubjectById — never a new required prop threaded through every call site', () => {
    expect(source).toContain('getSubjectById(subjectId)')
    expect(source).not.toContain('subjectName:')
  })
})

describe('AssignmentDialog — "ห้องที่ใช้" only appears for the CREATE flow, never while editing', () => {
  const source = readSource()

  it('the picker is gated on !isEditing (via showClassroomPicker) — editing an existing assignment never shows it', () => {
    expect(source).toContain('const showClassroomPicker = !isEditing && Boolean(subjectName)')
  })

  it('REGRESSION — the picker is NEVER hidden just because there are zero other classrooms — visibility never depends on otherClassroomTargets.length', () => {
    const showLine = source.slice(source.indexOf('const showClassroomPicker ='), source.indexOf('\n', source.indexOf('const showClassroomPicker =')))
    expect(showLine).not.toContain('otherClassroomTargets.length')
  })

  it('classroom targets/subject name are only fetched when NOT editing (assignment is absent)', () => {
    const effectBody = source.slice(source.indexOf('useEffect(() => {'), source.indexOf('function toggleExtraClassroom'))
    expect(effectBody).toContain('if (!assignment) {')
    expect(effectBody).toContain('getSubjectById(subjectId)')
    expect(effectBody).toContain('getSubjectClassrooms(subjectId)')
  })
})

describe('AssignmentDialog — the picker: current classroom locked-checked by default, others start unchecked', () => {
  const source = readSource()
  const pickerBlock = source.slice(
    source.indexOf('{showClassroomPicker'),
    source.indexOf('{isCreateFlowFinishStep && useOtherClassrooms && selectedExtraClassroomIds.size'),
  )

  it('the current classroom row is always checked and disabled — it is always where step one creates the assignment, never optional', () => {
    const currentRow = pickerBlock.slice(pickerBlock.indexOf('ห้องปัจจุบัน') - 200, pickerBlock.indexOf('ห้องปัจจุบัน') + 50)
    expect(currentRow).toContain('checked disabled')
    expect(currentRow).toContain('ห้องปัจจุบัน')
  })

  it('REGRESSION — with zero other classrooms, shows an explicit empty state instead of hiding the whole feature', () => {
    expect(pickerBlock).toContain('otherClassroomTargets.length === 0')
    expect(pickerBlock).toContain('ไม่มีห้องอื่นในรายวิชานี้')
  })

  it('the extra-classroom list is gated behind an explicit opt-in toggle ("เพิ่มงานนี้ไปยังห้องอื่นด้วย"), never shown unconditionally', () => {
    expect(pickerBlock).toContain('เพิ่มงานนี้ไปยังห้องอื่นด้วย')
    expect(pickerBlock).toContain('checked={useOtherClassrooms}')
    expect(pickerBlock).toContain('onChange={(e) => setUseOtherClassrooms(e.target.checked)}')
    expect(pickerBlock).toContain('{useOtherClassrooms && (')
  })

  it('starts with the toggle OFF and NO extra classroom selected every time the dialog (re)opens for a create', () => {
    expect(source).toContain('useState(false)')
    expect(source).toContain('useState<Set<string>>(new Set())')
    const effectBody = source.slice(source.indexOf('useEffect(() => {'), source.indexOf('function toggleExtraClassroom'))
    expect(effectBody).toContain('setUseOtherClassrooms(false)')
    expect(effectBody).toContain('setSelectedExtraClassroomIds(new Set())')
  })

  it('offers a "เลือกทั้งหมด" quick action selecting every OTHER same-subject classroom at once', () => {
    expect(pickerBlock).toContain('เลือกทั้งหมด')
    expect(pickerBlock).toContain('onClick={selectAllExtraClassrooms}')
    expect(source).toContain('setSelectedExtraClassroomIds(new Set(otherClassroomTargets.map((c) => c.classroomId)))')
  })

  it('every other classroom is individually togglable via a real checkbox bound to selectedExtraClassroomIds', () => {
    expect(pickerBlock).toContain('checked={selectedExtraClassroomIds.has(c.classroomId)}')
    expect(pickerBlock).toContain('onChange={() => toggleExtraClassroom(c.classroomId)}')
  })
})

describe('AssignmentDialog — copying to extra classrooms happens on the explicit "เสร็จสิ้น" finish step, after resources can be attached', () => {
  const source = readSource()
  const fn = source.slice(
    source.indexOf('async function copyToExtraClassroomsThenClose'),
    source.indexOf('async function handleSubmit'),
  )

  it('is called from the create-flow finish branch of handleSubmit, not from the initial create step', () => {
    const submitFn = source.slice(source.indexOf('async function handleSubmit'), source.indexOf('return (\n    <Dialog'))
    const finishBranch = submitFn.slice(submitFn.indexOf('if (isCreateFlowFinishStep) {'), submitFn.indexOf('const maxScore'))
    expect(finishBranch).toContain('await copyToExtraClassroomsThenClose()')
  })

  it('does nothing when no extra classroom was selected — the picker never forces a copy', () => {
    expect(fn).toContain('selectedExtraClassroomIds.size > 0')
  })

  it('does nothing unless the teacher explicitly opted in via useOtherClassrooms — a lingering selection from a toggled-off state is never copied', () => {
    expect(fn).toContain('useOtherClassrooms && selectedExtraClassroomIds.size > 0')
  })

  it('passes the full just-created assignment record as the copy source — never source.id alone, never a raw fetch', () => {
    expect(fn).toContain('copyAssignmentToClassrooms(createdAssignment, targets)')
  })

  it('builds targets scoped to THIS subject only (same subjectId on every target) — never a cross-subject target', () => {
    const targetsBlock = fn.slice(fn.indexOf('const targets:'), fn.indexOf('setSubmitting(true)'))
    expect(targetsBlock).toContain('subjectId,')
    expect(targetsBlock).not.toMatch(/subjectId:\s*c\.subjectId/)
  })

  it('reports partial failures honestly via toast, distinct from the all-success message', () => {
    expect(fn).toContain('const failed = outcomes.filter((o) => !o.ok).length')
    expect(fn).toMatch(/if \(failed === 0\) toast\(/)
  })

  it('never references assignment_submissions, score, or status anywhere in this function — copying targets classrooms only, never touches student data', () => {
    expect(fn).not.toMatch(/assignment_submissions|\bscore\b|submittedAt|reviewedAt/)
  })
})

describe('AssignmentDialog — createdAssignment is set from the REAL createAssignment result, not the form draft', () => {
  const source = readSource()
  const submitFn = source.slice(source.indexOf('async function handleSubmit'), source.indexOf('return (\n    <Dialog'))
  const createBranch = submitFn.slice(submitFn.indexOf('const created = await createAssignment({'))

  it('setCreatedAssignment receives the actual createAssignment() return value', () => {
    expect(createBranch).toContain('setCreatedAssignment(created)')
  })

  it('createdAssignment resets to null every time the dialog reopens/switches assignment', () => {
    const effectBody = source.slice(source.indexOf('useEffect(() => {'), source.indexOf('function toggleExtraClassroom'))
    expect(effectBody).toContain('setCreatedAssignment(null)')
  })
})
