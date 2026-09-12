import { describe, expect, it } from 'vitest'

import { flattenNavLinks, isGroupActive, navItems, type NavGroup } from '@/components/layout/nav-items'

const classroomManagementGroup = navItems
  .flatMap((entry) => (entry.type === 'section' ? entry.entries : [entry]))
  .find((entry): entry is NavGroup => entry.type === 'group' && entry.to === '/teacher/classroom-management')

describe('navItems — top-level structure', () => {
  it('starts with หน้าหลัก pointing at the dashboard', () => {
    expect(navItems[0]).toMatchObject({ type: 'link', label: 'หน้าหลัก', to: '/teacher/dashboard' })
  })

  it('has exactly one "ระบบของฉัน" section', () => {
    const sections = navItems.filter((entry) => entry.type === 'section')
    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({ label: 'ระบบของฉัน' })
  })

  it('has Hermes Agent as a TOP-LEVEL link, not nested inside any section or group', () => {
    const hermes = navItems.find((entry) => entry.type === 'link' && entry.to === '/teacher/hermes')
    expect(hermes).toBeTruthy()
  })

  it('ends with ตั้งค่า as the final top-level entry', () => {
    const last = navItems[navItems.length - 1]
    expect(last).toMatchObject({ type: 'link', label: 'ตั้งค่า', to: '/teacher/settings' })
  })

  it('has no other top-level sections or groups besides "ระบบของฉัน"', () => {
    const nonLinkTopLevel = navItems.filter((entry) => entry.type !== 'link')
    expect(nonLinkTopLevel).toHaveLength(1)
    expect(nonLinkTopLevel[0].type).toBe('section')
  })
})

describe('navItems — "ระบบของฉัน" section contents', () => {
  const section = navItems.find((entry) => entry.type === 'section')
  if (!section || section.type !== 'section') throw new Error('section not found')

  it('contains the ระบบจัดการชั้นเรียน group, ระบบเอกสาร, งานและเตือนความจำ, and เพิ่มระบบใหม่, in order', () => {
    expect(section.entries.map((entry) => entry.to)).toEqual([
      '/teacher/classroom-management',
      '/teacher/documents',
      '/teacher/tasks',
      '/teacher/add-module',
    ])
  })

  it('marks ระบบเอกสาร and งานและเตือนความจำ as not-yet-built with a badge', () => {
    const documents = section.entries.find((entry) => entry.to === '/teacher/documents')
    const tasks = section.entries.find((entry) => entry.to === '/teacher/tasks')
    expect(documents).toMatchObject({ badge: expect.any(String) })
    expect(tasks).toMatchObject({ badge: expect.any(String) })
  })

  it('เพิ่มระบบใหม่ has no "coming soon" badge — it is a real, working placeholder page', () => {
    const addModule = section.entries.find((entry) => entry.to === '/teacher/add-module')
    expect(addModule && 'badge' in addModule ? addModule.badge : undefined).toBeUndefined()
  })
})

describe('navItems — ระบบจัดการชั้นเรียน (Classroom Management) module', () => {
  it('exists as a collapsible group inside "ระบบของฉัน"', () => {
    expect(classroomManagementGroup).toBeTruthy()
  })

  it('contains exactly these 4 children, in this order', () => {
    expect(classroomManagementGroup?.children.map((child) => child.to)).toEqual([
      '/teacher/classroom-management',
      '/teacher/classrooms',
      '/teacher/subjects',
      '/teacher/reports',
    ])
  })

  it('labels match the required Thai copy', () => {
    expect(classroomManagementGroup?.children.map((child) => child.label)).toEqual([
      'ภาพรวม',
      'ห้องเรียน',
      'รายวิชา',
      'รายงาน',
    ])
  })

  it('no longer has its own sidebar entries for นักเรียน/งานและการบ้าน/เช็กชื่อ/คะแนนและการประเมิน — moved into each Classroom Workspace\'s tabs instead', () => {
    const labels = classroomManagementGroup?.children.map((child) => child.label) ?? []
    for (const removedLabel of ['นักเรียน', 'งานและการบ้าน', 'เช็กชื่อ', 'คะแนนและการประเมิน']) {
      expect(labels).not.toContain(removedLabel)
    }
  })
})

describe('navItems — removed/relocated destinations no longer appear as standalone sidebar entries', () => {
  const flat = flattenNavLinks()

  it('no standalone Integrations entry (Google Drive moved into the Subject detail page)', () => {
    expect(flat.some((item) => item.to === '/teacher/integrations')).toBe(false)
  })

  it('no standalone "คำขอเชื่อมบัญชีนักเรียน" entry (moved into the Students page as a tab)', () => {
    expect(flat.some((item) => item.to === '/teacher/student-link-requests')).toBe(false)
    expect(flat.some((item) => item.label.includes('คำขอเชื่อมบัญชี'))).toBe(false)
  })

  it('no standalone AI Assistant entry (superseded by Hermes Agent)', () => {
    expect(flat.some((item) => item.to === '/teacher/ai')).toBe(false)
  })

  it('no top-level Assignments/Attendance/Grades entry — each lives only inside the classroom module', () => {
    const topLevelLinks = navItems.filter((entry) => entry.type === 'link')
    for (const path of ['/teacher/assignments', '/teacher/attendance', '/teacher/grades']) {
      expect(topLevelLinks.some((item) => item.to === path)).toBe(false)
    }
  })

  it('no sidebar entry anywhere for นักเรียน/งานและการบ้าน/เช็กชื่อ/คะแนนและการประเมิน — each moved into each Classroom Workspace\'s own tabs, not deleted', () => {
    expect(flat.some((item) => item.to === '/teacher/students')).toBe(false)
    expect(flat.some((item) => item.to === '/teacher/assignments')).toBe(false)
    expect(flat.some((item) => item.to === '/teacher/attendance')).toBe(false)
    expect(flat.some((item) => item.to === '/teacher/grades')).toBe(false)
  })
})

describe('flattenNavLinks — every real destination is reachable exactly once', () => {
  it('includes the classroom module children plus every other real link', () => {
    const flat = flattenNavLinks()
    expect(flat.some((item) => item.to === '/teacher/hermes')).toBe(true)
    expect(flat.some((item) => item.to === '/teacher/settings')).toBe(true)
    expect(flat.some((item) => item.to === '/teacher/dashboard')).toBe(true)
    expect(flat.some((item) => item.to === '/teacher/classrooms')).toBe(true)
  })

  it('produces no duplicate `to` targets', () => {
    const flat = flattenNavLinks()
    const targets = flat.map((item) => item.to)
    expect(new Set(targets).size).toBe(targets.length)
  })
})

describe('isGroupActive', () => {
  it('is true for the group\'s own overview path and any child path', () => {
    if (!classroomManagementGroup) throw new Error('group not found')
    expect(isGroupActive(classroomManagementGroup, '/teacher/classrooms')).toBe(true)
    expect(isGroupActive(classroomManagementGroup, '/teacher/reports')).toBe(true)
  })

  it('is true for a sub-path of a child (e.g. a bookmarked deep link)', () => {
    if (!classroomManagementGroup) throw new Error('group not found')
    expect(isGroupActive(classroomManagementGroup, '/teacher/classrooms/some-id')).toBe(true)
  })

  it('is false for an unrelated path', () => {
    if (!classroomManagementGroup) throw new Error('group not found')
    expect(isGroupActive(classroomManagementGroup, '/teacher/hermes')).toBe(false)
    expect(isGroupActive(classroomManagementGroup, '/teacher/students')).toBe(false)
  })
})
