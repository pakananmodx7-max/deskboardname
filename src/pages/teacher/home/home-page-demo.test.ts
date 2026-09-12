import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./home-page-demo.tsx', import.meta.url), 'utf-8')
}

describe('HomePageDemo', () => {
  const source = readSource()

  it('reuses the existing demo-context state instead of inventing its own numbers', () => {
    expect(source).toContain('useDemoClassroom')
    expect(source).toContain('students.length')
    expect(source).toContain('subjects.length')
  })

  it('shows ระบบเอกสาร and งานและเตือนความจำ as coming-soon placeholders, and the Hermes summary card', () => {
    expect(source).toContain('ระบบเอกสาร')
    expect(source).toContain('งานและเตือนความจำ')
    expect(source).toContain('<HermesSummaryCard')
  })
})
