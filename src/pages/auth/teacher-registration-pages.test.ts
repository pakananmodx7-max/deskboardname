import { readFileSync } from 'node:fs'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const flags = vi.hoisted(() => ({ enabled: false }))

vi.mock('@/lib/data-mode', () => ({ dataMode: 'supabase' }))
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: null, signIn: vi.fn(), signUp: vi.fn() }) }))
vi.mock('@/lib/feature-flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/feature-flags')>()),
  get ENABLE_TEACHER_REGISTRATION() {
    return flags.enabled
  },
}))

const { LoginPage } = await import('./login-page')
const { SignupPage } = await import('./signup-page')
const { StudentLoginPage } = await import('../student/login-page')

function render(component: () => unknown): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(component as never)))
}

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf-8')
}

beforeEach(() => {
  flags.enabled = false
})

describe('teacher login page while registration is closed', () => {
  it('has no "สมัครใช้งาน" link or /signup link; explains how to get an account', () => {
    const html = render(LoginPage)
    expect(html).not.toContain('href="/signup"')
    expect(html).not.toContain('สมัครใช้งาน')
    expect(html).toContain('ปิดรับสมัครบัญชีครูชั่วคราว')
  })

  it('keeps login, password recovery and the student entry point', () => {
    const html = render(LoginPage)
    expect(html).toContain('type="password"')
    expect(html).toContain('href="/forgot-password"')
    expect(html).toContain('href="/student/login"')
  })

  it('shows the sign-up link again when the flag is enabled', () => {
    flags.enabled = true
    expect(render(LoginPage)).toContain('href="/signup"')
  })
})

describe('teacher sign-up page', () => {
  it('renders no sign-up form while closed (it redirects to /login)', () => {
    expect(render(SignupPage)).not.toContain('<form')
    expect(readSource('./signup-page.tsx')).toMatch(/if \(!ENABLE_TEACHER_REGISTRATION\) \{\s+return <Navigate to="\/login" replace \/>/)
  })

  it('renders the form when the flag is enabled', () => {
    flags.enabled = true
    expect(render(SignupPage)).toContain('<form')
  })

  it('a direct visit to /signup redirects to the teacher login page', () => {
    expect(readSource('../../app/router.tsx')).toContain(
      `{ path: 'signup', element: ENABLE_TEACHER_REGISTRATION ? <SignupPage /> : <Navigate to="/login" replace /> }`,
    )
  })
})

describe('student registration is untouched', () => {
  it('the student login page still links to student sign-up', () => {
    const html = render(StudentLoginPage)
    expect(html).toContain('href="/student/signup"')
    expect(html).toContain('สมัครใช้งาน')
  })

  it('the student sign-up route and page do not depend on the teacher flag', () => {
    expect(readSource('../../app/router.tsx')).toContain("{ path: 'student/signup', element: <StudentSignupPage /> }")
    expect(readSource('../student/signup-page.tsx')).not.toContain('ENABLE_TEACHER_REGISTRATION')
  })
})
