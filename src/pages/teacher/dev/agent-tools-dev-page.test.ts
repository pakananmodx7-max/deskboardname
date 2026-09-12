import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function readSource(): string {
  return readFileSync(new URL('./agent-tools-dev-page.tsx', import.meta.url), 'utf-8')
}

function readRouterSource(): string {
  return readFileSync(new URL('../../../app/router.tsx', import.meta.url), 'utf-8')
}

function readNavItemsSource(): string {
  return readFileSync(new URL('../../../components/layout/nav-items.ts', import.meta.url), 'utf-8')
}

describe('AgentToolsDevPage — read tools only, write tools never wired', () => {
  const source = readSource()

  it('calls callTeacherAgentTool with exactly the 5 approved read tool names, and no others', () => {
    const calls = [...source.matchAll(/callTeacherAgentTool[^(]*\(\s*'([a-z_]+)'/g)].map((m) => m[1])
    expect(new Set(calls)).toEqual(
      new Set(['list_classrooms', 'list_assignments', 'get_missing_submissions', 'get_classroom_summary', 'get_student_summary']),
    )
  })

  it('never references any write tool name as executable code — only in the doc comment explaining they are excluded', () => {
    const code = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//') && !line.trim().startsWith('/**'))
      .join('\n')
    expect(code).not.toMatch(/create_assignment|copy_assignment_to_classrooms|mark_attendance_bulk/)
  })
})

describe('AgentToolsDevPage — uses the existing authenticated session, never asks for a token', () => {
  const source = readSource()

  it('never renders, logs, or otherwise references an access token / JWT / Authorization header', () => {
    expect(source).not.toMatch(/access_token|Authorization|jwt/i)
    expect(source).not.toContain('console.log')
  })

  it('imports the client wrapper rather than calling supabase.functions.invoke directly (no duplicated auth/error handling)', () => {
    expect(source).toContain("from '@/services/teacher-agent-tools-client'")
    expect(source).not.toContain('.functions.invoke(')
  })

  it('degrades gracefully (no crash, no Supabase call attempted) when Supabase is not configured', () => {
    expect(source).toContain("dataMode === 'demo'")
  })
})

describe('AgentToolsDevPage — selecting IDs from prior results instead of only free-typing UUIDs', () => {
  const source = readSource()

  it('list_classrooms\' successful result seeds the classroom AND subject pickers used by every later tool', () => {
    const fn = source.slice(source.indexOf('async function runListClassrooms'), source.indexOf('async function runListAssignments'))
    expect(fn).toContain('setClassrooms(')
    expect(fn).toContain('setSubjects(')
  })

  it('list_assignments\' successful result seeds the assignment picker used by get_missing_submissions', () => {
    const fn = source.slice(source.indexOf('async function runListAssignments'), source.indexOf('async function runGetMissingSubmissions'))
    expect(fn).toContain('setAssignments(')
  })

  it('get_missing_submissions\' and get_classroom_summary\'s successful results both feed the student picker used by get_student_summary', () => {
    const missingFn = source.slice(
      source.indexOf('async function runGetMissingSubmissions'),
      source.indexOf('async function runGetClassroomSummary'),
    )
    const summaryFn = source.slice(
      source.indexOf('async function runGetClassroomSummary'),
      source.indexOf('async function runGetStudentSummary'),
    )
    expect(missingFn).toContain('setStudents(')
    expect(summaryFn).toContain('setStudents(')
  })

  it('every picker still allows a manually-typed UUID as a fallback (never select-only)', () => {
    const manualInputs = source.match(/หรือระบุ \w+ เอง/g) ?? []
    expect(manualInputs.length).toBeGreaterThanOrEqual(4)
  })
})

describe('AgentToolsDevPage — result display requirements', () => {
  const source = readSource()

  it('shows the tool name, the exact request args sent, the HTTP status, and the returned data or a safe error message', () => {
    expect(source).toContain('อาร์กิวเมนต์ที่ส่ง (request args)')
    expect(source).toContain('HTTP {run.result.httpStatus}')
    expect(source).toContain('ข้อมูลที่ได้รับ (data)')
    expect(source).toContain('run.result.error.message')
  })

  it('never dumps a raw thrown error/exception object — only the typed AgentToolResponse fields', () => {
    expect(source).not.toMatch(/\{String\(err\)\}|\{err\.stack\}|\{err\.toString/)
  })
})

describe('router.tsx — the dev panel is teacher-only and NOT on the production sidebar', () => {
  const routerSource = readRouterSource()
  const navItemsSource = readNavItemsSource()

  it('is mounted as a child route inside /teacher, i.e. behind the same ProtectedRoute + TeacherLayout as every real teacher page', () => {
    const teacherBlockStart = routerSource.indexOf("path: '/teacher'")
    const teacherBlockEnd = routerSource.indexOf("path: '*'")
    const teacherBlock = routerSource.slice(teacherBlockStart, teacherBlockEnd)
    expect(teacherBlock).toContain('<ProtectedRoute>')
    expect(teacherBlock).toContain("path: 'dev/agent-tools'")
    expect(teacherBlock).toContain('<AgentToolsDevPage />')
  })

  it('is never added to the sidebar nav-items list (kept out of everyday teacher navigation as a temporary diagnostic tool)', () => {
    expect(navItemsSource).not.toMatch(/agent-tools|AgentTools/i)
  })
})
