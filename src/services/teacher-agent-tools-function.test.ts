import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// ==================================================
// Teacher Agent Tool Layer (Phase 1) — supabase/functions/teacher-agent-tools.
//
// These Edge Function files use Deno-only APIs (`Deno.env`, `Deno.serve`)
// and `npm:` specifier imports, so — exactly like every existing Edge
// Function test in this codebase (see google-drive-service.test.ts's own
// readFunctionSource/readSharedFunctionSource) — they cannot be imported
// and executed under Vitest/Node. These are source-text structural
// guards: real behavioral coverage of argument validation lives in
// teacher-agent-tools-schema.test.ts, which imports and runs the (Deno-
// independent) validator directly.
// ==================================================

function readFn(path: string): string {
  return readFileSync(new URL(`../../supabase/functions/${path}`, import.meta.url), 'utf-8')
}

const index = readFn('teacher-agent-tools/index.ts')
const registry = readFn('teacher-agent-tools/registry.ts')
const agentContext = readFn('_shared/agent-context.ts')
const readTools = readFn('teacher-agent-tools/tools/read-tools.ts')
const writeTools = readFn('teacher-agent-tools/tools/write-tools.ts')
const sharedTools = readFn('teacher-agent-tools/tools/shared.ts')
const supabaseAdmin = readFn('_shared/supabase-admin.ts')
const allToolFiles = readTools + writeTools + sharedTools

describe('index.ts — single POST endpoint, request/response shape', () => {
  it('is a single Deno.serve handler (one endpoint for every tool)', () => {
    expect(index).toContain('Deno.serve(async (req: Request)')
  })

  it('rejects anything but POST', () => {
    expect(index).toContain("req.method !== 'POST'")
    expect(index).toContain('405')
  })

  it('returns { ok: true, tool, data } on success', () => {
    expect(index).toMatch(/jsonResponse\(\{\s*ok:\s*true,\s*tool:\s*toolName,\s*data\s*\}\)/)
  })

  it('returns { ok: false, tool, error: { code, message } } on every error path', () => {
    expect(index).toContain('function errorResponse(')
    expect(index).toContain('ok: false, tool, error: { code, message }')
  })
})

describe('index.ts — malformed tool name / malformed arguments', () => {
  it('an unknown tool name is rejected with 400 unknown_tool, before any handler runs', () => {
    expect(index).toContain('const tool = findTool(toolName)')
    expect(index).toMatch(/if \(!tool\) \{\s*return errorResponse\(toolName, 400, 'unknown_tool'/)
  })

  it('a missing/blank tool field is rejected before even looking up the registry', () => {
    expect(index).toContain("typeof toolName !== 'string' || toolName.trim() === ''")
    expect(index).toContain("'missing_tool'")
  })

  it('invalid JSON in the request body is rejected with 400, not a 500 crash', () => {
    expect(index).toMatch(/catch \{\s*return errorResponse\(null, 400, 'invalid_json'/)
  })

  it('args are schema-validated BEFORE the handler (and before auth) is ever invoked', () => {
    const validateIndex = index.indexOf('validateArgs(tool.inputSchema, rawArgs)')
    const authIndex = index.indexOf('requireTeacherContext(req)')
    const handlerIndex = index.indexOf('tool.handler(ctx, rawArgs)')
    expect(validateIndex).toBeGreaterThan(-1)
    expect(validateIndex).toBeLessThan(authIndex)
    expect(authIndex).toBeLessThan(handlerIndex)
  })

  it('a failed validation returns 400 invalid_arguments and never reaches auth or the handler', () => {
    expect(index).toMatch(/if \(!argsOk\) \{\s*return errorResponse\(toolName, 400, 'invalid_arguments'/)
  })
})

describe('index.ts — auth/authorization error mapping', () => {
  it('maps UnauthorizedError -> 401, ForbiddenError -> 403, NotFoundError -> 404, ValidationError -> 400, anything else -> 500', () => {
    expect(index).toMatch(/UnauthorizedError\)[\s\S]{0,40}401,\s*'unauthorized'/)
    expect(index).toMatch(/ForbiddenError\)[\s\S]{0,40}403,\s*'forbidden'/)
    expect(index).toMatch(/NotFoundError\)[\s\S]{0,40}404,\s*'not_found'/)
    expect(index).toMatch(/ValidationError\)[\s\S]{0,40}400,\s*'invalid_arguments'/)
    expect(index).toContain("500, 'internal_error'")
  })

  it('never leaks a raw exception message on the 500 path — logs server-side, returns a fixed generic message', () => {
    expect(index).toContain('console.error(')
    expect(index).toContain("'เกิดข้อผิดพลาดในการประมวลผลคำขอ'")
  })

  it('uses the shared CORS helpers — same preflight/headers as every other Edge Function, no bespoke CORS logic', () => {
    expect(index).toContain("from '../_shared/cors.ts'")
    expect(index).toContain('handleCorsPreflight(req)')
  })
})

describe('agent-context.ts — identity: service-role key ONLY verifies the JWT, never reads/writes app data', () => {
  it('requireTeacherContext derives teacherId from the verified session JWT via requireTeacherId — never from the request body', () => {
    expect(agentContext).toContain('const teacherId = await requireTeacherId(req, admin)')
    expect(agentContext).not.toMatch(/teacherId\s*=\s*body/)
    expect(agentContext).not.toMatch(/teacherId\s*:\s*args/)
  })

  it('the admin/service-role client is used ONLY for requireTeacherId, then never touched again in this function', () => {
    const adminUsages = agentContext.match(/\badmin\b/g) ?? []
    // exactly: the `admin` in requireTeacherContext's doc comment, its
    // declaration (`const admin = ...`), and the one requireTeacherId(req, admin) call
    expect(adminUsages.length).toBeLessThanOrEqual(4)
    expect(agentContext).not.toMatch(/admin\s*\.\s*from\(/)
  })

  it('every actual data operation goes through a user-scoped client built from the caller\'s OWN forwarded Authorization header (RLS applies as that teacher)', () => {
    expect(agentContext).toContain("global: { headers: { Authorization: authHeader } }")
    expect(agentContext).toContain("Deno.env.get('SUPABASE_ANON_KEY')")
    // never the service-role key for the client tools actually query with
    expect(agentContext.slice(agentContext.indexOf('createClient(url, anonKey'))).not.toMatch(/SERVICE_ROLE/)
  })

  it('rejects a student account (or any non-teacher profile) even though profiles_select_own would let them read their own row', () => {
    expect(agentContext).toContain("profile.role !== 'teacher'")
    expect(agentContext).toContain('class ForbiddenError extends Error')
    expect(agentContext).toContain('throw new ForbiddenError(')
  })

  it('re-exports the existing UnauthorizedError (no session / invalid token) rather than redefining it', () => {
    expect(agentContext).toContain("import { createAdminClient, requireTeacherId, UnauthorizedError } from './supabase-admin.ts'")
    expect(agentContext).toContain('export { UnauthorizedError }')
  })

  it('never hardcodes or echoes back a teacher id the caller could have supplied — no "args.teacherId" anywhere in the whole tool layer', () => {
    expect(allToolFiles).not.toMatch(/args\.teacherId/)
    expect(index).not.toMatch(/args\.teacherId/)
  })
})

describe('supabase-admin.ts — untouched (Google Drive integration must not regress)', () => {
  it('still exports createAdminClient, requireTeacherId, and UnauthorizedError exactly as before', () => {
    expect(supabaseAdmin).toContain('export function createAdminClient()')
    expect(supabaseAdmin).toContain('export async function requireTeacherId(')
    expect(supabaseAdmin).toContain('export class UnauthorizedError extends Error {}')
  })
})

describe('registry.ts — the tool list Hermes will eventually consume', () => {
  it('exposes exactly the 8 approved Phase 1 tools, no more', () => {
    const names = [
      'list_classrooms',
      'list_assignments',
      'get_missing_submissions',
      'get_student_summary',
      'get_classroom_summary',
      'create_assignment',
      'copy_assignment_to_classrooms',
      'mark_attendance_bulk',
    ]
    for (const name of names) {
      expect(allToolFiles).toContain(`name: '${name}'`)
    }
    const nameMatches = allToolFiles.match(/name:\s*'[a-z_]+'/g) ?? []
    expect(new Set(nameMatches).size).toBe(names.length)
  })

  it('every tool carries a description and a JSON-Schema-shaped inputSchema (so it can be handed to Hermes/OpenAI later)', () => {
    expect(registry).toContain('toolRegistry: AgentTool<any>[]')
    expect(registry).toContain("t.description")
    expect(registry).toContain('toJsonSchema(t.inputSchema)')
  })

  it('never adds a delete/destructive tool', () => {
    expect(allToolFiles).not.toMatch(/delete_assignment|delete_subject|delete_lesson|delete_classroom|delete_student/)
    const registryToolNames = registry.match(/name:\s*'[a-z_]+'/g) ?? []
    expect(registryToolNames.some((n) => n.includes('delete_'))).toBe(false)
  })

  it('no tool executes arbitrary SQL or lets the caller name an arbitrary table', () => {
    expect(allToolFiles).not.toMatch(/\.rpc\('exec_sql'|\.rpc\('run_sql'|from\(args\./)
    // the only two RPC names ever called are the pre-existing, narrowly-scoped ones
    const rpcCalls = allToolFiles.match(/\.rpc\('([a-z_]+)'/g) ?? []
    expect(rpcCalls.length).toBeGreaterThan(0)
    for (const call of rpcCalls) {
      expect(call).toBe(".rpc('save_attendance_session'")
    }
  })

  it('never touches Supabase Storage (no Storage access of any kind in Phase 1)', () => {
    expect(allToolFiles).not.toMatch(/\.storage\s*\./)
  })
})

describe('shared.ts — ownership lookups (classroom/subject/assignment) used by every tool', () => {
  it('requireOwnedClassroom/Subject/Assignment all go through the caller-scoped client and surface a 404-mapped NotFoundError on a miss', () => {
    expect(sharedTools).toContain('export async function requireOwnedClassroom(client: any, classroomId: string)')
    expect(sharedTools).toContain('export async function requireOwnedSubject(client: any, subjectId: string)')
    expect(sharedTools).toContain('export async function requireOwnedAssignment(client: any, assignmentId: string)')
    expect(sharedTools).toContain("throw new NotFoundError('ไม่พบห้องเรียนนี้ หรือคุณไม่มีสิทธิ์เข้าถึง')")
    expect(sharedTools).toContain("throw new NotFoundError('ไม่พบรายวิชานี้ หรือคุณไม่มีสิทธิ์เข้าถึง')")
    expect(sharedTools).toContain("throw new NotFoundError('ไม่พบงานนี้ หรือคุณไม่มีสิทธิ์เข้าถึง')")
  })

  it('never fetches PII columns (email/phone/student_code) into a tool response — only what the ticket asked for', () => {
    expect(sharedTools).not.toMatch(/select\([^)]*\bemail\b/)
    expect(sharedTools).not.toMatch(/select\([^)]*\bphone\b/)
  })
})

describe('read-tools.ts — 5 read tools, each classroom/subject/assignment-scoped', () => {
  it('list_classrooms requires ownership of the subject when subjectId is given, and derives student counts from classroom_students', () => {
    expect(readTools).toContain('requireOwnedSubject(client, args.subjectId)')
    expect(readTools).toContain("from('classroom_students')")
  })

  it('list_assignments requires classroom ownership before querying assignments, and scopes every query to that classroomId', () => {
    const fn = readTools.slice(readTools.indexOf('async function listAssignments'), readTools.indexOf('export const listAssignmentsTool'))
    expect(fn.indexOf('requireOwnedClassroom(client, args.classroomId)')).toBeLessThan(fn.indexOf("from('assignments')"))
    expect(fn).toContain("eq('classroom_id', args.classroomId)")
  })

  it('get_missing_submissions requires assignment ownership, then diffs the roster against submitted/late students only', () => {
    const fn = readTools.slice(
      readTools.indexOf('async function getMissingSubmissions'),
      readTools.indexOf('export const getMissingSubmissionsTool'),
    )
    expect(fn).toContain('requireOwnedAssignment(client, args.assignmentId)')
    expect(fn).toContain('SUBMITTED_STATUSES')
    expect(fn).toContain('!submittedStudentIds.has(student.id)')
  })

  it('get_student_summary refuses a student who is not in one of the caller\'s OWN classrooms (cross-teacher isolation)', () => {
    expect(readTools).toContain("throw new NotFoundError('ไม่พบนักเรียนคนนี้ในห้องเรียนของคุณ')")
    expect(readTools).toContain("throw new NotFoundError('ไม่พบนักเรียนคนนี้ในห้องเรียนที่ระบุ')")
  })

  it('get_classroom_summary requires classroom ownership and computes "needing attention" from simple, documented, transparent rules only', () => {
    const fn = readTools.slice(readTools.indexOf('async function getClassroomSummary'), readTools.indexOf('export const getClassroomSummaryTool'))
    expect(fn.indexOf('requireOwnedClassroom(client, args.classroomId)')).toBeLessThan(fn.indexOf('roster.map'))
    expect(fn).toContain('attendance_below_')
    expect(fn).toContain('missing_assignments_')
    expect(fn).toContain('average_score_below_')
    expect(fn).not.toMatch(/openai|anthropic|ml model|predict\(/i)
  })

  it('the classroom summary\'s attention thresholds are configurable arguments with stated defaults, never hardcoded opaque constants', () => {
    expect(readTools).toContain('DEFAULT_ATTENDANCE_THRESHOLD_PERCENT = 80')
    expect(readTools).toContain('DEFAULT_MISSING_ASSIGNMENTS_THRESHOLD = 2')
    expect(readTools).toContain('DEFAULT_SCORE_THRESHOLD_PERCENT = 50')
    expect(readTools).toContain('rulesApplied')
  })
})

describe('write-tools.ts — the 3 approved safe writes', () => {
  it('create_assignment requires classroom ownership, creates no assignment_submissions row, and enforces teacherId server-side as created_by', () => {
    const fn = writeTools.slice(writeTools.indexOf('async function createAssignment'), writeTools.indexOf('export const createAssignmentTool'))
    expect(fn).toContain('requireOwnedClassroom(client, args.classroomId)')
    expect(fn).toContain('created_by: teacherId')
    expect(fn).not.toContain("from('assignment_submissions')")
  })

  it('copy_assignment_to_classrooms requires ownership of BOTH the source assignment and every target classroom, and never inserts assignment_submissions', () => {
    const fn = writeTools.slice(
      writeTools.indexOf('async function copyAssignmentToClassrooms'),
      writeTools.indexOf('export const copyAssignmentToClassroomsTool'),
    )
    expect(fn).toContain('requireOwnedAssignment(client, args.assignmentId)')
    expect(fn).toContain('requireOwnedClassroom(client, targetClassroomId)')
    expect(fn).not.toContain("from('assignment_submissions')")
  })

  it('copy_assignment_to_classrooms treats each target independently — one failing is caught and reported, never throws out of the whole call', () => {
    const fn = writeTools.slice(
      writeTools.indexOf('async function copyAssignmentToClassrooms'),
      writeTools.indexOf('export const copyAssignmentToClassroomsTool'),
    )
    expect(fn).toContain('try {')
    expect(fn).toContain('} catch (err) {')
    expect(fn).toContain('ok: false')
  })

  it('mark_attendance_bulk requires classroom ownership then delegates entirely to save_attendance_session (the same RPC the browser app uses) — classroom-scoped by construction', () => {
    const fn = writeTools.slice(writeTools.indexOf('async function markAttendanceBulk'), writeTools.indexOf('export const markAttendanceBulkTool'))
    expect(fn.indexOf('requireOwnedClassroom(client, args.classroomId)')).toBeLessThan(fn.indexOf("rpc('save_attendance_session'"))
    expect(fn).toContain('p_classroom_id: args.classroomId')
  })

  it('mark_attendance_bulk only accepts the 4 explicit attendance statuses — no free-text status', () => {
    expect(writeTools).toContain("ATTENDANCE_STATUS_VALUES = ['present', 'late', 'leave', 'absent']")
  })

  it('none of the 3 write tools ever deletes a row (no .delete( call anywhere in write-tools.ts)', () => {
    expect(writeTools).not.toMatch(/\.delete\(/)
  })
})
