import { describe, expect, it } from 'vitest'

import {
  matchStudentsToSgs,
  normalizeStudentCode,
  normalizeThaiFullName,
  type SgsMappingCandidate,
  type SgsMappingInputStudent,
} from '@/services/sgs-mapping-service'

function kn(
  studentId: string,
  studentNumber: number | null,
  fullName: string,
  score = 8,
  studentCode: string | null = null,
): SgsMappingInputStudent {
  return { studentId, studentNumber, studentCode, fullName, score }
}

function sgs(
  sgsRowKey: string,
  sgsStudentNumber: number | null,
  sgsFullNameRaw: string,
  sgsStudentId: string | null = null,
): SgsMappingCandidate {
  return { sgsRowKey, sgsStudentNumber, sgsStudentId, sgsFullNameRaw }
}

describe('normalizeThaiFullName', () => {
  it('strips a common Thai title prefix', () => {
    expect(normalizeThaiFullName('เด็กชายสมชาย ใจดี')).toBe(normalizeThaiFullName('สมชาย ใจดี'))
  })

  it('collapses internal whitespace differences', () => {
    expect(normalizeThaiFullName('สมชาย   ใจดี')).toBe(normalizeThaiFullName('สมชาย ใจดี'))
  })

  it('trims leading/trailing whitespace', () => {
    expect(normalizeThaiFullName('  สมชาย ใจดี  ')).toBe(normalizeThaiFullName('สมชาย ใจดี'))
  })
})

describe('normalizeStudentCode', () => {
  it('trims and lowercases', () => {
    expect(normalizeStudentCode('  00001  ')).toBe('00001')
    expect(normalizeStudentCode('ABC1')).toBe('abc1')
  })
})

describe('matchStudentsToSgs — priority 1: exact normalized student code', () => {
  it('matches by student code when exactly one SGS row has it, even if number/name differ', () => {
    const results = matchStudentsToSgs(
      [kn('k1', 1, 'เกศ ศรีคำฉิม', 8, '00007')],
      [sgs('row-1', 99, 'ชื่ออื่น', '00007')],
    )
    expect(results[0].status).toBe('MATCHED')
    expect(results[0].matchedSgsRowKey).toBe('row-1')
    expect(results[0].reason).toContain('รหัสนักเรียน')
  })

  it('is case/whitespace-insensitive', () => {
    const results = matchStudentsToSgs([kn('k1', null, 'สมชาย ใจดี', 8, '  A001 ')], [sgs('row-1', null, 'คนละคน', 'a001')])
    expect(results[0].status).toBe('MATCHED')
  })

  it('is AMBIGUOUS when the code appears on more than one SGS row', () => {
    const results = matchStudentsToSgs(
      [kn('k1', null, 'สมชาย ใจดี', 8, '00007')],
      [sgs('row-1', null, 'คนละคน', '00007'), sgs('row-2', null, 'อีกคน', '00007')],
    )
    expect(results[0].status).toBe('AMBIGUOUS')
    expect(results[0].matchedSgsRowKey).toBeNull()
  })

  it('skips code matching entirely (never a failure) when the KrunameClass student has no code — falls through to number+name', () => {
    const results = matchStudentsToSgs([kn('k1', 1, 'สมชาย ใจดี', 8, null)], [sgs('row-1', 1, 'สมชาย ใจดี', '00007')])
    expect(results[0].status).toBe('MATCHED')
    expect(results[0].reason).toContain('เลขที่')
  })

  it('falls through to number+name when the code does not match any SGS row', () => {
    const results = matchStudentsToSgs([kn('k1', 1, 'สมชาย ใจดี', 8, '99999')], [sgs('row-1', 1, 'สมชาย ใจดี', '00007')])
    expect(results[0].status).toBe('MATCHED')
    expect(results[0].reason).toContain('เลขที่')
  })
})

describe('matchStudentsToSgs — priority 2: exact student number AND normalized name together', () => {
  it('matches when both number and name agree on the same row', () => {
    const results = matchStudentsToSgs([kn('k1', 1, 'เกศ ศรีคำฉิม')], [sgs('row-1', 1, 'เกศ ศรีคำฉิม')])
    expect(results[0].status).toBe('MATCHED')
    expect(results[0].matchedSgsRowKey).toBe('row-1')
  })

  it('a duplicate student NUMBER across two SGS rows is resolved (not ambiguous) once only one of them also matches the name', () => {
    const results = matchStudentsToSgs(
      [kn('k1', 5, 'สมชาย ใจดี')],
      [sgs('row-1', 5, 'คนละคน'), sgs('row-2', 5, 'สมชาย ใจดี')],
    )
    expect(results[0].status).toBe('MATCHED')
    expect(results[0].matchedSgsRowKey).toBe('row-2')
  })

  it('is AMBIGUOUS when both number AND name agree on more than one SGS row', () => {
    const results = matchStudentsToSgs(
      [kn('k1', 5, 'สมชาย ใจดี')],
      [sgs('row-1', 5, 'สมชาย ใจดี'), sgs('row-2', 5, 'สมชาย ใจดี')],
    )
    expect(results[0].status).toBe('AMBIGUOUS')
    expect(results[0].matchedSgsRowKey).toBeNull()
  })

  it('falls through to name-alone when the number does not match any row with the same name', () => {
    const results = matchStudentsToSgs([kn('k1', 5, 'สมชาย ใจดี')], [sgs('row-1', 99, 'สมชาย ใจดี')])
    expect(results[0].status).toBe('MATCHED')
    expect(results[0].reason).toContain('ชื่อ-นามสกุล')
  })
})

describe('matchStudentsToSgs — priority 3: normalized full name fallback', () => {
  it('falls back to name matching when the student has no number', () => {
    const results = matchStudentsToSgs([kn('k1', null, 'สมชาย ใจดี')], [sgs('row-1', 9, 'สมชาย ใจดี')])
    expect(results[0].status).toBe('MATCHED')
    expect(results[0].matchedSgsRowKey).toBe('row-1')
  })

  it('matches names across a title-prefix/whitespace difference', () => {
    const results = matchStudentsToSgs([kn('k1', null, 'สมชาย ใจดี')], [sgs('row-1', null, 'เด็กชายสมชาย   ใจดี')])
    expect(results[0].status).toBe('MATCHED')
  })
})

describe('matchStudentsToSgs — AMBIGUOUS never silently resolved', () => {
  it('two SGS rows with the identical normalized name (no number/code signal) are AMBIGUOUS, not a guess', () => {
    const results = matchStudentsToSgs(
      [kn('k1', null, 'สมชาย ใจดี')],
      [sgs('row-1', null, 'สมชาย ใจดี'), sgs('row-2', null, 'สมชาย ใจดี')],
    )
    expect(results[0].status).toBe('AMBIGUOUS')
    expect(results[0].matchedSgsRowKey).toBeNull()
  })
})

describe('matchStudentsToSgs — NOT_FOUND', () => {
  it('is NOT_FOUND when nothing matches by code, number+name, or name', () => {
    const results = matchStudentsToSgs([kn('k1', 5, 'สมชาย ใจดี')], [sgs('row-1', 9, 'คนละคนเลย')])
    expect(results[0].status).toBe('NOT_FOUND')
    expect(results[0].matchedSgsRowKey).toBeNull()
  })

  it('is NOT_FOUND against an empty SGS candidate list — e.g. the visible current page has no matching student row', () => {
    const results = matchStudentsToSgs([kn('k1', 5, 'สมชาย ใจดี')], [])
    expect(results[0].status).toBe('NOT_FOUND')
  })
})

describe('matchStudentsToSgs — carries the score through untouched', () => {
  it('the input score is passed through unchanged regardless of match status', () => {
    const results = matchStudentsToSgs([kn('k1', 5, 'สมชาย ใจดี', 0)], [])
    expect(results[0].score).toBe(0)
  })
})

describe('matchStudentsToSgs — the exact live example from the bug report', () => {
  it('number 1 / เกศ ศรีคำฉิม / score 8 matches the visible SGS row 1 with the same name', () => {
    const results = matchStudentsToSgs(
      [kn('k1', 1, 'เกศ ศรีคำฉิม', 8)],
      [sgs('row-0', 1, 'เกศ ศรีคำฉิม')],
    )
    expect(results[0].status).toBe('MATCHED')
    expect(results[0].matchedSgsRowKey).toBe('row-0')
    expect(results[0].score).toBe(8)
  })
})
