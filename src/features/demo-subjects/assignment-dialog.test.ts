import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./assignment-dialog.tsx', import.meta.url), 'utf-8')
}

// ==================================================
// demo-subjects/AssignmentDialog — the ACTUAL runtime component rendered
// by "+ เพิ่มงาน" whenever Supabase env vars are absent (dataMode ===
// 'demo', see src/lib/data-mode.ts) — i.e. every preview/local run
// without VITE_SUPABASE_URL/VITE_SUPABASE_PUBLISHABLE_KEY configured,
// reached from subject-classroom-workspace-page-demo.tsx's งาน tab. A
// previous pass added the "ห้องที่ใช้" cross-classroom picker to
// subjects-real/assignment-dialog.tsx only — that component is NEVER
// rendered in demo mode, which is why the picker was invisible in the
// tested preview even though it existed in the repo. This file tests
// the component that is actually on screen. Source-text guards, the
// same convention every other component in this codebase uses since
// vitest.config.ts runs in a `node` environment with no DOM/jsdom.
// ==================================================

describe('demo AssignmentDialog — reuses the EXACT SAME addSubjectAssignment demo-state function, never a new copy path', () => {
  const source = readSource()

  it('imports addSubjectAssignment (and subjects/classrooms) from the same useDemoClassroom() hook every other demo write already uses', () => {
    expect(source).toContain("from '@/demo/demo-context'")
    expect(source).toContain('addSubjectAssignment')
    expect(source).toContain('subjects, classrooms')
  })

  it('derives classroom targets from the SAME demo state addSubjectAssignment reads — subject.classroomIds + classrooms — never fabricated/mock data', () => {
    const fn = source.slice(source.indexOf('export function AssignmentDialog'), source.indexOf('useEffect(() => {'))
    expect(fn).toContain('const subject = subjects.find((s) => s.id === subjectId)')
    expect(fn).toContain('const otherClassrooms = (subject?.classroomIds ?? [])')
    expect(fn).toContain('.filter((id) => id !== classroomId)')
  })
})

describe('demo AssignmentDialog — "ห้องที่ใช้" is ALWAYS visible for the create flow, current classroom always shown, eligible classrooms listed', () => {
  const source = readSource()
  const pickerBlock = source.slice(source.indexOf('{!isEditing && ('), source.indexOf('<DialogFooter>'))

  it('the section is gated on !isEditing only — never on otherClassrooms.length, so it is never fully hidden', () => {
    const gateLine = source.slice(source.indexOf('{!isEditing && ('), source.indexOf('\n', source.indexOf('{!isEditing && (')))
    expect(gateLine).not.toContain('otherClassrooms.length')
  })

  it('shows "ห้องที่ใช้" and the current classroom, locked checked, using the real classroom name (not a placeholder)', () => {
    expect(pickerBlock).toContain('ห้องที่ใช้')
    expect(pickerBlock).toContain('checked disabled')
    expect(pickerBlock).toContain('ห้องปัจจุบัน {currentClassroomName}')
  })

  it('REGRESSION — with zero eligible classrooms, shows the explicit "ไม่มีห้องอื่นในรายวิชานี้" empty state, distinguishing "no targets" from "feature missing"', () => {
    expect(pickerBlock).toContain('otherClassrooms.length === 0')
    expect(pickerBlock).toContain('ไม่มีห้องอื่นในรายวิชานี้')
  })

  it('every eligible classroom is rendered as its own checkbox once the "เพิ่มงานนี้ไปยังห้องอื่นด้วย" toggle is on', () => {
    expect(pickerBlock).toContain('{otherClassrooms.map((c) => (')
    expect(pickerBlock).toContain('checked={selectedExtraClassroomIds.has(c.id)}')
    expect(pickerBlock).toContain('onChange={() => toggleExtraClassroom(c.id)}')
    expect(pickerBlock).toContain('{c.name}')
  })

  it('the list only appears once the teacher opts in via the toggle — never shown unconditionally alongside the toggle', () => {
    expect(pickerBlock).toContain('checked={useOtherClassrooms}')
    expect(pickerBlock).toContain('{useOtherClassrooms && (')
  })

  it('offers "เลือกทั้งหมด" to select every eligible classroom at once', () => {
    expect(pickerBlock).toContain('เลือกทั้งหมด')
    expect(pickerBlock).toContain('onClick={selectAllExtraClassrooms}')
  })
})

describe('demo AssignmentDialog — the toggle/selection always resets to OFF/empty whenever the dialog (re)opens', () => {
  const source = readSource()
  const effectBody = source.slice(source.indexOf('useEffect(() => {'), source.indexOf('function toggleExtraClassroom'))

  it('resets useOtherClassrooms to false and selectedExtraClassroomIds to an empty Set on every open', () => {
    expect(effectBody).toContain('setUseOtherClassrooms(false)')
    expect(effectBody).toContain('setSelectedExtraClassroomIds(new Set())')
  })
})

describe('demo AssignmentDialog — create behavior: always creates in the current classroom first, extra classrooms are purely additive', () => {
  const source = readSource()
  const createBranch = source.slice(source.indexOf('} else {'), source.indexOf('onOpenChange(false)'))

  it('REGRESSION (normal single-classroom creation still works) — addSubjectAssignment(subjectId, classroomId, input) always runs, unconditionally, before any extra-classroom loop', () => {
    const mainCallIndex = createBranch.indexOf('addSubjectAssignment(subjectId, classroomId, input)')
    const loopIndex = createBranch.indexOf('for (const target of extraTargets)')
    expect(mainCallIndex).toBeGreaterThan(-1)
    expect(loopIndex).toBeGreaterThan(mainCallIndex)
  })

  it('extra targets are computed ONLY from otherClassrooms filtered by selectedExtraClassroomIds, and ONLY when useOtherClassrooms is on', () => {
    expect(createBranch).toContain(
      'const extraTargets = useOtherClassrooms ? otherClassrooms.filter((c) => selectedExtraClassroomIds.has(c.id)) : []',
    )
  })

  it('selecting 2 classrooms passes exactly those 2 target ids to addSubjectAssignment, via target.id — never a hardcoded or unrelated id', () => {
    const loopBody = createBranch.slice(createBranch.indexOf('for (const target of extraTargets)'))
    expect(loopBody).toContain('addSubjectAssignment(subjectId, target.id, input)')
  })

  it('the SAME input object (title/type/maxScore/dueDate/description) is reused for every classroom — current and extra alike, never re-derived per target', () => {
    const mainCallLine = createBranch.slice(0, createBranch.indexOf('addSubjectAssignment(subjectId, classroomId, input)') + 60)
    expect(mainCallLine).toContain('addSubjectAssignment(subjectId, classroomId, input)')
    const loopBody = createBranch.slice(createBranch.indexOf('for (const target of extraTargets)'))
    expect(loopBody).toContain('addSubjectAssignment(subjectId, target.id, input)')
  })

  it('never references submissions/scores/status when building the copy targets or input — addSubjectAssignment itself seeds fresh submissions per classroom', () => {
    expect(createBranch).not.toMatch(/submissions\s*:|\.score\b|\.status\b/)
  })
})
