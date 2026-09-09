import { describe, expect, it } from 'vitest'

import {
  buildDefaultRecords,
  buildRecordsForRoster,
  deriveAttendanceRoster,
  getAttendanceSummary,
  parsePeriodNumber,
  type AttendanceForDate,
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

/**
 * Regression coverage for the production bug where a classroom with a
 * real roster (31 active students) rendered "ยังไม่มีนักเรียนในห้องเรียนนี้"
 * (0 students) whenever the attendance-session lookup failed or errored —
 * because the page combined getStudentsByClassroom + getAttendance via
 * Promise.all, so ANY failure in the attendance lookup wiped out the
 * roster too, even though the roster had already loaded successfully.
 * buildRecordsForRoster + deriveAttendanceRoster together are exactly
 * the pure logic the real page now runs once the roster fetch succeeds,
 * independent of whether the attendance fetch succeeds, fails, or is
 * still pending (see attendance-page-real.tsx and
 * subjects-real/tabs/attendance-tab.tsx).
 */
describe('buildRecordsForRoster — the roster must survive a failed/missing attendance lookup', () => {
  function makeRoster(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: `student-${i + 1}`,
      status: 'active' as const,
    }))
  }

  it('classroom has 31 students + no attendance session yet -> all 31 default to "มา", roster is 31 not 0', () => {
    const roster = makeRoster(31)
    const activeIds = roster.map((s) => s.id)

    const records = buildRecordsForRoster(activeIds, { session: null, records: {} })
    const finalRoster = deriveAttendanceRoster(roster, records)

    expect(finalRoster).toHaveLength(31)
    expect(Object.keys(records)).toHaveLength(31)
    expect(Object.values(records).every((r) => r.status === 'present')).toBe(true)
  })

  it('classroom has 31 students + the attendance lookup THREW (network/DB error) -> still all 31, defaulted to "มา", never 0', () => {
    const roster = makeRoster(31)
    const activeIds = roster.map((s) => s.id)

    // The real page passes `null` here for a failed getAttendance() call —
    // this is the exact case the production bug got wrong.
    const records = buildRecordsForRoster(activeIds, null)
    const finalRoster = deriveAttendanceRoster(roster, records)

    expect(finalRoster).toHaveLength(31)
    expect(Object.keys(records)).toHaveLength(31)
    expect(Object.values(records).every((r) => r.status === 'present')).toBe(true)
  })

  it('existing attendance session -> saved statuses win over the "มา" default, roster still complete', () => {
    const roster = makeRoster(5)
    const activeIds = roster.map((s) => s.id)
    const attendance: AttendanceForDate = {
      session: {
        id: 'session-1',
        classroomId: 'classroom-1',
        subjectId: null,
        periodNumber: null,
        attendanceDate: '2026-09-09',
        createdBy: 'teacher-1',
        createdAt: '2026-09-09T00:00:00Z',
        updatedAt: '2026-09-09T00:00:00Z',
      },
      records: {
        'student-1': { studentId: 'student-1', status: 'late', note: 'รถติด' },
        'student-2': { studentId: 'student-2', status: 'absent', note: null },
      },
    }

    const records = buildRecordsForRoster(activeIds, attendance)
    const finalRoster = deriveAttendanceRoster(roster, records)

    expect(finalRoster).toHaveLength(5)
    expect(records['student-1']).toEqual({ studentId: 'student-1', status: 'late', note: 'รถติด' })
    expect(records['student-2']).toEqual({ studentId: 'student-2', status: 'absent', note: null })
    // Students with no saved record still default to present.
    expect(records['student-3'].status).toBe('present')
  })

  it('classroom switch: two different rosters/sessions never leak into each other', () => {
    const classroomA = makeRoster(3)
    const classroomB = [{ id: 'student-x', status: 'active' as const }]

    const recordsA = buildRecordsForRoster(
      classroomA.map((s) => s.id),
      { session: null, records: {} },
    )
    const recordsB = buildRecordsForRoster(
      classroomB.map((s) => s.id),
      { session: null, records: { 'student-x': { studentId: 'student-x', status: 'leave', note: 'ลากิจ' } } },
    )

    expect(Object.keys(recordsA)).toEqual(['student-1', 'student-2', 'student-3'])
    expect(recordsB).toEqual({ 'student-x': { studentId: 'student-x', status: 'leave', note: 'ลากิจ' } })
  })

  it('date switch: a session found on one date must not leak into a different date\'s (unsaved) view', () => {
    const roster = makeRoster(2)
    const activeIds = roster.map((s) => s.id)

    const savedDayRecords = buildRecordsForRoster(activeIds, {
      session: null,
      records: { 'student-1': { studentId: 'student-1', status: 'absent', note: null } },
    })
    // Switching to a different date with no saved session for it — the
    // real page re-derives this from scratch (buildRecordsForRoster with
    // attendance: {session: null, records: {}} again), never reusing the
    // previous date's records object.
    const newDayRecords = buildRecordsForRoster(activeIds, { session: null, records: {} })

    expect(savedDayRecords['student-1'].status).toBe('absent')
    expect(newDayRecords['student-1'].status).toBe('present')
  })

  it('archived/moved student: an inactive student with a saved record is still shown and keeps their status', () => {
    const roster = [
      { id: 'student-1', status: 'active' as const },
      { id: 'student-2', status: 'inactive' as const }, // archived after the session was recorded
    ]
    // Only student-1 is "active" so only they get a default; student-2's
    // status comes purely from the saved record, same as the real page
    // (activeIds is derived from classroomStudents.filter(status==='active')).
    const attendance: AttendanceForDate = {
      session: null,
      records: { 'student-2': { studentId: 'student-2', status: 'leave', note: 'ลาออกกลางเทอม' } },
    }

    const records = buildRecordsForRoster(['student-1'], attendance)
    const finalRoster = deriveAttendanceRoster(roster, records)

    expect(finalRoster.map((s) => s.id)).toEqual(['student-1', 'student-2'])
    expect(records['student-1'].status).toBe('present')
    expect(records['student-2'].status).toBe('leave')
  })

  it('empty classroom (0 students) legitimately renders 0 — distinct from the bug (0 caused by a failed lookup)', () => {
    const records = buildRecordsForRoster([], { session: null, records: {} })
    const finalRoster = deriveAttendanceRoster([], records)

    expect(finalRoster).toHaveLength(0)
    expect(records).toEqual({})
  })
})
