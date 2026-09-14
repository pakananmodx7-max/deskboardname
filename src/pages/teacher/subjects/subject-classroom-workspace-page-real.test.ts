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

  it('the initial tab still comes from the URL on mount, falling back to overview — unchanged from before', () => {
    expect(source).toContain("const initialTabParam = searchParams.get('tab')")
    expect(source).toContain("isTabKey(initialTabParam) ? initialTabParam : 'overview'")
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
