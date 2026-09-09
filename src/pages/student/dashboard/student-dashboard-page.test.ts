import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSourceRelativeToThisFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf-8')
}

/**
 * PRODUCTION BUG regression (part 2) — /student/dashboard and
 * /student/subjects still failed entirely after the avatar_path fix.
 * There's no jsdom in this project (vitest.config.ts uses
 * environment: 'node'), so the architectural requirement — "must not use
 * one Promise.all that causes the entire page to disappear when one data
 * source fails" — is asserted here at the source-text level, the same
 * pattern used throughout this project for behavior that can only be
 * observed by rendering.
 */
describe('StudentDashboardPage — independent per-source loading, never one shared blanking error', () => {
  const source = readSourceRelativeToThisFile('./student-dashboard-page.tsx')

  it('never bundles subjects/assignments/attendance into a single Promise.all', () => {
    expect(source).not.toMatch(/Promise\.all\(\[getMySubjects\(\), getMyAssignments\(\), getMyAttendance\(\)\]\)/)
  })

  it('gives subjects, assignments, and attendance each their own independent loading + error state', () => {
    expect(source).toContain('subjectsLoading')
    expect(source).toContain('subjectsError')
    expect(source).toContain('assignmentsLoading')
    expect(source).toContain('assignmentsError')
    expect(source).toContain('attendanceLoading')
    expect(source).toContain('attendanceError')
  })

  it('never has a single top-level early return that blanks the whole page on one error (the old "if (coreError) return <p>{coreError}</p>" pattern)', () => {
    expect(source).not.toMatch(/if \(coreError\)/)
    expect(source).not.toContain('coreError')
  })

  it('each of subjects/assignments/attendance has its own separate useEffect (three independent fetches, not one combined effect)', () => {
    const matches = source.match(/useEffect\(\(\) => \{/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(4) // subjects, assignments, attendance, calendar
  })

  it('never fabricates a pending-work count for a subject when assignments failed to load', () => {
    expect(source).toMatch(/assignmentsError\s*\?\s*null\s*:/)
  })

  it('never imports demo data/context — real mode has no demo fallback', () => {
    expect(source).not.toMatch(/from ['"]@\/demo\//)
  })
})
