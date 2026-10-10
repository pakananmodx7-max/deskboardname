import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { CLASSROOM_LIST_PATH, ClassroomBreadcrumb } from './classroom-breadcrumb'

describe('ClassroomBreadcrumb — classroom page back to the dashboard list', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ClassroomBreadcrumb, { classroomName: 'ม.1/1' })))

  it('links ภาพรวม and ห้องเรียนของฉัน to the dashboard, never to the retired list page', () => {
    expect(CLASSROOM_LIST_PATH).toBe('/teacher/dashboard#classrooms')
    expect(html).toContain('href="/teacher/dashboard"')
    expect(html).toContain('href="/teacher/dashboard#classrooms"')
    expect(html).not.toContain('href="/teacher/classrooms"')
  })

  it('shows the current classroom as the last crumb', () => {
    expect(html).toContain('ภาพรวม')
    expect(html).toContain('ห้องเรียนของฉัน')
    expect(html).toMatch(/aria-current="page"[^>]*>ม\.1\/1</)
  })
})
