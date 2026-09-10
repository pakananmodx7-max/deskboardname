import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const MAIN_TITLE = 'ระบบการจัดการชั้นเรียน'
const SUBTITLE = 'จัดทำโดยครูเนม'

function readSource(relativeToThisFile: string): string {
  return readFileSync(new URL(relativeToThisFile, import.meta.url), 'utf-8')
}

/**
 * Teacher sidebar, student sidebar, the top header (both real and demo
 * variants), the auth shell (login/signup/forgot/reset), and the role
 * choice page all used to show the English "AI Classroom" label. This
 * guards the rebrand: every one of those surfaces must show the new Thai
 * main title + subtitle, and none may still show the old English label
 * (the feature-specific "AI Classroom Assistant" name on the AI page is
 * a different, deliberately untouched concern — see ai-page.tsx).
 */
describe('Branding — "AI Classroom" replaced with Thai branding everywhere it appeared', () => {
  const sources: [label: string, path: string][] = [
    ['teacher sidebar', './sidebar.tsx'],
    ['student sidebar', './student-sidebar.tsx'],
    ['top header (real + demo)', './header.tsx'],
    ['auth shell (login/signup/forgot/reset)', '../auth/auth-shell.tsx'],
    ['role choice page', '../../pages/root/role-choice-page.tsx'],
  ]

  for (const [label, path] of sources) {
    it(`${label} shows the new main title and subtitle, and no longer says "AI Classroom"`, () => {
      const source = readSource(path)
      expect(source).toContain(MAIN_TITLE)
      expect(source).toContain(SUBTITLE)
      expect(source).not.toContain('AI Classroom')
    })
  }

  it('the top header shows the new title exactly twice (once for the demo variant, once for the real variant)', () => {
    const source = readSource('./header.tsx')
    const occurrences = source.split(MAIN_TITLE).length - 1
    expect(occurrences).toBe(2)
  })

  it('the teacher sidebar keeps the graduation-cap icon and does not widen the sidebar container', () => {
    const source = readSource('./sidebar.tsx')
    expect(source).toContain('GraduationCap')
    expect(source).toContain('w-64')
    expect(source).not.toMatch(/w-(72|80|96)\b/)
  })

  it('main titles are bold and subtitles are muted + smaller, per spec', () => {
    for (const [, path] of sources) {
      const source = readSource(path)
      expect(source).toMatch(/font-bold/)
    }
  })
})
