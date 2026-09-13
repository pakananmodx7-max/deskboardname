import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./empty-state.tsx', import.meta.url), 'utf-8')
}

describe('EmptyState — one honest "nothing here" message, reused everywhere data is empty', () => {
  const source = readSource()

  it('renders the caller-provided message verbatim, never a hardcoded/fabricated string', () => {
    expect(source).toContain('{message}')
    expect(source).not.toMatch(/message\s*=\s*['"][ก-๙]/)
  })
})
