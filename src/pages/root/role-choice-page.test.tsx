import { readFileSync } from 'node:fs'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { RoleChoicePage } from './role-choice-page'

const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RoleChoicePage)))
const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf-8')

describe('RoleChoicePage (Class N)', () => {
  it('keeps the same two destinations: teacher → /login, student → /student/login', () => {
    const hrefs = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1])
    expect(hrefs).toEqual(['/login', '/student/login'])
  })

  it('shows the heading, instruction and both cards', () => {
    expect(html).toMatch(/<div role="heading" aria-level="1" class="[^"]*"><div class="[^"]*" role="img" aria-label="Class N">/)
    expect(html).toContain('กรุณาเลือกประเภทผู้ใช้งานเพื่อเข้าสู่ระบบ')
    expect(html).toContain('ครูผู้สอน')
    expect(html).toContain('เข้าสู่ระบบสำหรับครูผู้สอน')
    expect(html).toContain('นักเรียน')
    expect(html).toContain('เข้าสู่ระบบสำหรับนักเรียน')
    expect(html).not.toContain('KrunameClass')
  })

  it('developer credit: bottom-right on desktop, centred below the cards on mobile', () => {
    expect(html.match(/Pakanan Modbut/g)).toHaveLength(2)
    expect(html).toContain('© 2026 Class N')
    expect(html).toMatch(/class="[^"]*mt-12 md:hidden/)
    expect(html).toMatch(/class="[^"]*absolute z-10 hidden text-right md:block/)
  })

  it('decoration is hidden from assistive tech and never takes clicks', () => {
    expect(html).toMatch(/<div aria-hidden="true" class="pointer-events-none absolute inset-0/)
  })

  it('the heading is the shared interactive Class N mark, in light colours whatever the app theme', () => {
    const page = css.slice(css.indexOf('.kc-role-page {'))
    expect(page.slice(0, page.indexOf('}'))).toContain('--class-n-ink: #285a99;')
    expect(page.slice(0, page.indexOf('}'))).toContain('--class-n-accent: #5685c2;')
    expect(css).not.toContain('kc-role-title')
  })

  it('background animations are CSS-only, within 12–16 s, and stop for reduced motion', () => {
    for (const s of css.matchAll(/kc-role-(?:drift-[abc]|wave-flow) (\d+)s/g)) {
      expect(Number(s[1])).toBeGreaterThanOrEqual(12)
      expect(Number(s[1])).toBeLessThanOrEqual(16)
    }
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    for (const cls of ['.kc-role-blob-a', '.kc-role-blob-b', '.kc-role-blob-c', '.kc-role-wave']) expect(reduced).toContain(cls)
  })
})
