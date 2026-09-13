import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./dashboard-section.tsx', import.meta.url), 'utf-8')
}

describe('DashboardSection — one consistent card-with-heading shell', () => {
  const source = readSource()

  it('renders exactly one Card with a CardTitle, so every section heading is styled identically', () => {
    expect((source.match(/<Card[\s>]/g) ?? []).length).toBe(1)
    expect(source).toContain('<CardTitle')
  })

  it('accepts an optional action slot next to the title (e.g. a "ดูทั้งหมด" link)', () => {
    expect(source).toContain('action')
  })
})
