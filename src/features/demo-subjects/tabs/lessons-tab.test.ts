import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./lessons-tab.tsx', import.meta.url), 'utf-8')
}

// ==================================================
// demo-subjects/LessonsTab — the ACTUAL runtime component rendered by
// "+ เพิ่มบทเรียน" whenever Supabase env vars are absent (dataMode ===
// 'demo', see src/lib/data-mode.ts). This tab owns its own inline create
// dialog (no separate lesson-dialog.tsx file in demo mode). Verifies the
// "เผยแพร่ไปยังห้อง" cross-classroom picker is actually present here too —
// a previous pass only added it to subjects-real/lesson-dialog.tsx,
// which is never rendered in demo mode. Source-text guards, the same
// convention every other component in this codebase uses since
// vitest.config.ts runs in a `node` environment with no DOM/jsdom.
// ==================================================

describe('demo LessonsTab — reuses the EXACT SAME addLesson demo-state function, never a new copy path', () => {
  const source = readSource()

  it('imports addLesson (and classrooms) from the same useDemoClassroom() hook every other demo write already uses', () => {
    expect(source).toContain("from '@/demo/demo-context'")
    expect(source).toContain('addLesson')
    expect(source).toContain('classrooms')
  })

  it('derives classroom targets from the SAME demo state addLesson reads — subject.classroomIds + classrooms — never fabricated/mock data', () => {
    const fn = source.slice(source.indexOf('export function LessonsTab'), source.indexOf('const visibleLessons ='))
    expect(fn).toContain('const otherClassrooms = subject.classroomIds')
    expect(fn).toContain('.filter((id) => id !== classroomId)')
  })
})

describe('demo LessonsTab — "เผยแพร่ไปยังห้อง" is ALWAYS visible in the create dialog, current classroom always shown, eligible classrooms listed', () => {
  const source = readSource()
  const createDialogBlock = source.slice(source.indexOf('<Dialog open={createOpen}'), source.indexOf('<Dialog open={Boolean(editingLesson)}'))

  it('the section is rendered unconditionally inside the create dialog — never gated on otherClassrooms.length', () => {
    expect(createDialogBlock).toContain('เผยแพร่ไปยังห้อง')
    const sectionOpenIndex = createDialogBlock.indexOf('<div className="space-y-1.5 rounded-lg border border-border p-3">')
    const gateBefore = createDialogBlock.slice(Math.max(0, sectionOpenIndex - 80), sectionOpenIndex)
    expect(gateBefore).not.toContain('otherClassrooms.length > 0 &&')
    expect(gateBefore).not.toContain('otherClassrooms.length === 0 &&')
  })

  it('shows the current classroom, locked checked, using the real classroom name (not a placeholder)', () => {
    expect(createDialogBlock).toContain('checked disabled')
    expect(createDialogBlock).toContain('ห้องปัจจุบัน {currentClassroomName}')
  })

  it('REGRESSION — with zero eligible classrooms, shows the explicit "ไม่มีห้องอื่นในรายวิชานี้" empty state, distinguishing "no targets" from "feature missing"', () => {
    expect(createDialogBlock).toContain('otherClassrooms.length === 0')
    expect(createDialogBlock).toContain('ไม่มีห้องอื่นในรายวิชานี้')
  })

  it('every eligible classroom is rendered as its own checkbox once the "ใช้บทเรียนนี้กับห้องอื่นด้วย" toggle is on', () => {
    expect(createDialogBlock).toContain('{otherClassrooms.map((c) => (')
    expect(createDialogBlock).toContain('checked={selectedExtraClassroomIds.has(c.id)}')
    expect(createDialogBlock).toContain('onChange={() => toggleExtraClassroom(c.id)}')
    expect(createDialogBlock).toContain('{c.name}')
  })

  it('the list only appears once the teacher opts in via the toggle — never shown unconditionally alongside the toggle', () => {
    expect(createDialogBlock).toContain('ใช้บทเรียนนี้กับห้องอื่นด้วย')
    expect(createDialogBlock).toContain('checked={useOtherClassrooms}')
    expect(createDialogBlock).toContain('{useOtherClassrooms && (')
  })

  it('offers "เลือกทั้งหมด" to select every eligible classroom at once', () => {
    expect(createDialogBlock).toContain('เลือกทั้งหมด')
    expect(createDialogBlock).toContain('onClick={selectAllExtraClassrooms}')
  })
})

describe('demo LessonsTab — the toggle/selection always resets to OFF/empty whenever the create dialog is opened', () => {
  const source = readSource()
  const fn = source.slice(source.indexOf('function openCreate()'), source.indexOf('function openEdit'))

  it('resets useOtherClassrooms to false and selectedExtraClassroomIds to an empty Set on every openCreate()', () => {
    expect(fn).toContain('setUseOtherClassrooms(false)')
    expect(fn).toContain('setSelectedExtraClassroomIds(new Set())')
  })

  it('both the top "+ เพิ่มบทเรียน" button and the empty-state button call the SAME openCreate — never a second, unreset code path', () => {
    const buttonBlock = source.slice(source.indexOf('<Button onClick={openCreate}>'), source.indexOf('{visibleLessons.length === 0'))
    expect(buttonBlock).toContain('onClick={openCreate}')
    const emptyStateBlock = source.slice(source.indexOf('ยังไม่มีบทเรียนในห้องเรียนนี้'), source.indexOf('ยังไม่มีบทเรียนในห้องเรียนนี้') + 200)
    expect(emptyStateBlock).toContain('onClick={openCreate}')
  })
})

describe('demo LessonsTab — create behavior: always creates in the current classroom first, extra classrooms are purely additive', () => {
  const source = readSource()
  const fn = source.slice(source.indexOf('function handleCreateSubmit'), source.indexOf('function handleEditSubmit'))

  it('REGRESSION (normal single-classroom creation still works) — addLesson(subject.id, classroomId, input) always runs, unconditionally, before any extra-classroom loop', () => {
    const mainCallIndex = fn.indexOf('addLesson(subject.id, classroomId, input)')
    const loopIndex = fn.indexOf('for (const target of otherClassrooms.filter')
    expect(mainCallIndex).toBeGreaterThan(-1)
    expect(loopIndex).toBeGreaterThan(mainCallIndex)
  })

  it('extra targets are computed ONLY when useOtherClassrooms is on, filtered by selectedExtraClassroomIds', () => {
    expect(fn).toContain('if (useOtherClassrooms) {')
    expect(fn).toContain('otherClassrooms.filter((c) => selectedExtraClassroomIds.has(c.id))')
  })

  it('selecting classrooms passes each selected target\'s own id to addLesson — never a hardcoded or unrelated id', () => {
    const loopBody = fn.slice(fn.indexOf('for (const target of otherClassrooms.filter'))
    expect(loopBody).toContain('addLesson(subject.id, target.id, input)')
  })

  it('the SAME input object (title/description) is reused for every classroom — current and extra alike', () => {
    expect(fn).toContain('const input = { title: form.title.trim(), description: form.description.trim() }')
    expect(fn).toContain('addLesson(subject.id, classroomId, input)')
    const loopBody = fn.slice(fn.indexOf('for (const target of otherClassrooms.filter'))
    expect(loopBody).toContain('addLesson(subject.id, target.id, input)')
  })

  it('never references publish state when creating — every copy relies on addLesson\'s own always-unpublished default, never forced here', () => {
    expect(fn).not.toMatch(/isPublished|is_published/)
  })
})
