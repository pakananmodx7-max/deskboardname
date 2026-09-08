import { describe, expect, it } from 'vitest'

import {
  ASSIGNMENTS_REDIRECT_MESSAGE,
  ASSIGNMENTS_REDIRECT_TARGET,
} from '@/pages/teacher/assignments/assignments-redirect-page'

describe('old /teacher/assignments route — redirect copy and target', () => {
  it('tells the teacher to pick a subject and classroom first', () => {
    expect(ASSIGNMENTS_REDIRECT_MESSAGE).toBe('กรุณาเลือกรายวิชาและห้องเรียนก่อน')
  })

  it('points at the Subjects list — the real entry point for assignments', () => {
    expect(ASSIGNMENTS_REDIRECT_TARGET).toBe('/teacher/subjects')
  })
})
