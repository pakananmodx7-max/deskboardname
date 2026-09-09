import { describe, expect, it } from 'vitest'

import { TABS as REAL_TABS } from '@/pages/teacher/subjects/subject-classroom-workspace-page-real'
import { TABS as DEMO_TABS } from '@/pages/teacher/subjects/subject-classroom-workspace-page-demo'

describe('Subject-Classroom workspace tabs — Topics removed, real and demo in sync', () => {
  const expectedKeys = ['overview', 'students', 'attendance', 'lessons', 'assignments', 'grades']

  it('real workspace has no Topics ("หัวข้อ") tab', () => {
    expect(REAL_TABS.some((tab) => (tab.key as string) === 'topics')).toBe(false)
    expect(REAL_TABS.some((tab) => tab.label === 'หัวข้อ')).toBe(false)
  })

  it('demo workspace has no Topics ("หัวข้อ") tab', () => {
    expect(DEMO_TABS.some((tab) => (tab.key as string) === 'topics')).toBe(false)
    expect(DEMO_TABS.some((tab) => tab.label === 'หัวข้อ')).toBe(false)
  })

  it('real workspace is exactly ภาพรวม/นักเรียน/เช็คชื่อ/งาน/คะแนน, in that order', () => {
    expect(REAL_TABS.map((tab) => tab.key)).toEqual(expectedKeys)
  })

  it('demo workspace matches the real workspace’s tab set exactly', () => {
    expect(DEMO_TABS.map((tab) => tab.key)).toEqual(REAL_TABS.map((tab) => tab.key))
    expect(DEMO_TABS.map((tab) => tab.label)).toEqual(REAL_TABS.map((tab) => tab.label))
  })
})
