import { describe, expect, it } from 'vitest'

import { TABS as REAL_TABS } from '@/pages/teacher/subjects/subject-classroom-workspace-page-real'
import { TABS as DEMO_TABS } from '@/pages/teacher/subjects/subject-classroom-workspace-page-demo'

describe('Subject-Classroom workspace tabs — Topics removed, ตรวจสอบงาน+คะแนน merged into ตรวจงานและคะแนน', () => {
  const expectedDemoKeys = ['overview', 'students', 'attendance', 'lessons', 'assignments', 'grades']
  const expectedRealKeys = ['overview', 'students', 'attendance', 'lessons', 'assignments', 'checkAndGrades']

  it('real workspace has no Topics ("หัวข้อ") tab', () => {
    expect(REAL_TABS.some((tab) => (tab.key as string) === 'topics')).toBe(false)
    expect(REAL_TABS.some((tab) => tab.label === 'หัวข้อ')).toBe(false)
  })

  it('demo workspace has no Topics ("หัวข้อ") tab', () => {
    expect(DEMO_TABS.some((tab) => (tab.key as string) === 'topics')).toBe(false)
    expect(DEMO_TABS.some((tab) => tab.label === 'หัวข้อ')).toBe(false)
  })

  it('real workspace is exactly ภาพรวม/นักเรียน/เช็กชื่อ/บทเรียน/งาน/ตรวจงานและคะแนน, in that order — ตรวจสอบงาน and คะแนน are no longer separate top-level tabs', () => {
    expect(REAL_TABS.map((tab) => tab.key)).toEqual(expectedRealKeys)
    expect(REAL_TABS.some((tab) => (tab.key as string) === 'submissionCheck')).toBe(false)
    expect(REAL_TABS.some((tab) => (tab.key as string) === 'grades')).toBe(false)
    const merged = REAL_TABS.find((tab) => tab.key === 'checkAndGrades')
    expect(merged?.label).toBe('ตรวจงานและคะแนน')
  })

  it('ตรวจงานและคะแนน sits directly after งาน — the same position ตรวจสอบงาน used to occupy, and is the last tab', () => {
    const keys = REAL_TABS.map((tab) => tab.key)
    expect(keys.indexOf('checkAndGrades')).toBe(keys.indexOf('assignments') + 1)
    expect(keys.indexOf('checkAndGrades')).toBe(keys.length - 1)
  })

  it('demo workspace still has its OWN standalone คะแนน tab — demo never had a ตรวจสอบงาน sibling to merge with (real-data-only feature), so nothing to merge there; every tab BEFORE the merged/grades one still matches real tab-for-tab', () => {
    expect(DEMO_TABS.map((tab) => tab.key)).toEqual(expectedDemoKeys)
    expect(DEMO_TABS.some((tab) => (tab.key as string) === 'checkAndGrades')).toBe(false)
    const realWithoutMergedTab = REAL_TABS.filter((tab) => tab.key !== 'checkAndGrades')
    const demoWithoutGrades = DEMO_TABS.filter((tab) => tab.key !== 'grades')
    expect(demoWithoutGrades.map((tab) => tab.key)).toEqual(realWithoutMergedTab.map((tab) => tab.key))
    expect(demoWithoutGrades.map((tab) => tab.label)).toEqual(realWithoutMergedTab.map((tab) => tab.label))
  })

  it('attendance is spelled "เช็กชื่อ" — the same spelling the Classroom Workspace tab uses, never "เช็คชื่อ"', () => {
    const attendanceTab = REAL_TABS.find((tab) => tab.key === 'attendance')
    expect(attendanceTab?.label).toBe('เช็กชื่อ')
  })
})
