import { describe, expect, it } from 'vitest'

import {
  matchStudentsToSgs,
  normalizeThaiFullName,
  type SgsMappingCandidate,
  type SgsMappingInputStudent,
} from '@/services/sgs-mapping-service'

function kn(studentId: string, studentNumber: number | null, fullName: string, score = 8): SgsMappingInputStudent {
  return { studentId, studentNumber, fullName, score }
}

function sgs(sgsRowKey: string, sgsStudentNumber: number | null, sgsFullNameRaw: string): SgsMappingCandidate {
  return { sgsRowKey, sgsStudentNumber, sgsStudentId: null, sgsFullNameRaw }
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

describe('matchStudentsToSgs — priority 1: student number', () => {
  it('matches by student number when exactly one SGS row has it', () => {
    const results = matchStudentsToSgs([kn('k1', 5, 'สมชาย ใจดี')], [sgs('row-1', 5, 'สมชาย ใจดี')])
    expect(results[0].status).toBe('MATCHED')
    expect(results[0].matchedSgsRowKey).toBe('row-1')
  })

  it('is AMBIGUOUS when the SGS page has a duplicate student number, even though a name match would resolve it', () => {
    const results = matchStudentsToSgs(
      [kn('k1', 5, 'สมชาย ใจดี')],
      [sgs('row-1', 5, 'คนละคน'), sgs('row-2', 5, 'สมชาย ใจดี')],
    )
    expect(results[0].status).toBe('AMBIGUOUS')
    expect(results[0].matchedSgsRowKey).toBeNull()
  })
})

describe('matchStudentsToSgs — priority 3: normalized full name fallback', () => {
  it('falls back to name matching when the student has no number', () => {
    const results = matchStudentsToSgs([kn('k1', null, 'สมชาย ใจดี')], [sgs('row-1', 9, 'สมชาย ใจดี')])
    expect(results[0].status).toBe('MATCHED')
    expect(results[0].matchedSgsRowKey).toBe('row-1')
  })

  it('falls back to name matching when the student number does not appear in SGS at all', () => {
    const results = matchStudentsToSgs([kn('k1', 5, 'สมชาย ใจดี')], [sgs('row-1', 99, 'สมชาย ใจดี')])
    expect(results[0].status).toBe('MATCHED')
    expect(results[0].reason).toContain('ชื่อ-นามสกุล')
  })

  it('matches names across a title-prefix/whitespace difference', () => {
    const results = matchStudentsToSgs([kn('k1', null, 'สมชาย ใจดี')], [sgs('row-1', null, 'เด็กชายสมชาย   ใจดี')])
    expect(results[0].status).toBe('MATCHED')
  })
})

describe('matchStudentsToSgs — AMBIGUOUS never silently resolved', () => {
  it('two SGS rows with the identical normalized name are AMBIGUOUS, not a guess', () => {
    const results = matchStudentsToSgs(
      [kn('k1', null, 'สมชาย ใจดี')],
      [sgs('row-1', null, 'สมชาย ใจดี'), sgs('row-2', null, 'สมชาย ใจดี')],
    )
    expect(results[0].status).toBe('AMBIGUOUS')
    expect(results[0].matchedSgsRowKey).toBeNull()
  })
})

describe('matchStudentsToSgs — NOT_FOUND', () => {
  it('is NOT_FOUND when nothing matches by number or name', () => {
    const results = matchStudentsToSgs([kn('k1', 5, 'สมชาย ใจดี')], [sgs('row-1', 9, 'คนละคนเลย')])
    expect(results[0].status).toBe('NOT_FOUND')
    expect(results[0].matchedSgsRowKey).toBeNull()
  })

  it('is NOT_FOUND against an empty SGS candidate list', () => {
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
