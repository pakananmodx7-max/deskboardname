import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import type { BridgeConfig } from '../src/config.js'
import { TeacherAuthError, TeacherSession } from '../src/teacher-session.js'

function fakeSession(overrides: Partial<Session> = {}): Session {
  return {
    access_token: 'fake-access-token',
    refresh_token: 'fake-refresh-token',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: 'bearer',
    user: {} as Session['user'],
    ...overrides,
  }
}

function fakeClient(overrides: {
  signInWithPassword?: ReturnType<typeof vi.fn>
  refreshSession?: ReturnType<typeof vi.fn>
}): SupabaseClient {
  return {
    auth: {
      signInWithPassword: overrides.signInWithPassword ?? vi.fn(),
      refreshSession: overrides.refreshSession ?? vi.fn(),
    },
  } as unknown as SupabaseClient
}

const passwordConfig: BridgeConfig = {
  supabaseUrl: 'https://project.supabase.co',
  supabaseAnonKey: 'anon-key',
  auth: { mode: 'password', email: 'teacher@example.com', password: 'hunter2' },
  serviceRoleKeyPresentButIgnored: false,
}

const refreshTokenConfig: BridgeConfig = {
  supabaseUrl: 'https://project.supabase.co',
  supabaseAnonKey: 'anon-key',
  auth: { mode: 'refresh_token', refreshToken: 'seed-refresh-token' },
  serviceRoleKeyPresentButIgnored: false,
}

describe('TeacherSession — password mode', () => {
  it('signs in once and returns the access token', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ data: { session: fakeSession() }, error: null })
    const session = new TeacherSession(passwordConfig, fakeClient({ signInWithPassword }))

    const token = await session.ensureValidSession()

    expect(token).toBe('fake-access-token')
    expect(signInWithPassword).toHaveBeenCalledExactlyOnceWith({ email: 'teacher@example.com', password: 'hunter2' })
  })

  it('reuses the cached session on a second call instead of signing in again', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ data: { session: fakeSession() }, error: null })
    const session = new TeacherSession(passwordConfig, fakeClient({ signInWithPassword }))

    await session.ensureValidSession()
    await session.ensureValidSession()

    expect(signInWithPassword).toHaveBeenCalledTimes(1)
  })

  it('throws TeacherAuthError with a clear message, and the message never contains the password', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid login credentials' },
    })
    const session = new TeacherSession(passwordConfig, fakeClient({ signInWithPassword }))

    await expect(session.ensureValidSession()).rejects.toThrow(TeacherAuthError)
    try {
      await session.ensureValidSession()
      expect.unreachable()
    } catch (err) {
      expect((err as Error).message).not.toContain('hunter2')
      expect((err as Error).message).toMatch(/Invalid login credentials/)
    }
  })
})

describe('TeacherSession — refresh_token mode', () => {
  it('exchanges the seed refresh token for a session via refreshSession, never signInWithPassword', async () => {
    const refreshSession = vi.fn().mockResolvedValue({ data: { session: fakeSession() }, error: null })
    const signInWithPassword = vi.fn()
    const session = new TeacherSession(refreshTokenConfig, fakeClient({ refreshSession, signInWithPassword }))

    const token = await session.ensureValidSession()

    expect(token).toBe('fake-access-token')
    expect(refreshSession).toHaveBeenCalledExactlyOnceWith({ refresh_token: 'seed-refresh-token' })
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('throws TeacherAuthError when the refresh token is rejected, without leaking the token value', async () => {
    const refreshSession = vi.fn().mockResolvedValue({ data: { session: null }, error: { message: 'Invalid Refresh Token' } })
    const session = new TeacherSession(refreshTokenConfig, fakeClient({ refreshSession }))

    try {
      await session.ensureValidSession()
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(TeacherAuthError)
      expect((err as Error).message).not.toContain('seed-refresh-token')
    }
  })
})

describe('TeacherSession — expiry-aware refresh', () => {
  it('refreshes automatically when the cached session is about to expire', async () => {
    const almostExpired = fakeSession({ expires_at: Math.floor(Date.now() / 1000) + 10 })
    const refreshed = fakeSession({ access_token: 'refreshed-access-token' })
    const signInWithPassword = vi.fn().mockResolvedValue({ data: { session: almostExpired }, error: null })
    const refreshSession = vi.fn().mockResolvedValue({ data: { session: refreshed }, error: null })
    const session = new TeacherSession(passwordConfig, fakeClient({ signInWithPassword, refreshSession }))

    const first = await session.ensureValidSession()
    const second = await session.ensureValidSession()

    expect(first).toBe('fake-access-token')
    expect(second).toBe('refreshed-access-token')
    expect(refreshSession).toHaveBeenCalledExactlyOnceWith({ refresh_token: 'fake-refresh-token' })
  })

  it('falls back to a full re-authentication when refreshing the cached token itself fails', async () => {
    const almostExpired = fakeSession({ expires_at: Math.floor(Date.now() / 1000) + 10 })
    const reSignedIn = fakeSession({ access_token: 're-signed-in-access-token' })
    const signInWithPassword = vi
      .fn()
      .mockResolvedValueOnce({ data: { session: almostExpired }, error: null })
      .mockResolvedValueOnce({ data: { session: reSignedIn }, error: null })
    const refreshSession = vi.fn().mockResolvedValue({ data: { session: null }, error: { message: 'expired' } })
    const session = new TeacherSession(passwordConfig, fakeClient({ signInWithPassword, refreshSession }))

    await session.ensureValidSession()
    const token = await session.ensureValidSession()

    expect(token).toBe('re-signed-in-access-token')
    expect(signInWithPassword).toHaveBeenCalledTimes(2)
  })
})

describe('TeacherSession.reauthenticate — used by the client\'s 401 retry path', () => {
  it('forces a fresh token even when the cached one looks unexpired', async () => {
    const stillValid = fakeSession()
    const refreshed = fakeSession({ access_token: 'forced-refresh-token' })
    const signInWithPassword = vi.fn().mockResolvedValue({ data: { session: stillValid }, error: null })
    const refreshSession = vi.fn().mockResolvedValue({ data: { session: refreshed }, error: null })
    const session = new TeacherSession(passwordConfig, fakeClient({ signInWithPassword, refreshSession }))

    await session.ensureValidSession()
    const forced = await session.reauthenticate()

    expect(forced).toBe('forced-refresh-token')
  })
})
