import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  CLASSROOM_GROUP_ID,
  flattenNavLinks,
  isGroupActive,
  isLinkActive,
  navItems,
  resolveGroupExpanded,
  type NavGroup,
  type NavLink,
} from '@/components/layout/nav-items'

const group = navItems[0] as NavGroup

describe('navItems — teacher sidebar hierarchy', () => {
  it('starts with the collapsible "ระบบจัดการชั้นเรียน" group holding the four classroom items, in order', () => {
    expect(group).toMatchObject({ type: 'group', id: CLASSROOM_GROUP_ID, label: 'ระบบจัดการชั้นเรียน' })
    expect(group.children.map((c) => [c.label, c.to])).toEqual([
      ['ภาพรวม', '/teacher/dashboard'],
      ['รายวิชา', '/teacher/subjects'],
      ['งานและสื่อการสอน', '/teacher/assignments'],
      ['รายงาน', '/teacher/reports'],
    ])
  })

  it('ระบบเอกสาร, Hermes Agent and ตั้งค่า stay outside the group, in this order', () => {
    const rest = navItems.slice(1)
    expect(rest.every((e) => e.type === 'link')).toBe(true)
    expect(rest.map((e) => (e.type === 'link' ? [e.label, e.to] : null))).toEqual([
      ['ระบบเอกสาร', '/teacher/documents'],
      ['Hermes Agent', '/teacher/hermes'],
      ['ตั้งค่า', '/teacher/settings'],
    ])
    expect((rest[0] as NavLink).badge).toBe('เร็ว ๆ นี้')
  })

  it('is exactly one group and nothing nested deeper', () => {
    expect(navItems.filter((e) => e.type === 'group')).toHaveLength(1)
    expect(navItems.some((e) => e.type === 'section')).toBe(false)
  })

  it('no duplicate destinations or labels anywhere (the group header is not a link)', () => {
    const flat = flattenNavLinks()
    expect(new Set(flat.map((l) => l.to)).size).toBe(flat.length)
    expect(new Set(flat.map((l) => l.label)).size).toBe(flat.length)
    expect(flat.map((l) => l.label)).not.toContain('ระบบจัดการชั้นเรียน')
    expect('to' in group).toBe(false)
  })

  it('retired or relocated destinations stay out of the sidebar (routes still exist)', () => {
    const targets = flattenNavLinks().map((l) => l.to)
    for (const path of ['/teacher/classroom-management', '/teacher/classrooms', '/teacher/integrations', '/teacher/student-link-requests', '/teacher/ai', '/teacher/students', '/teacher/grades', '/teacher/attendance']) {
      expect(targets).not.toContain(path)
    }
    expect(flattenNavLinks().map((l) => l.label)).not.toContain('ห้องเรียน')
    // Attendance is taken in each subject's เช็คชื่อ tab only.
    expect(flattenNavLinks().map((l) => l.label)).not.toContain('การเช็คชื่อ')
  })

  it('every sidebar destination is a route in the router', () => {
    const router = readFileSync(new URL('../../app/router.tsx', import.meta.url), 'utf-8')
    for (const link of flattenNavLinks()) {
      expect(router).toContain(`path: '${link.to.replace('/teacher/', '')}'`)
    }
  })
})

describe('active state', () => {
  const overview = group.children[0]

  it('ภาพรวม is active on the dashboard and on a classroom page', () => {
    expect(isLinkActive(overview, '/teacher/dashboard')).toBe(true)
    expect(isLinkActive(overview, '/teacher/classrooms/abc')).toBe(true)
    expect(isLinkActive(overview, '/teacher/subjects')).toBe(false)
  })

  it('a child is active on its own path and sub-paths only', () => {
    const subjects = group.children[1]
    expect(isLinkActive(subjects, '/teacher/subjects/s1/classrooms/c1')).toBe(true)
    expect(isLinkActive(subjects, '/teacher/subjects-other')).toBe(false)
  })

  it('the group is active on any child route (including activePrefixes), not elsewhere', () => {
    for (const path of ['/teacher/dashboard', '/teacher/classrooms/x', '/teacher/subjects/s1', '/teacher/assignments', '/teacher/reports']) {
      expect(isGroupActive(group, path)).toBe(true)
    }
    for (const path of ['/teacher/hermes', '/teacher/settings', '/teacher/documents']) {
      expect(isGroupActive(group, path)).toBe(false)
    }
  })
})

describe('resolveGroupExpanded — auto-expand + manual collapse', () => {
  it('opens when a child route is active even if the teacher had collapsed it on another page', () => {
    expect(resolveGroupExpanded({ active: true, userExpanded: false, collapsedOnPath: '/teacher/reports', pathname: '/teacher/subjects' })).toBe(true)
  })

  it('stays collapsed on the page where the teacher collapsed it', () => {
    expect(resolveGroupExpanded({ active: true, userExpanded: false, collapsedOnPath: '/teacher/subjects', pathname: '/teacher/subjects' })).toBe(false)
  })

  it('outside the group: follows the teacher\'s choice', () => {
    expect(resolveGroupExpanded({ active: false, userExpanded: true, collapsedOnPath: null, pathname: '/teacher/hermes' })).toBe(true)
    expect(resolveGroupExpanded({ active: false, userExpanded: false, collapsedOnPath: null, pathname: '/teacher/hermes' })).toBe(false)
  })
})

describe('sidebar component (source checks)', () => {
  const sidebar = readFileSync(new URL('./sidebar.tsx', import.meta.url), 'utf-8')

  it('the group header is a keyboard-operable toggle button with aria-expanded/aria-controls, never a link', () => {
    const row = sidebar.slice(sidebar.indexOf('function NavGroupRow'), sidebar.indexOf('function NavEntryRow'))
    expect(row).toContain('<button')
    expect(row).toContain('aria-expanded={expanded}')
    expect(row).toContain('aria-controls={listId}')
    expect(row).not.toMatch(/<Link|<NavLink/)
    expect(row).toContain('<ul id={listId}')
  })

  it('children keep the blue filled active pill; links show a keyboard focus ring', () => {
    expect(sidebar).toContain("const LINK_ACTIVE = 'bg-sidebar-active text-sidebar-active-foreground shadow-sm'")
    expect(sidebar).toContain('focus-visible:ring-2')
    expect(sidebar).toContain("aria-current={active ? 'page' : undefined}")
  })

  it('one sidebar component serves desktop, the tablet rail and the mobile drawer', () => {
    expect(sidebar.match(/export function Sidebar\(/g)).toHaveLength(1)
    expect(sidebar).toContain('<SidebarContent />')
    expect(sidebar).toContain('<CompactSidebarContent />')
    expect(sidebar).toContain('<SidebarContent onNavigate={onCloseMobile} />')
  })

  it('no Tailwind dark: variants (the theme switches via data-theme)', () => {
    expect(sidebar).not.toMatch(/\bdark:/)
  })
})
