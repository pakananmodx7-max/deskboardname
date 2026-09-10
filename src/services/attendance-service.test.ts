import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  buildDefaultRecords,
  buildRecordsForRoster,
  deriveAttendanceRoster,
  getAttendanceSummary,
  mergeLoadedAttendance,
  parsePeriodNumber,
  pickAttendanceSession,
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
 * still pending (see subjects-real/tabs/attendance-tab.tsx).
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

/**
 * getAllAttendanceForClassroom (Data Safety / Backup phase) — the one new
 * bulk read this phase added, used only by the teacher backup export. It
 * is a plain, unfiltered select scoped by classroom_id, relying entirely
 * on the pre-existing attendance_sessions_select_own /
 * attendance_records_select_own RLS policies (0004/0005 — unchanged) for
 * isolation, so there is nothing new to verify empirically beyond "it
 * asks Supabase for exactly this classroom's rows and shapes them
 * correctly" — a source-level guard confirms it never re-implements or
 * bypasses that scoping.
 */
/**
 * pickAttendanceSession (Attendance Production Fix phase) — Section 3's
 * "if multiple legacy sessions exist, do not silently crash; handle
 * deterministically and report the data issue" requirement. A true
 * duplicate is already provably impossible via any normal write path
 * (see supabase/tests/0004_attendance_roster_and_rls.sql PASS 5, which
 * proves the unique index rejects it) — this only has to handle the
 * legacy/anomalous-data case gracefully, never throw.
 */
describe('pickAttendanceSession — duplicate-session handling (Section 3)', () => {
  function row(id: string, updatedAt: string) {
    return { id, updatedAt }
  }

  it('returns null/0 for no matching rows (the common "nothing saved yet" case)', () => {
    expect(pickAttendanceSession([])).toEqual({ selected: null, duplicateCount: 0 })
  })

  it('returns the single row with duplicateCount 1 for the healthy, expected case', () => {
    const result = pickAttendanceSession([row('a', '2026-09-09T10:00:00Z')])
    expect(result).toEqual({ selected: row('a', '2026-09-09T10:00:00Z'), duplicateCount: 1 })
  })

  it('deterministically picks the most recently updated row when more than one matches, and reports the true count', () => {
    const rows = [row('old', '2026-09-01T00:00:00Z'), row('newest', '2026-09-09T12:00:00Z'), row('middle', '2026-09-05T00:00:00Z')]
    const result = pickAttendanceSession(rows)
    expect(result.selected?.id).toBe('newest')
    expect(result.duplicateCount).toBe(3)
  })

  it('never throws for any input size — degrades gracefully instead of crashing the attendance page', () => {
    expect(() => pickAttendanceSession([row('a', '2026-01-01T00:00:00Z'), row('b', '2026-01-01T00:00:00Z')])).not.toThrow()
  })
})

/**
 * mergeLoadedAttendance (Attendance Production Fix phase) — closes a real
 * production race: the roster becomes interactive as soon as it loads,
 * but the saved-session fetch (getAttendance) is a second, independent,
 * slower request. A teacher who starts marking statuses before that
 * second fetch resolves must never have their in-progress marks silently
 * discarded when it finally does resolve.
 */
describe('mergeLoadedAttendance — the delayed saved-session fetch must never clobber an in-progress edit (Section 5)', () => {
  const s1present: AttendanceRecord = { studentId: 's1', status: 'present', note: null }
  const s1absent: AttendanceRecord = { studentId: 's1', status: 'absent', note: null }
  const s2present: AttendanceRecord = { studentId: 's2', status: 'present', note: null }
  const s2late: AttendanceRecord = { studentId: 's2', status: 'late', note: 'สาย 10 นาที' }

  it('an untouched student gets the freshly-loaded value', () => {
    const merged = mergeLoadedAttendance({ s1: s1present }, { s1: s1absent }, new Set())
    expect(merged.s1).toEqual(s1absent)
  })

  it('a student the teacher already edited keeps their in-progress value, ignoring the freshly-loaded one', () => {
    // Teacher clicked "ขาด" for s1 while the saved-session fetch was still
    // in flight; that fetch then resolves with the OLD saved value
    // (present) — the teacher's click must win.
    const merged = mergeLoadedAttendance({ s1: s1absent }, { s1: s1present }, new Set(['s1']))
    expect(merged.s1).toEqual(s1absent)
  })

  it('mixed: one edited student keeps their edit, one untouched student gets the loaded value', () => {
    const merged = mergeLoadedAttendance({ s1: s1absent, s2: s2present }, { s1: s1present, s2: s2late }, new Set(['s1']))
    expect(merged.s1).toEqual(s1absent)
    expect(merged.s2).toEqual(s2late)
  })

  it('an edited id with no current record (should not normally happen) is safely skipped, never crashes', () => {
    const merged = mergeLoadedAttendance({}, { s1: s1present }, new Set(['s1', 'ghost-id']))
    expect(merged.s1).toEqual(s1present)
  })

  it('no edits at all: behaves exactly like using the loaded records directly', () => {
    const loaded = { s1: s1absent, s2: s2late }
    expect(mergeLoadedAttendance({ s1: s1present }, loaded, new Set())).toEqual(loaded)
  })
})

describe('getAllAttendanceForClassroom — source-level safety guard (Data Safety phase)', () => {
  const source = readFileSync(new URL('./attendance-service.ts', import.meta.url), 'utf-8')

  it('scopes every query by classroom_id / the already-fetched session ids — never a table-wide, unscoped read', () => {
    const fn = source.slice(
      source.indexOf('export async function getAllAttendanceForClassroom'),
      source.indexOf('export async function saveAttendance'),
    )
    expect(fn).toContain(".eq('classroom_id', classroomId)")
    expect(fn).toContain(".in(")
    expect(fn).toContain('attendance_session_id')
  })

  it('short-circuits to an empty result when the classroom has no sessions, without querying attendance_records at all', () => {
    const fn = source.slice(
      source.indexOf('export async function getAllAttendanceForClassroom'),
      source.indexOf('export async function saveAttendance'),
    )
    expect(fn).toContain('if (sessions.length === 0) return { sessions: [], records: [] }')
  })
})
