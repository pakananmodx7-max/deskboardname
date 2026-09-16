import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./subject-classroom-workspace-page-real.tsx', import.meta.url), 'utf-8')
}

// ==================================================
// SubjectClassroomWorkspacePageReal — ?tab= URL sync (source-text guard,
// the same convention every other real Supabase-backed page in this
// codebase uses, since vitest.config.ts runs in a `node` environment
// with no DOM). This is what lets ตรวจงานและคะแนน's own inner ?subtab=
// (see check-and-grades-tab.test.ts) survive a refresh — without ?tab=
// itself surviving too, the page would land back on ภาพรวม first.
// ==================================================

describe('subject-classroom-workspace-page-real.tsx — ?tab= stays in sync with every click, not just the initial deep link', () => {
  const source = readSource()

  it('every tab button calls handleTabClick(tab.key), never a bare setActiveTab', () => {
    expect(source).toContain('onClick={() => handleTabClick(tab.key)}')
    expect(source).not.toContain('onClick={() => setActiveTab(tab.key)}')
  })

  it('handleTabClick updates BOTH the local activeTab state and the ?tab= search param', () => {
    const fn = source.slice(source.indexOf('function handleTabClick'), source.indexOf('const [subject, setSubject]'))
    expect(fn).toContain('setActiveTab(key)')
    expect(fn).toContain("next.set('tab', key)")
  })

  it('uses { replace: true } so clicking through tabs never spams browser history', () => {
    const fn = source.slice(source.indexOf('function handleTabClick'), source.indexOf('const [subject, setSubject]'))
    expect(fn).toContain('{ replace: true }')
  })

  it('the initial tab still comes from the URL on mount, via resolveInitialTab, falling back to overview', () => {
    expect(source).toContain("const initialTabParam = searchParams.get('tab')")
    expect(source).toContain('resolveInitialTab(initialTabParam)')
  })
})

describe('subject-classroom-workspace-page-real.tsx — งาน removed as a top-level tab; assignments now live only inside ตรวจงานและคะแนน (the matrix)', () => {
  const source = readSource()

  it('TabKey/TABS no longer include an "assignments" entry or a "งาน" label', () => {
    expect(source).not.toMatch(/'overview' \| 'students' \| 'attendance' \| 'assignments'/)
    expect(source).not.toContain("{ key: 'assignments', label: 'งาน' }")
    expect(source).not.toMatch(/key: 'assignments'/)
  })

  it('no longer imports or renders AssignmentsTab on this page (it is still used elsewhere, by classroom-detail-page-real.tsx — just not imported HERE)', () => {
    expect(source).not.toMatch(/from '@\/features\/subjects-real\/tabs\/assignments-tab'/)
    expect(source).not.toContain('<AssignmentsTab')
  })

  it('a legacy ?tab=assignments (or ?tab=grades) deep link resolves to checkAndGrades via LEGACY_TAB_REDIRECTS, never falling back to overview or erroring', () => {
    expect(source).toContain('const LEGACY_TAB_REDIRECTS: Record<string, TabKey> = {')
    expect(source).toContain("assignments: 'checkAndGrades',")
    expect(source).toContain("grades: 'checkAndGrades',")
  })

  it('resolveInitialTab is a pure function: a real TabKey passes through, a legacy key redirects, anything else falls back to overview', () => {
    const fn = source.slice(source.indexOf('function resolveInitialTab'), source.indexOf('/**\n * The subject + classroom workspace'))
    expect(fn).toContain('if (isTabKey(value)) return value')
    expect(fn).toContain('if (value && value in LEGACY_TAB_REDIRECTS) return LEGACY_TAB_REDIRECTS[value]')
    expect(fn).toContain("return 'overview'")
  })

  it('a one-time effect rewrites a legacy ?tab= value in the URL itself (via setSearchParams), keyed off the ORIGINAL initialTabParam so it only ever fires once per legacy link', () => {
    const fn = source.slice(source.indexOf('useEffect(() => {\n    if (initialTabParam'), source.indexOf('const [subject, setSubject]'))
    expect(fn).toContain('if (initialTabParam && initialTabParam in LEGACY_TAB_REDIRECTS)')
    expect(fn).toContain("next.set('tab', LEGACY_TAB_REDIRECTS[initialTabParam])")
    expect(fn).toContain('{ replace: true }')
    expect(fn).toContain('}, [])')
  })
})

describe('subject-classroom-workspace-page-real.tsx — ตรวจงานและคะแนน replaces the old ตรวจสอบงาน/คะแนน tabs, rendering the merged component unchanged', () => {
  const source = readSource()

  it('imports CheckAndGradesTab, no longer imports SubmissionCheckTab or GradesTab directly', () => {
    expect(source).toContain("from '@/features/subjects-real/tabs/check-and-grades-tab'")
    expect(source).not.toMatch(/from '@\/features\/subjects-real\/tabs\/submission-check-tab'/)
    expect(source).not.toMatch(/from '@\/features\/subjects-real\/tabs\/grades-tab'/)
  })

  it('renders CheckAndGradesTab with the exact same props GradesTab used to receive (subject/classroomId/classroomName) — nothing new invented, no data refetched here', () => {
    const block = source.slice(source.indexOf("activeTab === 'checkAndGrades'"), source.indexOf('</div>\n    </div>\n  )\n}'))
    expect(block).toContain('subject={subject}')
    expect(block).toContain('classroomId={activeClassroomId}')
    expect(block).toContain("classroomName={currentLink.classroomName ?? ''}")
  })

  it('TABS has no separate submissionCheck or grades entries left', () => {
    expect(source).not.toMatch(/key: 'submissionCheck'/)
    expect(source).not.toMatch(/key: 'grades'/)
    expect(source).toContain("{ key: 'checkAndGrades', label: 'ตรวจงานและคะแนน' }")
  })
})

describe('subject-classroom-workspace-page-real.tsx — navigation simplification: นักเรียน reached via a top action button, not a pill tab', () => {
  const source = readSource()

  it('PILL_TABS (what actually renders as tab buttons) excludes นักเรียน; TABS (the full valid-key set, e.g. for ?tab=students deep links) still includes it', () => {
    expect(source).toContain("export const PILL_TABS = TABS.filter((tab) => tab.key !== 'students')")
    expect(source).toContain("{ key: 'students', label: 'นักเรียน' }")
  })

  it('the tab button row maps over PILL_TABS, not TABS directly', () => {
    expect(source).toContain('{PILL_TABS.map((tab) =>')
  })

  it('has a "รายชื่อนักเรียน" action button next to the ห้อง selector that switches to the students tab via the SAME handleTabClick used by every pill (so ?tab=students still syncs to the URL)', () => {
    const headerBlock = source.slice(source.indexOf('links.length > 1 &&'), source.indexOf('{PILL_TABS.map((tab) =>'))
    expect(headerBlock).toContain('รายชื่อนักเรียน')
    expect(headerBlock).toContain("onClick={() => handleTabClick('students')}")
  })

  it('StudentsTab itself is untouched — still rendered exactly as before, just from a different trigger', () => {
    expect(source).toContain("activeTab === 'students'")
    expect(source).toContain('<StudentsTab')
    expect(source).toContain('subjectName={subject.name}')
  })
})
