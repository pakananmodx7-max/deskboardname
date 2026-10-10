import { readFileSync } from 'node:fs'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Teacher self-registration is closed (ENABLE_TEACHER_REGISTRATION=false):
 * the signUp path refuses teacher accounts before calling Supabase, while
 * students, sign-in and password recovery keep working. The real Supabase
 * client is replaced by a stub; nothing here talks to a server.
 */

const flags = vi.hoisted(() => ({ enabled: false }))
const client = vi.hoisted(() => ({
  auth: {
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
  },
}))

vi.mock('@/lib/data-mode', () => ({ dataMode: 'supabase' }))
vi.mock('@/lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase')>()),
  supabase: null,
  getSupabaseClient: () => client,
}))
vi.mock('@/lib/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/feature-flags')>()
  return {
    ...actual,
    get ENABLE_TEACHER_REGISTRATION() {
      return flags.enabled
    },
  }
})

const { AuthProvider, useAuth } = await import('@/lib/auth-context')
const { toFriendlyErrorMessage } = await import('@/lib/errors')
const actualFlags = await vi.importActual<typeof import('@/lib/feature-flags')>('@/lib/feature-flags')

function authApi() {
  const seen: ReturnType<typeof useAuth>[] = []
  function Probe() {
    seen.push(useAuth())
    return null
  }
  renderToStaticMarkup(createElement(AuthProvider, null, createElement(Probe)))
  return seen[seen.length - 1]
}

beforeEach(() => {
  flags.enabled = false
  client.auth.signUp.mockResolvedValue({ data: { session: null, user: { id: 'u' } }, error: null })
  client.auth.signInWithPassword.mockResolvedValue({ error: null })
  client.auth.resetPasswordForEmail.mockResolvedValue({ error: null })
  vi.stubGlobal('window', { location: { origin: 'https://app.example' } })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('feature flag', () => {
  it('ENABLE_TEACHER_REGISTRATION is off unless explicitly enabled', () => {
    expect(actualFlags.ENABLE_TEACHER_REGISTRATION).toBe(false)
  })

  it('parses env values leniently and falls back for unknown values', () => {
    const { parseBooleanFlag } = actualFlags
    expect(parseBooleanFlag(undefined, false)).toBe(false)
    expect(parseBooleanFlag('', false)).toBe(false)
    expect(parseBooleanFlag(' TRUE ', false)).toBe(true)
    expect(parseBooleanFlag('1', false)).toBe(true)
    expect(parseBooleanFlag('off', true)).toBe(false)
    expect(parseBooleanFlag('maybe', false)).toBe(false)
  })
})

describe('auth flows while teacher registration is closed', () => {
  it('a teacher sign-up is refused before any request is sent', async () => {
    await expect(authApi().signUp({ email: 't@x', password: 'secret1', displayName: 'ครู' })).rejects.toThrow('ปิดรับสมัครบัญชีครูชั่วคราว')
    expect(client.auth.signUp).not.toHaveBeenCalled()
  })

  it('the refusal shows as a Thai message', async () => {
    const error = await authApi()
      .signUp({ email: 't@x', password: 'secret1', displayName: 'ครู' })
      .catch((e: unknown) => e)
    expect(toFriendlyErrorMessage(error)).toContain('ปิดรับสมัครบัญชีครูชั่วคราว')
  })

  it('student registration still works (sent with intended_role=student)', async () => {
    await authApi().signUp({ email: 's@x', password: 'secret1', displayName: 'นักเรียน', intendedRole: 'student' })
    expect(client.auth.signUp).toHaveBeenCalledWith({
      email: 's@x',
      password: 'secret1',
      options: { data: { display_name: 'นักเรียน', intended_role: 'student' } },
    })
  })

  it('existing teachers can still sign in', async () => {
    await authApi().signIn('teacher@x', 'secret1')
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'teacher@x', password: 'secret1' })
  })

  it('password recovery still works', async () => {
    await authApi().sendPasswordReset('teacher@x')
    expect(client.auth.resetPasswordForEmail).toHaveBeenCalledWith('teacher@x', { redirectTo: 'https://app.example/reset-password' })
  })

  it('when the flag is turned on again, teacher sign-up goes through unchanged', async () => {
    flags.enabled = true
    await authApi().signUp({ email: 't@x', password: 'secret1', displayName: 'ครู' })
    expect(client.auth.signUp).toHaveBeenCalledWith({ email: 't@x', password: 'secret1', options: { data: { display_name: 'ครู' } } })
  })

  it('a server-side refusal (database trigger) maps to a Thai message', () => {
    expect(toFriendlyErrorMessage({ name: 'AuthApiError', message: 'Database error saving new user' })).toContain('ไม่สามารถสร้างบัญชีได้ในขณะนี้')
  })
})

describe('server-side enforcement (migration 0028, source checks)', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/0028_teacher_registration_flag.sql', import.meta.url), 'utf-8')
  const code = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')

  it('seeds the flag as disabled without overwriting a later value', () => {
    expect(code).toContain(`values ('enable_teacher_registration', 'false'::jsonb)`)
    expect(code).toContain('on conflict (key) do nothing')
  })

  it('clients can neither read nor change the flag', () => {
    expect(code).toContain('alter table public.app_settings enable row level security')
    expect(code).toContain('revoke all on table public.app_settings from anon, authenticated')
    expect(code).not.toMatch(/create policy/i)
    expect(code).toContain('revoke all on function public.is_teacher_registration_enabled() from public, anon, authenticated')
  })

  it('the sign-up trigger refuses teacher accounts while closed; students are unaffected', () => {
    expect(code).toContain("if new.raw_user_meta_data ->> 'intended_role' = 'student' then")
    expect(code).toMatch(/if v_role = 'teacher'\s+and not public\.is_teacher_registration_enabled\(\)/)
    expect(code).toContain('raise exception')
  })

  it('the administrator exemption reads app_metadata only (never user-supplied metadata)', () => {
    expect(code).toContain("new.raw_app_meta_data ->> 'krunameclass_allow_teacher'")
    expect(code).not.toContain("raw_user_meta_data ->> 'krunameclass_allow_teacher'")
  })

  it('fails closed and never modifies existing users, profiles or policies', () => {
    expect(code).toContain('return coalesce(')
    expect(code).not.toMatch(/\b(delete from|truncate|drop table|drop policy|alter policy)\b/i)
    expect(code).not.toMatch(/update\s+(public\.)?profiles|update\s+auth\./i)
  })
})
