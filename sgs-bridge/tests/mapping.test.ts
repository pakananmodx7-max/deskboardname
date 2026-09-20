import { describe, expect, it } from 'vitest'

import { matchStudentsToSgs, normalizeStudentCode, normalizeThaiFullName } from '../src/lib/mapping.js'

function kn(studentId: string, studentNumber: number | null, fullName: string, score = 8, studentCode: string | null = null) {
  return { studentId, studentNumber, studentCode, fullName, score }
}

function sgs(sgsRowKey: string, sgsStudentNumber: number | null, sgsFullNameRaw: string, sgsStudentId: string | null = null) {
  return { sgsRowKey, sgsStudentNumber, sgsStudentId, sgsFullNameRaw }
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

describe('normalizeStudentCode', () => {
  it('trims and lowercases', () => {
    expect(normalizeStudentCode('  00001  ')).toBe('00001')
    expect(normalizeStudentCode('ABC1')).toBe('abc1')
  })
})

describe('matchStudentsToSgs — priority 1: exact normalized student code', () => {
  it('matches by student code even if number/name differ', () => {
    const results = matchStudentsToSgs([kn('k1', 1, 'เกศ ศรีคำฉิม', 8, '00007')], [sgs('row-1', 99, 'ชื่ออื่น', '00007')])
    expect(results[0].status).toBe('MATCHED')
    expect(results[0].matchedSgsRowKey).toBe('row-1')
  })

  it('is AMBIGUOUS when the code appears on more than one SGS row', () => {
    const results = matchStudentsToSgs(
      [kn('k1', null, 'สมชาย ใจดี', 8, '00007')],
      [sgs('row-1', null, 'คนละคน', '00007'), sgs('row-2', null, 'อีกคน', '00007')],
    )
    expect(results[0].status).toBe('AMBIGUOUS')
  })

  it('skips code matching (never a failure) when the KrunameClass student has no code', () => {
    const results = matchStudentsToSgs([kn('k1', 1, 'สมชาย ใจดี', 8, null)], [sgs('row-1', 1, 'สมชาย ใจดี', '00007')])
    expect(results[0].status).toBe('MATCHED')
  })
})

describe('matchStudentsToSgs — priority 2: exact student number AND normalized name together', () => {
  it('matches when both number and name agree on the same row', () => {
    const results = matchStudentsToSgs([kn('k1', 5, 'สมชาย ใจดี')], [sgs('row-1', 5, 'สมชาย ใจดี')])
    expect(results[0].status).toBe('MATCHED')
    expect(results[0].matchedSgsRowKey).toBe('row-1')
  })

  it('a duplicate student NUMBER is resolved (not ambiguous) once only one row also matches the name', () => {
    const results = matchStudentsToSgs(
      [kn('k1', 5, 'สมชาย ใจดี')],
      [sgs('row-1', 5, 'คนละคน'), sgs('row-2', 5, 'สมชาย ใจดี')],
    )
    expect(results[0].status).toBe('MATCHED')
    expect(results[0].matchedSgsRowKey).toBe('row-2')
  })

  it('is AMBIGUOUS when both number AND name agree on more than one row', () => {
    const results = matchStudentsToSgs(
      [kn('k1', 5, 'สมชาย ใจดี')],
      [sgs('row-1', 5, 'สมชาย ใจดี'), sgs('row-2', 5, 'สมชาย ใจดี')],
    )
    expect(results[0].status).toBe('AMBIGUOUS')
  })
})

describe('matchStudentsToSgs — priority 3: name fallback', () => {
  it('falls back to name when there is no student number', () => {
    const results = matchStudentsToSgs([kn('k1', null, 'สมชาย ใจดี')], [sgs('row-1', 9, 'สมชาย ใจดี')])
    expect(results[0].status).toBe('MATCHED')
  })

  it('falls back to name when the number does not match any same-named row', () => {
    const results = matchStudentsToSgs([kn('k1', 5, 'สมชาย ใจดี')], [sgs('row-1', 99, 'สมชาย ใจดี')])
    expect(results[0].status).toBe('MATCHED')
  })
})

describe('matchStudentsToSgs — never silently resolves AMBIGUOUS', () => {
  it('two identical normalized names in SGS (no number/code signal) stay AMBIGUOUS', () => {
    const results = matchStudentsToSgs(
      [kn('k1', null, 'สมชาย ใจดี')],
      [sgs('row-1', null, 'สมชาย ใจดี'), sgs('row-2', null, 'สมชาย ใจดี')],
    )
    expect(results[0].status).toBe('AMBIGUOUS')
    expect(results[0].matchedSgsRowKey).toBeNull()
  })
})

describe('matchStudentsToSgs — NOT_FOUND', () => {
  it('is NOT_FOUND against an empty candidate list — e.g. no rows extracted from the current SGS page', () => {
    const results = matchStudentsToSgs([kn('k1', 5, 'สมชาย ใจดี')], [])
    expect(results[0].status).toBe('NOT_FOUND')
  })
})

describe('matchStudentsToSgs — the exact live example from the bug report', () => {
  it('number 1 / เกศ ศรีคำฉิม / score 8 matches the visible SGS row 1 with the same name', () => {
    const results = matchStudentsToSgs([kn('k1', 1, 'เกศ ศรีคำฉิม', 8)], [sgs('row-0', 1, 'เกศ ศรีคำฉิม')])
    expect(results[0].status).toBe('MATCHED')
    expect(results[0].matchedSgsRowKey).toBe('row-0')
  })
})
