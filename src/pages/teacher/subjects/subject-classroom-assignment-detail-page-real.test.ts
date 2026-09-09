import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSourceRelativeToThisFile(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf-8')
}

/**
 * Source-text regression guards for the Assignment Detail Workspace.
 * There's no jsdom in this project (vitest.config.ts uses environment:
 * 'node' — see every other *.test.ts in this codebase), so behavior that
 * can only be observed by rendering (error isolation between sections, no
 * demo fallback, archive never hard-deleting) is asserted here at the
 * source level instead — the same pattern used for dashboard-service.test.ts
 * and assignment-resources-disclosure.test.ts earlier this project.
 */
describe('SubjectClassroomAssignmentDetailPageReal — structural guards', () => {
  const source = readSourceRelativeToThisFile('./subject-classroom-assignment-detail-page-real.tsx')

  it('never imports demo data/context — real mode has no demo fallback', () => {
    expect(source).not.toMatch(/from ['"]@\/demo\//)
    expect(source).not.toContain('useDemoClassroom')
  })

  it('loads the header and the roster through two INDEPENDENT fetches, each with its own error state', () => {
    // Two separate useCallback-wrapped loaders...
    expect(source).toMatch(/const loadHeader = useCallback/)
    expect(source).toMatch(/const loadRoster = useCallback/)
    // ...each setting its own error state, never a single shared one.
    expect(source).toContain('setHeaderError')
    expect(source).toContain('setRosterError')
    expect(source).not.toMatch(/const \[error, setError\]/)
  })

  it('renders the resources section as its own independent component, not inline-fetched here', () => {
    expect(source).toContain('AssignmentResourcesSection')
    expect(source).toContain("from '@/features/subjects-real/assignment-resources-section'")
  })

  it('archiving never hard-deletes — no direct delete call against assignments in this file', () => {
    expect(source).toContain('archiveAssignment')
    expect(source).not.toMatch(/from\(['"]assignments['"]\)\s*\.delete\(/)
  })

  it('summary counts (getSubmissionSummary/computeGradedTally) are computed from the roster, never from the filtered/searched visibleRoster', () => {
    expect(source).toMatch(/getSubmissionSummary\(rosterSubmissions\)/)
    expect(source).toMatch(/computeGradedTally\(\s*roster\.map/)
  })

  it('the "แก้ไขงาน" edit dialog never duplicates the resources UI already on this page', () => {
    expect(source).toContain('hideResourcesSection')
  })

  it('bounces to the workspace when the loaded assignment does not actually belong to this exact subject+classroom — the wrong-classroom/cross-teacher URL guard (RLS itself already returns null for a genuinely cross-teacher id)', () => {
    expect(source).toMatch(/assignment\.subjectId !== subjectId \|\| assignment\.classroomId !== classroomId/)
    expect(source).toContain('getAssignmentById')
  })

  it('filters and search only ever narrow the TABLE (visibleRoster), never the roster used for summary counts', () => {
    expect(source).toMatch(/const visibleRoster = searchRoster\(filterRosterByStatus\(roster, submissions, statusFilter\), search\)/)
  })
})

describe('Deep links into the assignment detail page reuse the one canonical path builder', () => {
  it('the Assignments tab card click uses buildAssignmentDetailPath, never a hand-built path', () => {
    const source = readSourceRelativeToThisFile('../../../features/subjects-real/tabs/assignments-tab.tsx')
    expect(source).toContain('buildAssignmentDetailPath')
    expect(source).not.toMatch(/`\/teacher\/subjects\/\$\{subject\.id\}\/classrooms/)
  })

  it('the missing-assignment report links each row to the exact assignment', () => {
    const source = readSourceRelativeToThisFile('../../../features/reports-real/missing-assignment-report.tsx')
    expect(source).toContain('buildAssignmentDetailPath')
  })

  it('the grade summary report links each assignment column to the exact assignment', () => {
    const source = readSourceRelativeToThisFile('../../../features/reports-real/grade-summary-report.tsx')
    expect(source).toContain('buildAssignmentDetailPath')
  })

  it('the dashboard assignment action center and upcoming list both use the same builder (no separate implementation)', () => {
    const actionCard = readSourceRelativeToThisFile('../../../features/dashboard-real/assignment-action-card.tsx')
    const upcomingCard = readSourceRelativeToThisFile('../../../features/dashboard-real/upcoming-assignments-card.tsx')
    expect(actionCard).toContain('buildAssignmentDetailPath')
    expect(upcomingCard).toContain('buildAssignmentDetailPath')
  })
})
