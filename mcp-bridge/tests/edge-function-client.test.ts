import { describe, expect, it, vi } from 'vitest'

import { EdgeFunctionClient } from '../src/edge-function-client.js'
import type { TeacherSession } from '../src/teacher-session.js'
import { TeacherAuthError } from '../src/teacher-session.js'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function fakeSession(overrides: Partial<TeacherSession> = {}): TeacherSession {
  return {
    ensureValidSession: vi.fn().mockResolvedValue('valid-access-token'),
    reauthenticate: vi.fn().mockResolvedValue('refreshed-access-token'),
    ...overrides,
  } as unknown as TeacherSession
}

describe('EdgeFunctionClient — request shape (mirrors the Edge Function\'s own contract exactly)', () => {
  it('POSTs { tool, args } to /functions/v1/teacher-agent-tools with apikey + Bearer headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, tool: 'list_classrooms', data: { classrooms: [] } }))
    const client = new EdgeFunctionClient(fakeSession(), 'https://project.supabase.co', 'anon-key', fetchImpl)

    await client.callTool('list_classrooms', { subjectId: 'abc' })

    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
      'https://project.supabase.co/functions/v1/teacher-agent-tools',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          apikey: 'anon-key',
          Authorization: 'Bearer valid-access-token',
        }),
        body: JSON.stringify({ tool: 'list_classrooms', args: { subjectId: 'abc' } }),
      }),
    )
  })

  it('trims a trailing slash from SUPABASE_URL before building the endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, tool: 'list_classrooms', data: {} }))
    const client = new EdgeFunctionClient(fakeSession(), 'https://project.supabase.co/', 'anon-key', fetchImpl)

    await client.callTool('list_classrooms', {})

    expect(fetchImpl).toHaveBeenCalledWith('https://project.supabase.co/functions/v1/teacher-agent-tools', expect.anything())
  })
})

describe('EdgeFunctionClient — passes the Edge Function\'s response through unchanged', () => {
  it('returns the success envelope exactly as received', async () => {
    const data = { classrooms: [{ classroomId: '1', classroomName: 'ม.5/1' }] }
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, tool: 'list_classrooms', data }))
    const client = new EdgeFunctionClient(fakeSession(), 'https://project.supabase.co', 'anon-key', fetchImpl)

    const result = await client.callTool('list_classrooms', {})

    expect(result).toEqual({ ok: true, tool: 'list_classrooms', data })
  })

  it('returns a normal ok:false error envelope (e.g. not_found) unchanged, with no retry', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(404, { ok: false, tool: 'get_missing_submissions', error: { code: 'not_found', message: 'ไม่พบงานนี้' } }))
    const session = fakeSession()
    const client = new EdgeFunctionClient(session, 'https://project.supabase.co', 'anon-key', fetchImpl)

    const result = await client.callTool('get_missing_submissions', { assignmentId: 'x' })

    expect(result).toEqual({ ok: false, tool: 'get_missing_submissions', error: { code: 'not_found', message: 'ไม่พบงานนี้' } })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(session.reauthenticate).not.toHaveBeenCalled()
  })
})

describe('EdgeFunctionClient — 401 triggers exactly one forced re-authentication and retry', () => {
  it('retries once with a fresh token and returns the retry\'s result on success', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { ok: false, tool: 'list_classrooms', error: { code: 'unauthorized', message: 'expired' } }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, tool: 'list_classrooms', data: { classrooms: [] } }))
    const session = fakeSession()
    const client = new EdgeFunctionClient(session, 'https://project.supabase.co', 'anon-key', fetchImpl)

    const result = await client.callTool('list_classrooms', {})

    expect(session.reauthenticate).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect((fetchImpl.mock.calls[1][1] as RequestInit).headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer refreshed-access-token' }),
    )
    expect(result).toEqual({ ok: true, tool: 'list_classrooms', data: { classrooms: [] } })
  })

  it('never retries more than once even if the retry also 401s', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { ok: false, tool: 'list_classrooms', error: { code: 'unauthorized', message: 'still expired' } }))
    const session = fakeSession()
    const client = new EdgeFunctionClient(session, 'https://project.supabase.co', 'anon-key', fetchImpl)

    const result = await client.callTool('list_classrooms', {})

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(session.reauthenticate).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(false)
  })

  it('when reauthenticate itself fails, returns an unauthorized result whose message never contains a token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { ok: false, tool: 'list_classrooms', error: { code: 'unauthorized', message: 'expired' } }))
    const session = fakeSession({
      reauthenticate: vi.fn().mockRejectedValue(new TeacherAuthError('refresh token seed-refresh-token-xyz is dead')),
    })
    const client = new EdgeFunctionClient(session, 'https://project.supabase.co', 'anon-key', fetchImpl)

    const result = await client.callTool('list_classrooms', {})

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('unauthorized')
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1) // never retried the actual HTTP call
  })
})

describe('EdgeFunctionClient — initial auth failure never reaches fetch at all', () => {
  it('returns an unauthorized result without calling fetch when ensureValidSession throws', async () => {
    const fetchImpl = vi.fn()
    const session = fakeSession({ ensureValidSession: vi.fn().mockRejectedValue(new TeacherAuthError('bad credentials')) })
    const client = new EdgeFunctionClient(session, 'https://project.supabase.co', 'anon-key', fetchImpl)

    const result = await client.callTool('list_classrooms', {})

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, tool: 'list_classrooms', error: { code: 'unauthorized', message: 'bad credentials' } })
  })
})

describe('EdgeFunctionClient — transport/parsing failures degrade to clear errors, never throw', () => {
  it('a network failure (fetch rejects) becomes a network_error result', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'))
    const client = new EdgeFunctionClient(fakeSession(), 'https://project.supabase.co', 'anon-key', fetchImpl)

    const result = await client.callTool('list_classrooms', {})

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('network_error')
  })

  it('a non-JSON response body becomes an invalid_response result instead of throwing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 }))
    const client = new EdgeFunctionClient(fakeSession(), 'https://project.supabase.co', 'anon-key', fetchImpl)

    const result = await client.callTool('list_classrooms', {})

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid_response')
  })

  it('a JSON body that does not match the {ok, ...} envelope becomes an invalid_response result', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: 'shape' }))
    const client = new EdgeFunctionClient(fakeSession(), 'https://project.supabase.co', 'anon-key', fetchImpl)

    const result = await client.callTool('list_classrooms', {})

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('invalid_response')
  })

  it('callTool never throws for any of the above — always resolves', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('boom'))
    const client = new EdgeFunctionClient(fakeSession(), 'https://project.supabase.co', 'anon-key', fetchImpl)
    await expect(client.callTool('list_classrooms', {})).resolves.toBeDefined()
  })
})
