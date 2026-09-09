import { describe, expect, it } from 'vitest'

import { studentNavItems } from '@/components/layout/student-nav-items'

describe('studentNavItems — the student portal sidebar', () => {
  it('is exactly the five target destinations, in order', () => {
    expect(studentNavItems.map((item) => item.to)).toEqual([
      '/student/dashboard',
      '/student/subjects',
      '/student/assignments',
      '/student/attendance',
      '/student/grades',
    ])
    expect(studentNavItems.map((item) => item.label)).toEqual([
      'หน้าหลัก',
      'รายวิชาของฉัน',
      'งานของฉัน',
      'การเข้าเรียน',
      'คะแนน',
    ])
  })

  it('never links to any /teacher/* destination', () => {
    expect(studentNavItems.every((item) => !item.to.startsWith('/teacher'))).toBe(true)
  })
})
