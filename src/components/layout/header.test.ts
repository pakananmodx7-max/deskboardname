import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./header.tsx', import.meta.url), 'utf-8')
}

describe('RealHeader — global search + date context (dashboard redesign)', () => {
  const source = readSource()

  it('renders the exact requested search placeholder text', () => {
    expect(source).toContain('ค้นหานักเรียน ห้องเรียน รายวิชา หรืองาน...')
  })

  it('is wired into RealHeader, not just defined and unused', () => {
    const realHeaderBody = source.slice(source.indexOf('function RealHeader'))
    expect(realHeaderBody).toContain('<GlobalSearchField')
    expect(realHeaderBody).toContain('<TodayDateLabel')
  })

  it('shows only the real current date in RealHeader — never a fabricated semester label', () => {
    const realHeaderBody = source.slice(source.indexOf('function RealHeader'))
    expect(realHeaderBody).not.toMatch(/ภาคเรียนที่ \d/)
  })
})
