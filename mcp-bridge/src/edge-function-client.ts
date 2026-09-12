import type { TeacherSession } from './teacher-session.js'

/**
 * Mirrors supabase/functions/teacher-agent-tools/index.ts's own response
 * envelope EXACTLY — this bridge never reshapes, renames, or reinterprets
 * a field the Edge Function returns; see this file's own doc comment for
 * why (the Edge Function is the single source of truth for both business
 * logic and response shape).
 */
export interface AgentToolSuccess {
  ok: true
  tool: string
  data: unknown
}
export interface AgentToolFailure {
  ok: false
  tool: string | null
  error: { code: string; message: string }
}
export type AgentToolResult = AgentToolSuccess | AgentToolFailure

function isAgentToolResult(value: unknown): value is AgentToolResult {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return false
  const record = value as Record<string, unknown>
  if (record.ok === true) return 'data' in record
  if (record.ok === false) {
    const error = record.error as Record<string, unknown> | undefined
    return typeof error === 'object' && error !== null && typeof error.code === 'string' && typeof error.message === 'string'
  }
  return false
}

/**
 * The bridge's ONLY HTTP client — calls the ALREADY-DEPLOYED production
 * `teacher-agent-tools` Edge Function exactly as the web app's own
 * teacher-agent-tools-client.ts does (same endpoint, same
 * `{ tool, args }` body, same `apikey` + `Authorization: Bearer <token>`
 * headers a real supabase-js client would send). No business logic is
 * reimplemented here — every rule (ownership checks, RLS, argument
 * validation) lives ONLY in the Edge Function; this class's entire job
 * is getting a valid teacher token onto the request and handing back
 * whatever the function decides.
 */
export class EdgeFunctionClient {
  private readonly endpoint: string

  constructor(
    private readonly session: TeacherSession,
    supabaseUrl: string,
    private readonly supabaseAnonKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.endpoint = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/teacher-agent-tools`
  }

  async callTool(tool: string, args: Record<string, unknown>): Promise<AgentToolResult> {
    let accessToken: string
    try {
      accessToken = await this.session.ensureValidSession()
    } catch (err) {
      return unauthorizedResult(tool, err)
    }

    let response: Response
    try {
      response = await this.post(tool, args, accessToken)
    } catch (err) {
      return networkErrorResult(tool, err)
    }

    if (response.status === 401) {
      // The Edge Function (or Supabase's own gateway) rejected the
      // token even though our own clock thought it still had time left
      // — e.g. it was revoked, or clocks drifted. One retry, with a
      // forced re-authentication, never more (avoids ever looping on a
      // genuinely dead credential).
      let freshToken: string
      try {
        freshToken = await this.session.reauthenticate()
      } catch (err) {
        return unauthorizedResult(tool, err)
      }
      let retryResponse: Response
      try {
        retryResponse = await this.post(tool, args, freshToken)
      } catch (err) {
        return networkErrorResult(tool, err)
      }
      return this.parse(tool, retryResponse)
    }

    return this.parse(tool, response)
  }

  private async post(tool: string, args: Record<string, unknown>, accessToken: string): Promise<Response> {
    return this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: this.supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ tool, args }),
    })
  }

  private async parse(tool: string, response: Response): Promise<AgentToolResult> {
    let body: unknown
    try {
      body = await response.json()
    } catch {
      return {
        ok: false,
        tool,
        error: {
          code: 'invalid_response',
          message: `teacher-agent-tools returned a non-JSON response (HTTP ${response.status}).`,
        },
      }
    }

    if (isAgentToolResult(body)) return body

    return {
      ok: false,
      tool,
      error: {
        code: 'invalid_response',
        message: `Unexpected response shape from teacher-agent-tools (HTTP ${response.status}).`,
      },
    }
  }
}

function unauthorizedResult(tool: string, err: unknown): AgentToolFailure {
  return {
    ok: false,
    tool,
    error: {
      code: 'unauthorized',
      message: err instanceof Error ? err.message : 'Teacher authentication failed.',
    },
  }
}

function networkErrorResult(tool: string, err: unknown): AgentToolFailure {
  return {
    ok: false,
    tool,
    error: {
      code: 'network_error',
      message: `Could not reach teacher-agent-tools. Check network connectivity and SUPABASE_URL. (${
        err instanceof Error ? err.message : String(err)
      })`,
    },
  }
}
