import { describe, expect, it } from 'vitest'

import { GRADES_REDIRECT_MESSAGE, GRADES_REDIRECT_TARGET } from '@/pages/teacher/grades/grades-redirect-page'

describe('old /teacher/grades route — redirect copy and target', () => {
  it('tells the teacher to pick a subject and classroom first', () => {
    expect(GRADES_REDIRECT_MESSAGE).toBe('กรุณาเลือกรายวิชาและห้องเรียนก่อน')
  })

  it('points at the Subjects list — the real entry point for grades', () => {
    expect(GRADES_REDIRECT_TARGET).toBe('/teacher/subjects')
  })
})
