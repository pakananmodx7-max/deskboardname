import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./coming-soon-module-page.tsx', import.meta.url), 'utf-8')
}

describe('ComingSoonModulePage — generic placeholder, no new backend', () => {
  const source = readSource()

  it('has no data fetching or Supabase calls — it is a static placeholder only', () => {
    expect(source).not.toMatch(/supabase|useEffect|useState|fetch\(/)
  })

  it('accepts title/description/icon so it can be reused for every not-yet-built module', () => {
    expect(source).toContain('title: string')
    expect(source).toContain('description: string')
    expect(source).toContain('icon: LucideIcon')
  })

  it('the "เร็ว ๆ นี้" badge is optional, not hardcoded — some placeholders (เพิ่มระบบใหม่) show none', () => {
    expect(source).toContain('badge?: string')
  })
})
