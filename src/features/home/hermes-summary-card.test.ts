import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./hermes-summary-card.tsx', import.meta.url), 'utf-8')
}

describe('HermesSummaryCard — honest status only (Requirement 8: never fabricate)', () => {
  const source = readSource()

  it('never claims a live Online/Offline/Connected status in its rendered JSX', () => {
    const jsxOnly = source.slice(source.indexOf('return ('))
    expect(jsxOnly).not.toMatch(/Online|Offline|เชื่อมต่อแล้ว|กำลังทำงาน/)
  })

  it('links to the full Hermes Agent page', () => {
    expect(source).toContain('to="/teacher/hermes"')
  })

  it('shows only the fixed, known tool count, not a fabricated activity feed', () => {
    expect(source).toContain('HERMES_TOTAL_TOOL_COUNT')
  })
})
