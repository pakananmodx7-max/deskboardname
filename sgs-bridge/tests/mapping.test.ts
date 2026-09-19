import { describe, expect, it } from 'vitest'

import { matchStudentsToSgs, normalizeThaiFullName } from '../src/lib/mapping.js'

function kn(studentId: string, studentNumber: number | null, fullName: string, score = 8) {
  return { studentId, studentNumber, fullName, score }
}

function sgs(sgsRowKey: string, sgsStudentNumber: number | null, sgsFullNameRaw: string) {
  return { sgsRowKey, sgsStudentNumber, sgsStudentId: null, sgsFullNameRaw }
}

// Mirrors src/services/sgs-mapping-service.test.ts one-for-one — this
// extension duplicates that module's logic (see mapping.js's own doc
// comment), so its tests must cover the identical cases to guarantee
// the two never silently drift apart.

describe('normalizeThaiFullName', () => {
  it('strips a common Thai title prefix and collapses whitespace', () => {
    expect(normalizeThaiFullName('เด็กชายสมชาย   ใจดี')).toBe(normalizeThaiFullName('สมชาย ใจดี'))
  })
})

describe('matchStudentsToSgs — priority 1: student number', () => {
  it('matches by number when exactly one SGS row has it', () => {
    const results = matchStudentsToSgs([kn('k1', 5, 'สมชาย ใจดี')], [sgs('row-1', 5, 'สมชาย ใจดี')])
    expect(results[0].status).toBe('MATCHED')
    expect(results[0].matchedSgsRowKey).toBe('row-1')
  })

  it('is AMBIGUOUS on a duplicate student number, never guessed via name', () => {
    const results = matchStudentsToSgs(
      [kn('k1', 5, 'สมชาย ใจดี')],
      [sgs('row-1', 5, 'คนละคน'), sgs('row-2', 5, 'สมชาย ใจดี')],
    )
    expect(results[0].status).toBe('AMBIGUOUS')
  })
})

describe('matchStudentsToSgs — name fallback', () => {
  it('falls back to name when there is no student number', () => {
    const results = matchStudentsToSgs([kn('k1', null, 'สมชาย ใจดี')], [sgs('row-1', 9, 'สมชาย ใจดี')])
    expect(results[0].status).toBe('MATCHED')
  })
})

describe('matchStudentsToSgs — never silently resolves AMBIGUOUS', () => {
  it('two identical normalized names in SGS stay AMBIGUOUS', () => {
    const results = matchStudentsToSgs(
      [kn('k1', null, 'สมชาย ใจดี')],
      [sgs('row-1', null, 'สมชาย ใจดี'), sgs('row-2', null, 'สมชาย ใจดี')],
    )
    expect(results[0].status).toBe('AMBIGUOUS')
    expect(results[0].matchedSgsRowKey).toBeNull()
  })
})

describe('matchStudentsToSgs — NOT_FOUND', () => {
  it('is NOT_FOUND against an empty candidate list — the extension\'s current real-world state until Phase 5 selectors exist', () => {
    const results = matchStudentsToSgs([kn('k1', 5, 'สมชาย ใจดี')], [])
    expect(results[0].status).toBe('NOT_FOUND')
  })
})
