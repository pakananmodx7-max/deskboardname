import { getSupabaseClient } from '@/lib/supabase'

/**
 * Browser-side client for the Teacher Agent Tool Layer's Edge Function
 * (supabase/functions/teacher-agent-tools) — used ONLY by the temporary
 * developer diagnostic panel (agent-tools-dev-page.tsx), never by any
 * real teacher-facing feature yet (that is a later phase).
 *
 * Auth: `supabase.functions.invoke` automatically attaches the CURRENT
 * signed-in session's access token as the request's Authorization
 * header — exactly the same mechanism google-drive-service.ts's own
 * invokeFunction already relies on for every Google Drive Edge Function
 * call. Nothing here ever reads, stores, or displays that token, and
 * nothing here ever needs it to be copied in manually.
 */

const FUNCTION_NAME = 'teacher-agent-tools'

export interface AgentToolError {
  code: string
  message: string
}

export type AgentToolResponse<T = unknown> =
  | { ok: true; tool: string; data: T; httpStatus: 200 }
  | { ok: false; tool: string | null; error: AgentToolError; httpStatus: number | null }

/**
 * Defense in depth ONLY — supabase-js's own error objects for this
 * function never actually contain the caller's access token (it is a
 * request header, never echoed back in a response body or error
 * message). Still, nothing coming back from a network call should ever
 * be rendered without this scrub running over it first, given the
 * "never display or log access tokens" requirement — a JWT always looks
 * like three dot-separated base64url segments starting with "eyJ".
 */
export function scrubPossibleTokens(text: string): string {
  return text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]')
}

interface FunctionsHttpErrorLike {
  message?: string
  context?: Response
}

/**
 * Calls one Teacher Agent Tool through the deployed Edge Function and
 * normalizes the result to AgentToolResponse either way — a non-2xx
 * response (every error path in index.ts) surfaces through supabase-js
 * as a thrown-shaped `error` with the real JSON body only reachable via
 * `error.context` (a Response), never pre-parsed — see
 * google-drive-service.ts's own invokeFunction for the same pattern.
 * This function never throws: every outcome, including a network
 * failure that never reached the function at all, comes back as a
 * normal `{ ok: false, ... }` value the caller can render.
 */
export async function callTeacherAgentTool<T = unknown>(
  tool: string,
  args: Record<string, unknown> = {},
): Promise<AgentToolResponse<T>> {
  const supabase = getSupabaseClient()

  let invokeResult: { data: unknown; error: unknown }
  try {
    invokeResult = await supabase.functions.invoke(FUNCTION_NAME, { body: { tool, args } })
  } catch (err) {
    return {
      ok: false,
      tool,
      httpStatus: null,
      error: {
        code: 'network_error',
        message: scrubPossibleTokens(err instanceof Error ? err.message : 'ไม่สามารถเชื่อมต่อฟังก์ชันได้'),
      },
    }
  }

  const { data, error } = invokeResult

  if (error) {
    const context = (error as FunctionsHttpErrorLike).context
    const parsed = context ? ((await context.json().catch(() => null)) as AgentToolResponse<T> | null) : null
    const httpStatus = context?.status ?? null

    if (parsed && parsed.ok === false) {
      return {
        ok: false,
        tool: parsed.tool,
        httpStatus,
        error: {
          code: parsed.error.code,
          message: scrubPossibleTokens(parsed.error.message),
        },
      }
    }

    return {
      ok: false,
      tool,
      httpStatus,
      error: {
        code: 'network_error',
        message: scrubPossibleTokens((error as FunctionsHttpErrorLike).message ?? 'ไม่สามารถเชื่อมต่อฟังก์ชันได้'),
      },
    }
  }

  return { ...(data as { ok: true; tool: string; data: T }), httpStatus: 200 }
}
