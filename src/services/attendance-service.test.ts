import { describe, expect, it } from 'vitest'

import {
  buildDefaultRecords,
  deriveAttendanceRoster,
  getAttendanceSummary,
  parsePeriodNumber,
} from '@/services/attendance-service'
import type { AttendanceRecord } from '@/types/attendance'

describe('buildDefaultRecords', () => {
  it('defaults every given student id to present with no note', () => {
    const records = buildDefaultRecords(['s1', 's2'])
    expect(records).toEqual({
      s1: { studentId: 's1', status: 'present', note: null },
      s2: { studentId: 's2', status: 'present', note: null },
    })
  })

  it('returns an empty map for an empty roster (empty classroom)', () => {
    expect(buildDefaultRecords([])).toEqual({})
  })
})

describe('getAttendanceSummary', () => {
  it('tallies each status and the total', () => {
    const records: Record<string, AttendanceRecord> = {
      s1: { studentId: 's1', status: 'present', note: null },
      s2: { studentId: 's2', status: 'present', note: null },
      s3: { studentId: 's3', status: 'late', note: 'รถติด' },
      s4: { studentId: 's4', status: 'leave', note: 'ป่วย' },
      s5: { studentId: 's5', status: 'absent', note: null },
    }
    expect(getAttendanceSummary(records)).toEqual({ present: 2, late: 1, leave: 1, absent: 1, total: 5 })
  })

  it('returns all zeros for an empty classroom', () => {
    expect(getAttendanceSummary({})).toEqual({ present: 0, late: 0, leave: 0, absent: 0, total: 0 })
  })
})

describe('deriveAttendanceRoster', () => {
  const active = (id: string) => ({ id, status: 'active' as const })
  const inactive = (id: string) => ({ id, status: 'inactive' as const })

  it('includes every active student, with or without a record', () => {
    const roster = deriveAttendanceRoster([active('s1'), active('s2')], {})
    expect(roster.map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('excludes an inactive (archived) student who has no saved record for this session', () => {
    const roster = deriveAttendanceRoster([active('s1'), inactive('s2')], {})
    expect(roster.map((s) => s.id)).toEqual(['s1'])
  })

  it('keeps an inactive student who already has a saved record — never silently drops history', () => {
    const records: Record<string, AttendanceRecord> = {
      s2: { studentId: 's2', status: 'leave', note: 'ลาออก' },
    }
    const roster = deriveAttendanceRoster([active('s1'), inactive('s2')], records)
    expect(roster.map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('returns an empty roster for an empty classroom', () => {
    expect(deriveAttendanceRoster([], {})).toEqual([])
  })
})

describe('parsePeriodNumber', () => {
  it('treats empty/whitespace input as valid "no period" (null)', () => {
    expect(parsePeriodNumber('')).toEqual({ value: null, invalid: false })
    expect(parsePeriodNumber('   ')).toEqual({ value: null, invalid: false })
  })

  it('accepts a positive integer', () => {
    expect(parsePeriodNumber('1')).toEqual({ value: 1, invalid: false })
    expect(parsePeriodNumber('5')).toEqual({ value: 5, invalid: false })
  })

  it('rejects zero, negative, and non-integer values', () => {
    expect(parsePeriodNumber('0')).toEqual({ value: null, invalid: true })
    expect(parsePeriodNumber('-1')).toEqual({ value: null, invalid: true })
    expect(parsePeriodNumber('1.5')).toEqual({ value: null, invalid: true })
  })

  it('rejects non-numeric input', () => {
    expect(parsePeriodNumber('abc')).toEqual({ value: null, invalid: true })
  })
})
