import { describe, expect, it } from 'vitest'

import { studentNavItems } from '@/components/layout/student-nav-items'

describe('studentNavItems — the student portal sidebar', () => {
  it('is exactly the four target destinations, in order — no standalone "งานของฉัน"', () => {
    expect(studentNavItems.map((item) => item.to)).toEqual([
      '/student/dashboard',
      '/student/subjects',
      '/student/attendance',
      '/student/grades',
    ])
    expect(studentNavItems.map((item) => item.label)).toEqual([
      'หน้าหลัก',
      'รายวิชาของฉัน',
      'การเข้าเรียน',
      'คะแนน',
    ])
  })

  it('never links to any /teacher/* destination', () => {
    expect(studentNavItems.every((item) => !item.to.startsWith('/teacher'))).toBe(true)
  })

  it('never duplicates assignment navigation — no /student/assignments entry', () => {
    expect(studentNavItems.some((item) => item.to === '/student/assignments')).toBe(false)
  })
})
