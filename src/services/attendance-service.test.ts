import { describe, expect, it } from 'vitest'

import { buildDefaultRecords, getAttendanceSummary } from '@/services/attendance-service'
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
