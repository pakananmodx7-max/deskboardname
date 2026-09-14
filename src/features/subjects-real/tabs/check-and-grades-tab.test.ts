import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { SUB_TABS } from './check-and-grades-tab'

function readSource(): string {
  return readFileSync(new URL('./check-and-grades-tab.tsx', import.meta.url), 'utf-8')
}

// ==================================================
// CheckAndGradesTab (ตรวจงานและคะแนน) — merges the formerly separate
// ตรวจสอบงาน and คะแนน top-level tabs into one, with the same two
// screens as inner sub-tabs. SUB_TABS itself is a real, executed import
// (plain data, no Supabase/DOM dependency); the wiring around it is
// covered with source-text guards, the same convention every other
// real tab in this codebase uses (see grades-tab.test.ts,
// submission-check-tab.test.ts) since vitest.config.ts runs in a `node`
// environment with no DOM.
// ==================================================

describe('SUB_TABS — real, executed: exactly ตรวจสอบงาน then คะแนน', () => {
  it('has exactly 2 entries, ตรวจสอบงาน first then คะแนน', () => {
    expect(SUB_TABS).toHaveLength(2)
    expect(SUB_TABS.map((t) => t.key)).toEqual(['submissionCheck', 'grades'])
    expect(SUB_TABS.map((t) => t.label)).toEqual(['ตรวจสอบงาน', 'คะแนน'])
  })
})

describe('CheckAndGradesTab — reuses SubmissionCheckTab and GradesTab completely unchanged', () => {
  const source = readSource()

  it('imports both existing tab components verbatim, from their existing file paths — no copy, no rewrite', () => {
    expect(source).toContain("import { GradesTab } from './grades-tab'")
    expect(source).toContain("import { SubmissionCheckTab } from './submission-check-tab'")
  })

  it('renders SubmissionCheckTab with the exact same props it took as a standalone top-level tab (subject, classroomId — no classroomName, matching its own props interface)', () => {
    expect(source).toContain('<SubmissionCheckTab subject={subject} classroomId={classroomId} />')
  })

  it('renders GradesTab with the exact same props it took as a standalone top-level tab (subject, classroomId, classroomName)', () => {
    expect(source).toContain('<GradesTab subject={subject} classroomId={classroomId} classroomName={classroomName} />')
  })

  it('this component does no data fetching itself — no supabase import, no getAssignments/getSubmissions/getStudentsByClassroom call of its own; each child tab still fetches its own data independently', () => {
    expect(source).not.toMatch(/from '@\/lib\/supabase'/)
    expect(source).not.toMatch(/getAssignments\(|getSubmissions\(|getStudentsByClassroom\(/)
  })

  it('never writes to assignment_submissions itself — no setSubmissionScore/setSubmissionStatus call here; grading stays exclusively inside the reused GradesTab/SubmissionCheckTab', () => {
    expect(source).not.toMatch(/setSubmissionScore\(|setSubmissionStatus\(/)
  })
})

describe('CheckAndGradesTab — default sub-tab is ตรวจสอบงาน, both rendered as compact, visually distinct pill buttons', () => {
  const source = readSource()

  it("defaults to 'submissionCheck' when no ?subtab= is present or it's invalid", () => {
    expect(source).toContain("isSubTabKey(initialSubTabParam) ? initialSubTabParam : 'submissionCheck'")
  })

  it('renders both sub-tabs from the shared SUB_TABS list — no separately hand-typed button markup', () => {
    expect(source).toContain('SUB_TABS.map((tab) =>')
  })

  it('the active sub-tab gets a distinct filled/shadow style, inactive ones stay muted — a compact pill group, not a full underline tab bar (visually distinct from the outer workspace tabs)', () => {
    const fn = source.slice(source.indexOf('return ('))
    expect(fn).toContain('subTab === tab.key')
    expect(fn).toContain('bg-card text-foreground shadow-sm')
    expect(fn).toContain('rounded-lg border border-border bg-muted/40 p-1')
  })

  it('clicking a sub-tab updates local state via handleSubTabClick, not a raw inline setSubTab', () => {
    expect(source).toContain('onClick={() => handleSubTabClick(tab.key)}')
  })
})

describe('CheckAndGradesTab — inner ?subtab= persists across refresh/direct navigation, mirroring the outer ?tab= convention', () => {
  const source = readSource()

  it('reads the initial sub-tab from useSearchParams on mount', () => {
    expect(source).toContain("const initialSubTabParam = searchParams.get('subtab')")
  })

  it('handleSubTabClick writes ?subtab= via setSearchParams, preserving whatever other params (like ?tab=) were already present', () => {
    const fn = source.slice(source.indexOf('function handleSubTabClick'), source.indexOf('return ('))
    expect(fn).toContain('setSubTab(key)')
    expect(fn).toContain('new URLSearchParams(prev)')
    expect(fn).toContain("next.set('subtab', key)")
  })

  it('uses { replace: true } so switching sub-tabs never spams browser history, matching the outer workspace page\'s own convention', () => {
    const fn = source.slice(source.indexOf('function handleSubTabClick'), source.indexOf('return ('))
    expect(fn).toContain('{ replace: true }')
  })
})
