import { getSupabaseClient } from '@/lib/supabase'

/**
 * Browser-side client for the Teacher Agent Tool Layer's Edge Function
 * (supabase/functions/teacher-agent-tools). Originally used only by the
 * temporary developer diagnostic panel (agent-tools-dev-page.tsx); now
 * also the web app's own bulk submission-status write path (see
 * submission-bulk-service.ts's bulkMarkSubmissionStatus, used by the
 * ตรวจสอบงาน matrix) — the SAME `mark_submission_status_bulk` tool
 * Hermes calls, through this SAME client, so there is exactly one write
 * path for that tool regardless of caller.
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

/**
 * Error codes the Edge Function's own request-routing layer (index.ts)
 * can return that are protocol/implementation details — a tool name
 * that isn't (yet, or anymore) deployed, a malformed request shape, a
 * disallowed HTTP method — never something a teacher caused or can act
 * on. Every OTHER code (unauthorized/forbidden/not_found/
 * invalid_arguments/internal_error) already carries a Thai message
 * written for a teacher to read (see agent-context.ts, tool-schema.ts,
 * and each write tool's own ValidationError/NotFoundError text) and is
 * passed through unchanged.
 *
 * This is what stops a deploy-lag bug (a tool implemented and committed
 * here, but not yet deployed to the live Edge Function) from ever
 * surfacing as a raw `ไม่รู้จัก tool ชื่อ "set_assignment_scores_bulk"`
 * in the bulk grading failures list — a teacher should never see an
 * internal tool name at all, whatever caused the mismatch.
 */
const INTERNAL_ONLY_ERROR_CODES = new Set(['unknown_tool', 'missing_tool', 'invalid_json', 'method_not_allowed'])

const GENERIC_SYSTEM_ERROR_MESSAGE = 'เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่อีกครั้ง หรือแจ้งผู้ดูแลระบบหากยังพบปัญหา'

/**
 * Replaces an internal-only error code's raw message with a safe,
 * generic one; every teacher-facing code's message passes through
 * verbatim. The raw `code` itself is still returned unchanged by
 * callTeacherAgentTool (a caller can still branch on it), only the
 * human-readable `message` is ever sanitized.
 */
export function sanitizeAgentToolErrorMessage(code: string, message: string): string {
  return INTERNAL_ONLY_ERROR_CODES.has(code) ? GENERIC_SYSTEM_ERROR_MESSAGE : message
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
      const rawMessage = scrubPossibleTokens(parsed.error.message)
      if (INTERNAL_ONLY_ERROR_CODES.has(parsed.error.code)) {
        // Logged for developers only — never returned to the caller,
        // which is exactly the point: a teacher must never see an
        // internal tool-routing detail like a missing/undeployed tool
        // name, only that something went wrong and to try again.
        console.error(`[teacher-agent-tools] ${parsed.error.code}: ${rawMessage}`)
      }
      return {
        ok: false,
        tool: parsed.tool,
        httpStatus,
        error: {
          code: parsed.error.code,
          message: sanitizeAgentToolErrorMessage(parsed.error.code, rawMessage),
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
