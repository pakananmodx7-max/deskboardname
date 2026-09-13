import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./disclosure.tsx', import.meta.url), 'utf-8')
}

describe('Disclosure — plain native <details>/<summary>, no new dependency', () => {
  const source = readSource()

  it('uses the native <details>/<summary> elements rather than a JS-driven open/close', () => {
    expect(source).toContain('<details')
    expect(source).toContain('<summary')
    expect(source).not.toContain('useState')
  })
})
