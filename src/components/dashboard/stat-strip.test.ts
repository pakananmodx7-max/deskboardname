import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./stat-strip.tsx', import.meta.url), 'utf-8')
}

describe('StatStrip — one card for N stats instead of N separate cards', () => {
  const source = readSource()

  it('renders every item inside a single Card, not one Card per item', () => {
    const cardOpenCount = (source.match(/<Card>/g) ?? []).length
    expect(cardOpenCount).toBe(1)
  })
})
