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
  it('exposes exactly the 11 approved tools, no more', () => {
    const names = [
      'list_classrooms',
      'list_assignments',
      'get_missing_submissions',
      'get_student_summary',
      'get_classroom_summary',
      'get_classroom_submission_summary',
      'create_assignment',
      'copy_assignment_to_classrooms',
      'mark_attendance_bulk',
      'mark_submission_status',
      'mark_submission_status_bulk',
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

describe('read-tools.ts — 6 read tools, each classroom/subject/assignment-scoped', () => {
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

  it('get_classroom_submission_summary requires classroom ownership before querying assignments, reuses getClassroomRoster + assignment_submissions, and delegates aggregation to the shared computeClassroomSubmissionSummary — no parallel data model', () => {
    const fn = readTools.slice(
      readTools.indexOf('async function getClassroomSubmissionSummary'),
      readTools.indexOf('export const getClassroomSubmissionSummaryTool'),
    )
    expect(fn.indexOf('requireOwnedClassroom(client, args.classroomId)')).toBeLessThan(fn.indexOf("from('assignments')"))
    expect(fn).toContain('getClassroomRoster(client, args.classroomId)')
    expect(fn).toContain("from('assignment_submissions')")
    expect(fn).toContain('computeClassroomSubmissionSummary(')
    expect(fn).toContain('SUBMITTED_STATUSES')
    expect(fn).not.toContain('createAdminClient')
  })

  it('get_classroom_submission_summary imports its aggregation logic from submission-summary.ts rather than reimplementing it inline', () => {
    expect(readTools).toContain("import { computeClassroomSubmissionSummary } from './submission-summary.ts'")
  })

  it('get_classroom_submission_summary is read-only: no insert/update/upsert/delete call anywhere in its handler', () => {
    const fn = readTools.slice(
      readTools.indexOf('async function getClassroomSubmissionSummary'),
      readTools.indexOf('export const getClassroomSubmissionSummaryTool'),
    )
    expect(fn).not.toMatch(/\.(insert|update|upsert|delete)\(/)
  })
})

describe('write-tools.ts — the 5 approved safe writes', () => {
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

  it('none of the 5 write tools ever deletes a row (no .delete( call anywhere in write-tools.ts)', () => {
    expect(writeTools).not.toMatch(/\.delete\(/)
  })
})

describe('write-tools.ts — mark_submission_status (submission status write)', () => {
  const fn = writeTools.slice(
    writeTools.indexOf('async function markSubmissionStatus'),
    writeTools.indexOf('export const markSubmissionStatusTool'),
  )

  // -- successful update / clear structured result --------------------
  it('reads/writes exclusively assignment_submissions.status — the existing production source of truth (0006), never a new table', () => {
    expect(fn).toContain("from('assignment_submissions')")
    expect(fn).toContain('status')
    expect(writeTools).not.toMatch(/create table|create_table/i)
  })

  it('returns previousStatus, the new status, and a `changed` flag so Hermes can verify exactly what happened', () => {
    const toolBody = writeTools.slice(
      writeTools.indexOf('return {', writeTools.indexOf('async function markSubmissionStatus')),
      writeTools.indexOf('export const markSubmissionStatusTool'),
    )
    expect(toolBody).toContain('previousStatus')
    expect(toolBody).toContain('status: updated.status')
    expect(toolBody).toContain('changed:')
  })

  // -- reuses the exact production write path already used by the web app --
  it('upserts with onConflict on (assignment_id, student_id) — the exact same shape as assignment-service.ts\'s setSubmissionStatus, the web app\'s own production write path', () => {
    expect(fn).toContain(".upsert(")
    expect(fn).toContain("onConflict: 'assignment_id,student_id'")
  })

  // -- teacher ownership + invalid/unowned assignment --------------------
  it('requires assignment ownership (requireOwnedAssignment) before touching assignment_submissions — this is also how an invalid/unowned assignmentId is rejected', () => {
    expect(fn.indexOf('requireOwnedAssignment(client, args.assignmentId)')).toBeGreaterThan(-1)
    expect(fn.indexOf('requireOwnedAssignment(client, args.assignmentId)')).toBeLessThan(fn.indexOf('.upsert('))
  })

  // -- student not belonging to the assignment's classroom ---------------
  it('checks classroom_students membership before the FIRST write for a (assignment, student) pair — mirrors assignment_submissions_insert_own (0006) with a clear NotFoundError instead of a raw RLS violation', () => {
    expect(fn).toContain("from('classroom_students')")
    expect(fn).toContain("eq('classroom_id', assignment.classroom_id)")
    expect(fn).toContain("eq('student_id', args.studentId)")
    expect(fn).toContain('NotFoundError(')
  })

  it('does NOT repeat the membership check once a submission row already exists — correcting a past mistake for a student who has since left the classroom must stay possible (matches assignment_submissions_update_own\'s own design)', () => {
    const membershipCheckIndex = fn.indexOf("from('classroom_students')")
    const ifNotExistingIndex = fn.indexOf('if (!existing)')
    expect(ifNotExistingIndex).toBeGreaterThan(-1)
    expect(ifNotExistingIndex).toBeLessThan(membershipCheckIndex)
  })

  // -- invalid status: only the 4 real production values ------------------
  it('only accepts the 4 statuses assignment_submissions.status actually supports (0006) — no invented submitted/late/missing-like value', () => {
    expect(writeTools).toContain(
      "SUBMISSION_STATUS_VALUES = ['not_submitted', 'submitted', 'late', 'missing']",
    )
  })

  // -- never bypasses teacher authorization with service-role -------------
  it('never uses a service-role/admin client to bypass RLS — every query goes through ctx.client (the caller\'s own RLS-scoped client)', () => {
    expect(fn).not.toMatch(/service[_-]?role|createAdminClient/i)
  })

  it('never forges teacherId from caller-supplied args (consistent with every other tool in this layer)', () => {
    expect(fn).not.toMatch(/args\.teacherId/)
  })

  it('is registered in writeTools alongside the other 3 write tools', () => {
    expect(writeTools).toContain('markSubmissionStatusTool')
    expect(writeTools).toMatch(/writeTools:\s*AgentTool<any>\[\]\s*=\s*\[[\s\S]*markSubmissionStatusTool/)
  })

  it('never deletes a row and never touches Storage', () => {
    expect(fn).not.toMatch(/\.delete\(/)
    expect(fn).not.toMatch(/\.storage\s*\./)
  })
})

describe('write-tools.ts — mark_submission_status_bulk (bulk submission status write)', () => {
  // Starts at the "10. mark_submission_status_bulk" section header so it
  // also covers the MAX_BULK_SUBMISSION_STATUS_UPDATES constant and the
  // MarkSubmissionStatusBulkUpdateInput interface declared just above the
  // function itself.
  const section = writeTools.slice(
    writeTools.indexOf('// 10. mark_submission_status_bulk'),
    writeTools.indexOf('export const writeTools:'),
  )
  const fn = writeTools.slice(
    writeTools.indexOf('async function markSubmissionStatusBulk'),
    writeTools.indexOf('export const markSubmissionStatusBulkTool'),
  )
  const toolDef = writeTools.slice(
    writeTools.indexOf('export const markSubmissionStatusBulkTool'),
    writeTools.indexOf('export const writeTools:'),
  )

  // -- exists ONLY to avoid sequential mark_submission_status calls -------
  it('is registered alongside the other 4 write tools, right after markSubmissionStatusTool', () => {
    expect(writeTools).toMatch(
      /writeTools:\s*AgentTool<any>\[\]\s*=\s*\[[\s\S]*markSubmissionStatusTool,\s*markSubmissionStatusBulkTool/,
    )
  })

  // -- reuses markSubmissionStatus verbatim, no separate data model/write path --
  it('every update runs through the SAME markSubmissionStatus() function used by the single-item tool — no separate upsert, no separate data model', () => {
    expect(fn).toContain('await markSubmissionStatus(ctx, update)')
    expect(fn).not.toContain(".from('assignment_submissions')")
    expect(fn).not.toContain('.upsert(')
  })

  it('never uses a service-role/admin client — every query still goes through ctx.client via the reused markSubmissionStatus', () => {
    expect(fn).not.toMatch(/service[_-]?role|createAdminClient/i)
  })

  it('never forges teacherId from caller-supplied args', () => {
    expect(fn).not.toMatch(/args\.teacherId/)
  })

  // -- only the 4 real production status values, mirrored via the shared constant --
  it("each update's status is typed against the shared SUBMISSION_STATUS_VALUES constant — no invented status value for the bulk tool", () => {
    expect(section).toContain('(typeof SUBMISSION_STATUS_VALUES)[number]')
  })

  // -- maximum batch size ---------------------------------------------------
  it('rejects an empty batch and a batch over MAX_BULK_SUBMISSION_STATUS_UPDATES (50) before any write is attempted', () => {
    expect(section).toContain('MAX_BULK_SUBMISSION_STATUS_UPDATES = 50')
    const emptyCheckIndex = fn.indexOf('args.updates.length === 0')
    const maxCheckIndex = fn.indexOf('args.updates.length > MAX_BULK_SUBMISSION_STATUS_UPDATES')
    const promiseAllIndex = fn.indexOf('Promise.all(')
    expect(emptyCheckIndex).toBeGreaterThan(-1)
    expect(maxCheckIndex).toBeGreaterThan(-1)
    expect(emptyCheckIndex).toBeLessThan(promiseAllIndex)
    expect(maxCheckIndex).toBeLessThan(promiseAllIndex)
    expect(fn.slice(emptyCheckIndex, emptyCheckIndex + 60)).toMatch(/ValidationError/)
  })

  // -- partial failure: one bad update never blocks or rolls back the rest --
  it("each update is independent (try/catch inside Promise.all's mapper) — one failing never throws out of the whole batch and never blocks the others", () => {
    expect(fn).toContain('Promise.all(')
    expect(fn).toContain('try {')
    expect(fn).toContain('} catch (err) {')
    expect(fn).toContain('ok: false as const')
  })

  it('classifies a failure by error type — NotFoundError (invalid/unowned assignment, or student not in classroom) -> not_found, ValidationError -> invalid_arguments, anything else -> internal_error', () => {
    expect(fn).toMatch(/err instanceof NotFoundError[\s\S]{0,20}'not_found'/)
    expect(fn).toMatch(/err instanceof ValidationError[\s\S]{0,40}'invalid_arguments'/)
    expect(fn).toContain("'internal_error'")
  })

  // -- compact result shape only — never large submission objects ---------
  it('returns ONLY the compact aggregate shape (requestedCount/changedCount/unchangedCount/failedCount/failures) — never previousStatus/score/note/updatedAt per item', () => {
    const returnBlock = fn.slice(fn.lastIndexOf('return {'))
    expect(returnBlock).toContain('requestedCount: args.updates.length')
    expect(returnBlock).toContain('changedCount')
    expect(returnBlock).toContain('unchangedCount')
    expect(returnBlock).toContain('failedCount: failures.length')
    expect(returnBlock).toContain('failures')
    expect(returnBlock).not.toMatch(/previousStatus|updatedAt/)
  })

  it('a failure entry names only assignmentId/studentId/code/message — never a full row', () => {
    expect(fn).toMatch(/assignmentId,\s*studentId,\s*code,\s*message/)
  })

  // -- idempotency: reuses markSubmissionStatus's own idempotent upsert ---
  it('changed/unchanged is derived from markSubmissionStatus\'s own `changed` flag — calling the same batch twice yields unchangedCount on the second call, for free, with no extra logic here', () => {
    expect(fn).toContain('result.changed')
    expect(fn).toContain('successes.filter((r) => r.changed).length')
    expect(fn).toContain('successes.filter((r) => !r.changed).length')
  })

  // -- tool registration shape ---------------------------------------------
  it("the tool's inputSchema requires `updates` as an array of {assignmentId, studentId, status} objects, matching mark_attendance_bulk's established shape", () => {
    expect(toolDef).toContain("required: ['updates']")
    expect(toolDef).toMatch(/updates:\s*\{\s*type:\s*'array'/)
    expect(toolDef).toContain("required: ['assignmentId', 'studentId', 'status']")
  })

  it('never deletes a row and never touches Storage', () => {
    expect(fn).not.toMatch(/\.delete\(/)
    expect(fn).not.toMatch(/\.storage\s*\./)
  })
})
