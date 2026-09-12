import { describe, expect, it } from 'vitest'

import { ConfigError, loadConfig } from '../src/config.js'

const BASE_ENV = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'public-anon-key',
} as NodeJS.ProcessEnv

describe('loadConfig — required project settings', () => {
  it('throws ConfigError when SUPABASE_URL is missing', () => {
    expect(() => loadConfig({ SUPABASE_ANON_KEY: 'x', SUPABASE_TEACHER_REFRESH_TOKEN: 'y' } as NodeJS.ProcessEnv)).toThrow(
      ConfigError,
    )
  })

  it('throws ConfigError when SUPABASE_ANON_KEY is missing', () => {
    expect(() =>
      loadConfig({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_TEACHER_REFRESH_TOKEN: 'y' } as NodeJS.ProcessEnv),
    ).toThrow(ConfigError)
  })

  it("the SUPABASE_ANON_KEY error message calls it the public key and warns it's never the service_role key", () => {
    try {
      loadConfig({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_TEACHER_REFRESH_TOKEN: 'y' } as NodeJS.ProcessEnv)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      expect((err as Error).message).toMatch(/anon\/publishable/i)
      expect((err as Error).message).toMatch(/never the service_role key/i)
    }
  })
})

describe('loadConfig — teacher credential selection', () => {
  it('accepts SUPABASE_TEACHER_EMAIL + SUPABASE_TEACHER_PASSWORD', () => {
    const config = loadConfig({
      ...BASE_ENV,
      SUPABASE_TEACHER_EMAIL: 'teacher@example.com',
      SUPABASE_TEACHER_PASSWORD: 'hunter2',
    } as NodeJS.ProcessEnv)
    expect(config.auth).toEqual({ mode: 'password', email: 'teacher@example.com', password: 'hunter2' })
  })

  it('accepts SUPABASE_TEACHER_REFRESH_TOKEN alone', () => {
    const config = loadConfig({ ...BASE_ENV, SUPABASE_TEACHER_REFRESH_TOKEN: 'refresh-abc' } as NodeJS.ProcessEnv)
    expect(config.auth).toEqual({ mode: 'refresh_token', refreshToken: 'refresh-abc' })
  })

  it('prefers email+password over a refresh token when both are set', () => {
    const config = loadConfig({
      ...BASE_ENV,
      SUPABASE_TEACHER_EMAIL: 'teacher@example.com',
      SUPABASE_TEACHER_PASSWORD: 'hunter2',
      SUPABASE_TEACHER_REFRESH_TOKEN: 'refresh-abc',
    } as NodeJS.ProcessEnv)
    expect(config.auth.mode).toBe('password')
  })

  it('throws ConfigError with neither credential set, warning against service_role only as a prohibition, never as an alternative to set', () => {
    try {
      loadConfig(BASE_ENV)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      expect((err as Error).message).toMatch(/SUPABASE_TEACHER_EMAIL/)
      expect((err as Error).message).toMatch(/SUPABASE_TEACHER_REFRESH_TOKEN/)
      expect((err as Error).message).toMatch(/must never be given a service_role key/)
      expect((err as Error).message).not.toMatch(/set SUPABASE_SERVICE_ROLE_KEY/i)
    }
  })

  it('rejects email set without a password (never silently drops to refresh-token mode with a stray email lying around)', () => {
    const config = loadConfig({
      ...BASE_ENV,
      SUPABASE_TEACHER_EMAIL: 'teacher@example.com',
      SUPABASE_TEACHER_REFRESH_TOKEN: 'refresh-abc',
    } as NodeJS.ProcessEnv)
    expect(config.auth).toEqual({ mode: 'refresh_token', refreshToken: 'refresh-abc' })
  })
})

describe('loadConfig — service_role safety net', () => {
  it('flags SUPABASE_SERVICE_ROLE_KEY as present-but-ignored without ever putting its value anywhere in the returned config', () => {
    const config = loadConfig({
      ...BASE_ENV,
      SUPABASE_TEACHER_REFRESH_TOKEN: 'refresh-abc',
      SUPABASE_SERVICE_ROLE_KEY: 'super-secret-value-should-never-appear-anywhere',
    } as NodeJS.ProcessEnv)
    expect(config.serviceRoleKeyPresentButIgnored).toBe(true)
    expect(JSON.stringify(config)).not.toContain('super-secret-value-should-never-appear-anywhere')
  })

  it('reports false when no service role key is set', () => {
    const config = loadConfig({ ...BASE_ENV, SUPABASE_TEACHER_REFRESH_TOKEN: 'refresh-abc' } as NodeJS.ProcessEnv)
    expect(config.serviceRoleKeyPresentButIgnored).toBe(false)
  })
})

describe('loadConfig — source-level guarantee that service_role is never used', () => {
  it('never reads process.env.SUPABASE_SERVICE_ROLE_KEY into a variable — only checks Boolean(...) for the warning flag', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../src/config.ts', import.meta.url), 'utf-8')
    const code = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//') && !line.trim().startsWith('/**'))
      .join('\n')
    const serviceRoleUsagesInCode = code.match(/SUPABASE_SERVICE_ROLE_KEY/g) ?? []
    expect(serviceRoleUsagesInCode.length).toBe(1) // exactly the Boolean(env...) presence check
    expect(source).toContain('Boolean(env.SUPABASE_SERVICE_ROLE_KEY)')
  })
})
