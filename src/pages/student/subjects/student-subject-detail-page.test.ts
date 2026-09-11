import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { STUDENT_SUBJECT_TABS } from '@/pages/student/subjects/student-subject-detail-page'

function readSourceRelativeToThisFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf-8')
}

describe('/student/subjects/:subjectId tabs', () => {
  it('is exactly ภาพรวม/บทเรียน/งาน/คะแนน/การเข้าเรียน, in that order — no student roster/classmates tab', () => {
    expect(STUDENT_SUBJECT_TABS.map((tab) => tab.key)).toEqual(['overview', 'lessons', 'assignments', 'grades', 'attendance'])
    expect(STUDENT_SUBJECT_TABS.map((tab) => tab.label)).toEqual(['ภาพรวม', 'บทเรียน', 'งาน', 'คะแนน', 'การเข้าเรียน'])
  })

  it('has no "students"/roster tab of any kind', () => {
    expect(STUDENT_SUBJECT_TABS.some((tab) => (tab.key as string) === 'students')).toBe(false)
  })
})

/**
 * PAGE ERROR ISOLATION (Part 10) regression guards — no jsdom in this
 * project, so asserted at the source-text level, same pattern used
 * throughout this project for behavior only observable by rendering.
 */
describe('StudentSubjectDetailPage — independent per-section loading, source-level guards', () => {
  const source = readSourceRelativeToThisFile('./student-subject-detail-page.tsx')

  it('gives subject identity, lessons, assignments, and attendance each their own independent loading + error state', () => {
    expect(source).toContain('subjectLoading')
    expect(source).toContain('subjectError')
    expect(source).toContain('lessonsLoading')
    expect(source).toContain('lessonsError')
    expect(source).toContain('assignmentsLoading')
    expect(source).toContain('assignmentsError')
    expect(source).toContain('attendanceLoading')
    expect(source).toContain('attendanceError')
  })

  it('lessons are read via getLessons() — RLS-scoped to published, own-classroom rows only, no client-side re-filtering needed', () => {
    expect(source).toContain('getLessons(subjectId, classroomId)')
  })

  it('never bundles assignments and attendance into one shared Promise.all with one shared error', () => {
    expect(source).not.toMatch(/Promise\.all\(\[\s*getMyAssignments/)
    expect(source).not.toContain('const [error, setError]')
  })

  it('a resource-count lookup failure always falls back to an empty map, never bubbling into assignmentsError', () => {
    expect(source).toContain('getResourceCounts(rows.map((a) => a.id)).catch(() => ({}))')
  })

  it('never renders a fabricated attendance percentage instead of the real attendanceError', () => {
    expect(source).toMatch(/attendanceError\s*\?\s*'ผิดพลาด'/)
  })

  it('never fetches or displays a teacher name — no RLS grant exists for that without 0012', () => {
    expect(source).not.toMatch(/from\(['"]profiles['"]\)/)
    expect(source).not.toContain('teacherName')
  })

  it('never imports demo data/context — real mode has no demo fallback', () => {
    expect(source).not.toMatch(/from ['"]@\/demo\//)
  })
})

describe('AssignmentResourcesDisclosure button labels match the exact spec text', () => {
  const source = readSourceRelativeToThisFile('../../../features/student-portal/assignment-resources-disclosure.tsx')

  it('uses "เปิดใบงาน" for a file resource', () => {
    expect(source).toContain('เปิดใบงาน')
  })

  it('uses "เปิดงานออนไลน์" for a link resource', () => {
    expect(source).toContain('เปิดงานออนไลน์')
  })
})

describe('No standalone flat assignment list survives — Part 4/5 sidebar simplification', () => {
  it('student-nav-items.ts has no /student/assignments entry', () => {
    const source = readSourceRelativeToThisFile('../../../components/layout/student-nav-items.ts')
    expect(source).not.toMatch(/to: '\/student\/assignments'/)
  })

  it('the old flat assignments page file no longer exists', () => {
    expect(() => readSourceRelativeToThisFile('../assignments/student-assignments-page.tsx')).toThrow()
  })

  it('router.tsx redirects /student/assignments into /student/subjects, never renders a removed page', () => {
    const source = readSourceRelativeToThisFile('../../../app/router.tsx')
    expect(source).toMatch(/path: 'assignments', element: <Navigate to="\/student\/subjects" replace \/> /)
  })
})

describe('งาน tab — the whole assignment row/card is clickable, not just the title text (audit requirement 2)', () => {
  const source = readSourceRelativeToThisFile('./student-subject-detail-page.tsx')

  it('wraps the entire title/due-date/score/badge block in one Link, not just the title', () => {
    const tabBlock = source.slice(source.indexOf("activeTab === 'assignments'"), source.indexOf("activeTab === 'grades'"))
    expect(tabBlock).toMatch(/<Link\s+to=\{buildStudentAssignmentDetailPath\(a\.subjectId, a\.id\)\}[\s\S]*?<\/Link>/)
  })

  it('the resource disclosure toggle stays OUTSIDE the Link — clicking it must never trigger navigation', () => {
    const tabBlock = source.slice(source.indexOf("activeTab === 'assignments'"), source.indexOf("activeTab === 'grades'"))
    const linkEnd = tabBlock.indexOf('</Link>')
    const afterLink = tabBlock.slice(linkEnd)
    expect(afterLink).toContain('<AssignmentResourcesDisclosure')
  })

  it('the status badge is derived via the shared deriveStudentFacingStatus, never a locally re-implemented ternary', () => {
    expect(source).toContain('deriveStudentFacingStatus(a)')
    expect(source).toContain('STUDENT_SUBMISSION_STATUS_LABEL[status]')
    expect(source).not.toContain("a.status === 'submitted' ? 'success'")
  })
})
