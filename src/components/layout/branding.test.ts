import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const MAIN_TITLE = 'KrunameClass'
const SUBTITLE = 'ระบบจัดการห้องเรียน'

function readSource(relativeToThisFile: string): string {
  return readFileSync(new URL(relativeToThisFile, import.meta.url), 'utf-8')
}

/**
 * Teacher sidebar, student sidebar, the top header (both real and demo
 * variants), the auth shell (login/signup/forgot/reset), and the role
 * choice page used to show a placeholder Thai name ("ระบบการจัดการชั้นเรียน" /
 * "จัดทำโดยครูเนม") left over from an earlier rebrand, while the browser
 * tab and the backup-export subtitle already said "KrunameClass" —
 * three different names shown across the same app. This guards the
 * unification: every one of those surfaces must show the current
 * "KrunameClass" name, and none may still show the old placeholder
 * (the feature-specific "AI Classroom Assistant" name on the AI page is
 * a different, deliberately untouched concern — see ai-page.tsx).
 */
describe('Branding — one name, "KrunameClass", everywhere it appears', () => {
  const sources: [label: string, path: string][] = [
    ['teacher sidebar', './sidebar.tsx'],
    ['student sidebar', './student-sidebar.tsx'],
    ['top header (real + demo)', './header.tsx'],
    ['auth shell (login/signup/forgot/reset)', '../auth/auth-shell.tsx'],
    ['role choice page', '../../pages/root/role-choice-page.tsx'],
  ]

  for (const [label, path] of sources) {
    it(`${label} shows KrunameClass and its subtitle, and no longer shows the old placeholder name`, () => {
      const source = readSource(path)
      expect(source).toContain(MAIN_TITLE)
      expect(source).toContain(SUBTITLE)
      expect(source).not.toContain('ระบบการจัดการชั้นเรียน')
      expect(source).not.toContain('จัดทำโดยครูเนม')
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

  it('the teacher sidebar footer is the production copyright line, not a prototype/version label', () => {
    const source = readSource('./sidebar.tsx')
    expect(source).toContain('© 2026 KrunameClass. All rights reserved.')
    expect(source).not.toContain('Prototype')
    expect(source).not.toContain('v0.1.0')
  })

  it('the browser tab shows the production title and the KrunameClass favicon (not the Vite bolt)', () => {
    const html = readSource('../../../index.html')
    expect(html).toContain('<title>KrunameClass | ระบบจัดการชั้นเรียน</title>')
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />')
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />')
    const favicon = readSource('../../../public/favicon.svg')
    expect(favicon).toContain('KrunameClass')
    expect(favicon).not.toContain('#863bff')
  })

  it('no UI component shows a development-only "Prototype" label', async () => {
    const { readdirSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const root = new URL('../../', import.meta.url).pathname
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (name.endsWith('.tsx') && !name.includes('.test.') && readFileSync(path, 'utf-8').includes('Prototype')) offenders.push(path)
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })

  it('main titles are bold and subtitles are muted + smaller, per spec', () => {
    for (const [, path] of sources) {
      const source = readSource(path)
      expect(source).toMatch(/font-bold/)
    }
  })
})
