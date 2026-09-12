import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { scrubPossibleTokens } from './teacher-agent-tools-client'

function readSource(): string {
  return readFileSync(new URL('./teacher-agent-tools-client.ts', import.meta.url), 'utf-8')
}

// ==================================================
// scrubPossibleTokens is pure string logic with no Supabase call inside
// it, so — unlike callTeacherAgentTool itself, which this file covers
// with source-text guards below (the established pattern for anything
// that talks to Supabase in this codebase, see google-drive-service.test.ts) —
// it is actually imported and run here for real coverage.
// ==================================================

describe('scrubPossibleTokens', () => {
  it('redacts a JWT-shaped string (three dot-separated base64url segments starting with eyJ)', () => {
    const fakeJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dGhpc2lzbm90YXJlYWxzaWduYXR1cmU'
    expect(scrubPossibleTokens(`Bearer ${fakeJwt}`)).toBe('Bearer [redacted]')
    expect(scrubPossibleTokens(fakeJwt)).not.toContain('eyJ')
  })

  it('leaves ordinary error text completely untouched', () => {
    expect(scrubPossibleTokens('ไม่พบห้องเรียนนี้ หรือคุณไม่มีสิทธิ์เข้าถึง')).toBe(
      'ไม่พบห้องเรียนนี้ หรือคุณไม่มีสิทธิ์เข้าถึง',
    )
  })

  it('redacts every token-shaped occurrence, not just the first', () => {
    const fakeJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dGhpc2lzbm90YXJlYWxzaWduYXR1cmU'
    const text = `${fakeJwt} and again ${fakeJwt}`
    const scrubbed = scrubPossibleTokens(text)
    expect(scrubbed).not.toContain('eyJ')
    expect(scrubbed.match(/\[redacted\]/g)?.length).toBe(2)
  })
})

// ==================================================
// callTeacherAgentTool talks to the deployed Edge Function through the
// real Supabase client — a source-text guard, matching this codebase's
// existing convention for every function that does so.
// ==================================================

describe('callTeacherAgentTool — auth via the existing session, never a manually-supplied token', () => {
  const source = readSource()

  it('invokes the deployed teacher-agent-tools function through supabase.functions.invoke — the SAME mechanism (session access token attached automatically) as every Google Drive Edge Function call', () => {
    expect(source).toContain("const FUNCTION_NAME = 'teacher-agent-tools'")
    expect(source).toContain('supabase.functions.invoke(FUNCTION_NAME, { body: { tool, args } })')
  })

  it('never reads, constructs, or forwards an Authorization header itself — no manual token handling anywhere in this file (comments aside, only supabase.functions.invoke\'s automatic attachment is ever mentioned)', () => {
    const code = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//') && !line.trim().startsWith('/**'))
      .join('\n')
    expect(code).not.toMatch(/Authorization/i)
    expect(code).not.toMatch(/access_token/i)
    expect(code).not.toMatch(/\.session\b/)
  })

  it('never throws out of callTeacherAgentTool — every path (network failure, HTTP error, success) resolves to a plain AgentToolResponse value', () => {
    const fnBody = source.slice(
      source.indexOf('export async function callTeacherAgentTool'),
      source.lastIndexOf('}'),
    )
    expect(fnBody).toContain('try {')
    expect(fnBody).toContain('} catch (err) {')
  })

  it('scrubs every error message it surfaces through scrubPossibleTokens before returning it', () => {
    const fnBody = source.slice(source.indexOf('export async function callTeacherAgentTool'))
    const scrubCalls = fnBody.match(/scrubPossibleTokens\(/g) ?? []
    expect(scrubCalls.length).toBeGreaterThanOrEqual(3)
  })

  it('surfaces the HTTP status alongside every result (success is always 200; failure reads it from the error Response)', () => {
    expect(source).toContain('httpStatus: 200')
    expect(source).toContain('const httpStatus = context?.status ?? null')
  })

  it('never imports or references the service-role key / admin client — this is browser code, it has no access to it', () => {
    expect(source).not.toMatch(/service[_-]?role/i)
    expect(source).not.toMatch(/createAdminClient/)
  })
})
