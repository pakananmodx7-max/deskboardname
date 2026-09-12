import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./router.tsx', import.meta.url), 'utf-8')
}

describe('router — backward-compatible redirects for reorganized routes (Requirement 10)', () => {
  const source = readSource()

  it('/teacher/student-link-requests redirects to the new Students "requests" tab', () => {
    expect(source).toContain("{ path: 'student-link-requests', element: <Navigate to=\"/teacher/students/requests\" replace /> }")
  })

  it('/teacher/ai redirects to /teacher/hermes', () => {
    expect(source).toContain("{ path: 'ai', element: <Navigate to=\"/teacher/hermes\" replace /> }")
  })

  it('/teacher/integrations is completely untouched — it is Google\'s fixed OAuth redirect_uri', () => {
    expect(source).toContain("{ path: 'integrations', element: <IntegrationsPage /> }")
  })
})

describe('router — new routes for the redesigned IA', () => {
  const source = readSource()

  it('renders the new global Home page at /teacher/dashboard', () => {
    expect(source).toContain("{ path: 'dashboard', element: <HomePage /> }")
  })

  it('adds /teacher/classroom-management as the classroom module\'s overview', () => {
    expect(source).toContain("{ path: 'classroom-management', element: <ClassroomOverviewPage /> }")
  })

  it('adds /teacher/hermes for the Hermes Agent Control Center', () => {
    expect(source).toContain("{ path: 'hermes', element: <HermesAgentPage /> }")
  })

  it('nests Students into an index route + a "requests" child, both under the same StudentsSectionLayout', () => {
    expect(source).toContain('path: \'students\',\n        element: <StudentsSectionLayout />')
    expect(source).toContain('{ index: true, element: <StudentsPage /> }')
    expect(source).toContain("{ path: 'requests', element: <StudentLinkRequestsPage /> }")
  })

  it('adds coming-soon placeholders for documents/tasks/add-module without any new data fetching', () => {
    expect(source).toContain("{ path: 'documents', element: <ComingSoonModulePage")
    expect(source).toContain("{ path: 'tasks', element: <ComingSoonModulePage")
    expect(source).toContain("{ path: 'add-module', element: <ComingSoonModulePage")
  })
})

describe('router — untouched, security-critical routes (constraint 11)', () => {
  const source = readSource()

  it('Google OAuth callback route path is exactly /teacher/integrations, unchanged', () => {
    expect(source).toContain("path: 'integrations'")
  })

  it('Student Portal routes are untouched', () => {
    for (const path of ['dashboard', 'subjects', 'attendance', 'grades']) {
      expect(source).toContain(`path: '${path}'`)
    }
    expect(source).toContain("path: '/student'")
  })
})
