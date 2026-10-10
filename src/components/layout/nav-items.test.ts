import { describe, expect, it } from 'vitest'

import { flattenNavLinks, isGroupActive, isLinkActive, navItems, type NavGroup, type NavLink } from '@/components/layout/nav-items'

describe('navItems — unified teacher sidebar', () => {
  it('is one flat list with exactly these destinations, in this order', () => {
    expect(navItems.every((entry) => entry.type === 'link')).toBe(true)
    expect(navItems.map((entry) => (entry.type === 'link' ? [entry.label, entry.to] : null))).toEqual([
      ['ภาพรวม', '/teacher/dashboard'],
      ['รายวิชา', '/teacher/subjects'],
      ['งานและสื่อการสอน', '/teacher/assignments'],
      ['การเช็คชื่อ', '/teacher/attendance'],
      ['รายงาน', '/teacher/reports'],
      ['Hermes Agent', '/teacher/hermes'],
      ['ตั้งค่า', '/teacher/settings'],
    ])
  })

  it('has no standalone "ห้องเรียน" entry — ภาพรวม is the entry point for classroom management', () => {
    expect(flattenNavLinks().map((item) => item.label)).not.toContain('ห้องเรียน')
    expect(flattenNavLinks()[0]).toMatchObject({ label: 'ภาพรวม', to: '/teacher/dashboard' })
  })

  it('no longer links the retired overview/list pages — both live on the dashboard now', () => {
    const targets = flattenNavLinks().map((item) => item.to)
    expect(targets).not.toContain('/teacher/classroom-management')
    expect(targets).not.toContain('/teacher/classrooms')
  })

  it('relocated destinations stay out of the sidebar (still reachable by URL)', () => {
    const targets = flattenNavLinks().map((item) => item.to)
    for (const path of ['/teacher/integrations', '/teacher/student-link-requests', '/teacher/ai', '/teacher/students', '/teacher/grades']) {
      expect(targets).not.toContain(path)
    }
  })

  it('produces no duplicate `to` targets', () => {
    const targets = flattenNavLinks().map((item) => item.to)
    expect(new Set(targets).size).toBe(targets.length)
  })
})

describe('isLinkActive', () => {
  const overview = navItems[0] as NavLink
  const subjects = navItems[1] as NavLink

  it('ภาพรวม is active on the dashboard and on a classroom\'s own page (old bookmarks keep a highlighted home)', () => {
    expect(isLinkActive(overview, '/teacher/dashboard')).toBe(true)
    expect(isLinkActive(overview, '/teacher/classrooms/abc')).toBe(true)
    expect(isLinkActive(overview, '/teacher/subjects')).toBe(false)
  })

  it('a link is active on its own path and sub-paths only', () => {
    expect(isLinkActive(subjects, '/teacher/subjects/s1/classrooms/c1')).toBe(true)
    expect(isLinkActive(subjects, '/teacher/subjects-other')).toBe(false)
  })
})

describe('isGroupActive (kept for future grouped entries)', () => {
  const group: NavGroup = {
    type: 'group',
    label: 'กลุ่ม',
    to: '/teacher/x',
    icon: overviewIcon(),
    children: [{ type: 'link', label: 'ก', to: '/teacher/x/a', icon: overviewIcon() }],
  }

  it('matches a child path and its sub-paths, not unrelated paths', () => {
    expect(isGroupActive(group, '/teacher/x/a')).toBe(true)
    expect(isGroupActive(group, '/teacher/x/a/1')).toBe(true)
    expect(isGroupActive(group, '/teacher/hermes')).toBe(false)
  })
})

function overviewIcon() {
  return (navItems[0] as NavLink).icon
}
