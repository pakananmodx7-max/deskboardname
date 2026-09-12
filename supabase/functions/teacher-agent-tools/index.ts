// Teacher Agent Tool Layer — Phase 1 of the Hermes / AI Teacher
// Assistant integration.
//
// This is the ONLY entry point an external agent (Hermes, later) is
// meant to call. It never executes caller-supplied SQL and never lets a
// caller name an arbitrary table/column — every operation is one of the
// fixed handlers in registry.ts, each of which queries Postgres through
// the CALLER'S OWN RLS-scoped Supabase client (see
// _shared/agent-context.ts). The service-role key is used ONLY to
// verify the caller's session JWT and is never used to read or write
// application data here.
//
// Request shape:  POST { "tool": "<name>", "args": { ... } }
// Response shape: { "ok": true,  "tool": "<name>", "data": ... }
//              or  { "ok": false, "tool": "<name>" | null, "error": { "code", "message" } }
import { handleCorsPreflight, jsonResponse } from '../_shared/cors.ts'
import { ForbiddenError, NotFoundError, requireTeacherContext, UnauthorizedError, ValidationError } from '../_shared/agent-context.ts'
import { validateArgs } from '../_shared/tool-schema.ts'
import { findTool } from './registry.ts'

interface AgentToolRequestBody {
  tool?: unknown
  args?: unknown
}

function errorResponse(tool: string | null, status: number, code: string, message: string): Response {
  return jsonResponse({ ok: false, tool, error: { code, message } }, status)
}

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req)
  if (preflight) return preflight

  if (req.method !== 'POST') {
    return errorResponse(null, 405, 'method_not_allowed', 'ใช้ได้เฉพาะ POST เท่านั้น')
  }

  let body: AgentToolRequestBody
  try {
    body = await req.json()
  } catch {
    return errorResponse(null, 400, 'invalid_json', 'รูปแบบคำขอไม่ถูกต้อง (ต้องเป็น JSON)')
  }

  const toolName = body.tool
  if (typeof toolName !== 'string' || toolName.trim() === '') {
    return errorResponse(null, 400, 'missing_tool', 'กรุณาระบุชื่อ tool')
  }

  const tool = findTool(toolName)
  if (!tool) {
    return errorResponse(toolName, 400, 'unknown_tool', `ไม่รู้จัก tool ชื่อ "${toolName}"`)
  }

  const rawArgs = body.args ?? {}
  const { ok: argsOk, errors: argErrors } = validateArgs(tool.inputSchema, rawArgs)
  if (!argsOk) {
    return errorResponse(toolName, 400, 'invalid_arguments', argErrors.join('; '))
  }

  try {
    const ctx = await requireTeacherContext(req)
    const data = await tool.handler(ctx, rawArgs)
    return jsonResponse({ ok: true, tool: toolName, data })
  } catch (err) {
    if (err instanceof UnauthorizedError) return errorResponse(toolName, 401, 'unauthorized', err.message)
    if (err instanceof ForbiddenError) return errorResponse(toolName, 403, 'forbidden', err.message)
    if (err instanceof NotFoundError) return errorResponse(toolName, 404, 'not_found', err.message)
    if (err instanceof ValidationError) return errorResponse(toolName, 400, 'invalid_arguments', err.message)
    console.error(`[teacher-agent-tools] tool="${toolName}"`, err)
    return errorResponse(toolName, 500, 'internal_error', 'เกิดข้อผิดพลาดในการประมวลผลคำขอ')
  }
})
