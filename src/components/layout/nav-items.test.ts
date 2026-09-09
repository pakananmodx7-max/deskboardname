import { describe, expect, it } from 'vitest'

import { navItems } from '@/components/layout/nav-items'

describe('navItems — no global Assignments destination', () => {
  it('has no entry pointing at the old classroom-less /teacher/assignments route', () => {
    expect(navItems.some((item) => item.to === '/teacher/assignments')).toBe(false)
  })

  it('has no entry labeled "Assignments"', () => {
    expect(navItems.some((item) => item.label.toLowerCase() === 'assignments')).toBe(false)
  })

  it('still links to Subjects — the actual entry point for managing assignments', () => {
    expect(navItems.some((item) => item.to === '/teacher/subjects')).toBe(true)
  })
})

describe('navItems — no global Grades destination', () => {
  it('has no entry pointing at the old classroom-less /teacher/grades route', () => {
    expect(navItems.some((item) => item.to === '/teacher/grades')).toBe(false)
  })

  it('has no entry labeled "Grades"', () => {
    expect(navItems.some((item) => item.label.toLowerCase() === 'grades')).toBe(false)
  })
})

describe('navItems — no global Attendance destination', () => {
  it('has no entry pointing at the old classroom-less /teacher/attendance route', () => {
    expect(navItems.some((item) => item.to === '/teacher/attendance')).toBe(false)
  })

  it('has no entry labeled "Attendance"', () => {
    expect(navItems.some((item) => item.label.toLowerCase() === 'attendance')).toBe(false)
  })
})

describe('navItems — student link requests entry', () => {
  it('links to the teacher-side student-link-requests review page', () => {
    expect(navItems.some((item) => item.to === '/teacher/student-link-requests')).toBe(true)
  })
})

describe('navItems — the full consolidated sidebar, in order', () => {
  it('contains exactly the nine target destinations, nothing more, nothing less', () => {
    expect(navItems.map((item) => item.to)).toEqual([
      '/teacher/dashboard',
      '/teacher/classrooms',
      '/teacher/students',
      '/teacher/subjects',
      '/teacher/student-link-requests',
      '/teacher/reports',
      '/teacher/ai',
      '/teacher/integrations',
      '/teacher/settings',
    ])
  })
})
