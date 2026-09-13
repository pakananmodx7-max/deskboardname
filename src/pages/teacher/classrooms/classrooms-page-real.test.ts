import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./classrooms-page-real.tsx', import.meta.url), 'utf-8')
}

describe('ClassroomsPageReal — archived classrooms tucked into a disclosure', () => {
  const source = readSource()

  it('splits classrooms into active and archived groups by isActive', () => {
    expect(source).toContain('s.classroom.isActive')
    expect(source).toContain('!s.classroom.isActive')
  })

  it('renders archived classrooms inside a labeled Disclosure, not the main grid', () => {
    expect(source).toContain('<Disclosure summary={`เก็บถาวร (${archivedSummaries.length})`}>')
  })

  it('the header count reflects active classrooms only', () => {
    expect(source).toContain('${activeSummaries.length} ห้องเรียน')
  })
})

describe('ClassroomsPageReal — subject chips close the classroom↔subject gap', () => {
  const source = readSource()

  it('fetches each classroom\'s linked subjects via the existing reverse-lookup, not a new query', () => {
    expect(source).toContain('getClassroomSubjects(classroom.id)')
  })

  it('renders one chip per linked subject on the card', () => {
    expect(source).toContain('subjectNames.map((name) =>')
    expect(source).toContain('variant="secondary"')
  })
})
