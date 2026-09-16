import { describe, expect, it } from 'vitest'

import { TABS as REAL_TABS } from '@/pages/teacher/subjects/subject-classroom-workspace-page-real'
import { TABS as DEMO_TABS } from '@/pages/teacher/subjects/subject-classroom-workspace-page-demo'

describe('Subject-Classroom workspace tabs — Topics removed, ตรวจสอบงาน+คะแนน merged into ตรวจงานและคะแนน, งาน removed as a top-level real tab', () => {
  const expectedDemoKeys = ['overview', 'students', 'attendance', 'lessons', 'assignments', 'grades']
  const expectedRealKeys = ['overview', 'students', 'attendance', 'lessons', 'checkAndGrades']

  it('real workspace has no Topics ("หัวข้อ") tab', () => {
    expect(REAL_TABS.some((tab) => (tab.key as string) === 'topics')).toBe(false)
    expect(REAL_TABS.some((tab) => tab.label === 'หัวข้อ')).toBe(false)
  })

  it('demo workspace has no Topics ("หัวข้อ") tab', () => {
    expect(DEMO_TABS.some((tab) => (tab.key as string) === 'topics')).toBe(false)
    expect(DEMO_TABS.some((tab) => tab.label === 'หัวข้อ')).toBe(false)
  })

  it('real workspace is exactly ภาพรวม/นักเรียน/เช็กชื่อ/บทเรียน/ตรวจงานและคะแนน, in that order — งาน is no longer a top-level tab (assignments now live as matrix columns inside ตรวจงานและคะแนน), and ตรวจสอบงาน/คะแนน are no longer separate top-level tabs either', () => {
    expect(REAL_TABS.map((tab) => tab.key)).toEqual(expectedRealKeys)
    expect(REAL_TABS.some((tab) => (tab.key as string) === 'assignments')).toBe(false)
    expect(REAL_TABS.some((tab) => tab.label === 'งาน')).toBe(false)
    expect(REAL_TABS.some((tab) => (tab.key as string) === 'submissionCheck')).toBe(false)
    expect(REAL_TABS.some((tab) => (tab.key as string) === 'grades')).toBe(false)
    const merged = REAL_TABS.find((tab) => tab.key === 'checkAndGrades')
    expect(merged?.label).toBe('ตรวจงานและคะแนน')
  })

  it('ตรวจงานและคะแนน sits directly after บทเรียน and is the last tab', () => {
    const keys = REAL_TABS.map((tab) => tab.key)
    expect(keys.indexOf('checkAndGrades')).toBe(keys.indexOf('lessons') + 1)
    expect(keys.indexOf('checkAndGrades')).toBe(keys.length - 1)
  })

  it('demo workspace still has its OWN standalone งาน/คะแนน tabs — demo mode is intentionally untouched by the real-mode งาน consolidation (a real-data-only UX change); every tab common to both still matches key-for-key and label-for-label', () => {
    expect(DEMO_TABS.map((tab) => tab.key)).toEqual(expectedDemoKeys)
    expect(DEMO_TABS.some((tab) => (tab.key as string) === 'checkAndGrades')).toBe(false)
    const demoWithoutMergedAway = DEMO_TABS.filter((tab) => tab.key !== 'assignments' && tab.key !== 'grades')
    const realWithoutMergedTab = REAL_TABS.filter((tab) => tab.key !== 'checkAndGrades')
    expect(demoWithoutMergedAway.map((tab) => tab.key)).toEqual(realWithoutMergedTab.map((tab) => tab.key))
    expect(demoWithoutMergedAway.map((tab) => tab.label)).toEqual(realWithoutMergedTab.map((tab) => tab.label))
  })

  it('attendance is spelled "เช็กชื่อ" — the same spelling the Classroom Workspace tab uses, never "เช็คชื่อ"', () => {
    const attendanceTab = REAL_TABS.find((tab) => tab.key === 'attendance')
    expect(attendanceTab?.label).toBe('เช็กชื่อ')
  })
})
