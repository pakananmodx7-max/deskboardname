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
