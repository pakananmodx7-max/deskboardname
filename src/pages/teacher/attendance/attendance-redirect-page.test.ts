import { describe, expect, it } from 'vitest'

import {
  ATTENDANCE_REDIRECT_MESSAGE,
  ATTENDANCE_REDIRECT_TARGET,
} from '@/pages/teacher/attendance/attendance-redirect-page'

describe('old /teacher/attendance route — redirect copy and target', () => {
  it('tells the teacher to pick a subject and classroom first', () => {
    expect(ATTENDANCE_REDIRECT_MESSAGE).toBe('กรุณาเลือกรายวิชาและห้องเรียนก่อน')
  })

  it('points at the Subjects list — the real entry point for attendance', () => {
    expect(ATTENDANCE_REDIRECT_TARGET).toBe('/teacher/subjects')
  })
})
