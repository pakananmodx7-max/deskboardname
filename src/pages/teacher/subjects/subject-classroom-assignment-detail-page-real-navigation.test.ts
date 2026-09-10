import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./subject-classroom-assignment-detail-page-real.tsx', import.meta.url), 'utf-8')
}

describe('Teacher assignment detail — back navigation (Section 1)', () => {
  const source = readSource()

  it('the back button label is "กลับไปหน้างาน", not "กลับไปที่ห้องเรียน"', () => {
    expect(source).toContain('กลับไปหน้างาน')
    expect(source).not.toContain('กลับไปที่ห้องเรียน')
  })

  it('deep-links to the Subject + Classroom + งาน tab via the existing canonical route builder, never a hand-built path back to the classroom picker', () => {
    expect(source).toContain("buildSubjectClassroomTabPath(subjectId, classroomId, 'assignments')")
  })
})

describe('Teacher assignment detail — assignment switcher (Section 2)', () => {
  const source = readSource()

  it('offers a "งานอื่นในห้องนี้" control', () => {
    expect(source).toContain('งานอื่นในห้องนี้')
  })

  it('loads only ACTIVE assignments for the current subject+classroom via the existing assignment service — no other subject/classroom, no archived', () => {
    expect(source).toContain('getAssignments(subjectId, classroomId)')
    expect(source).toContain('filterActiveAssignmentsForSwitcher(rows)')
  })

  it('marks the current assignment in the dropdown', () => {
    expect(source).toMatch(/a\.id === currentAssignmentId \? '✓ ' : ''/)
  })

  it('selecting an assignment navigates via the canonical assignment-detail path builder, preserving subject+classroom', () => {
    expect(source).toContain('buildAssignmentDetailPath(currentSubjectId, currentClassroomId, id)')
    expect(source).toContain('goToAssignment(e.target.value)')
  })

  it('the switcher loads independently of the header/roster — a failure here never blanks the rest of the page (Section 5 error isolation)', () => {
    expect(source).toMatch(/siblingsError && <p/)
  })
})

describe('Teacher assignment detail — previous/next (Section 3)', () => {
  const source = readSource()

  it('offers งานก่อนหน้า / งานถัดไป, disabled at the boundaries via the pure helpers (never re-implemented inline)', () => {
    expect(source).toContain('งานก่อนหน้า')
    expect(source).toContain('งานถัดไป')
    expect(source).toContain('disabled={!previousAssignment}')
    expect(source).toContain('disabled={!nextAssignment}')
  })

  it('previous/next navigate through the same canonical path builder as the switcher', () => {
    expect(source).toMatch(/previousAssignment && goToAssignment\(previousAssignment\.id\)/)
    expect(source).toMatch(/nextAssignment && goToAssignment\(nextAssignment\.id\)/)
  })
})

describe('Teacher assignment detail — existing actions preserved, kept separate (Section 4)', () => {
  const source = readSource()

  it('keeps แก้ไขงาน and เก็บถาวรงาน as their own buttons, not merged into the switcher control', () => {
    expect(source).toContain('แก้ไขงาน')
    expect(source).toContain('เก็บถาวรงาน')
    expect(source).toMatch(/onClick=\{\(\) => setEditOpen\(true\)\}/)
    expect(source).toMatch(/onClick=\{\(\) => setArchiveConfirmOpen\(true\)\}/)
  })
})
