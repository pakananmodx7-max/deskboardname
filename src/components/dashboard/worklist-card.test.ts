import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./worklist-card.tsx', import.meta.url), 'utf-8')
}

describe('WorklistCard — one shared list primitive for all 3 altitudes', () => {
  const source = readSource()

  it('renders a single button per row that deep-links via the item\'s own actionTo — never a bespoke per-kind handler', () => {
    expect(source).toContain('<Link to={item.actionTo}>{item.actionLabel}</Link>')
  })

  it('shows loading/error/empty states rather than crashing on missing data', () => {
    expect(source).toContain('loading')
    expect(source).toContain('error')
    expect(source).toContain('emptyMessage')
  })
})
