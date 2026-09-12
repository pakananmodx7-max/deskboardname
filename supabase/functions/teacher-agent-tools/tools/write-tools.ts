// deno-lint-ignore-file no-explicit-any
import { ValidationError } from '../../_shared/agent-context.ts'
import type { AgentContext } from '../../_shared/agent-context.ts'
import type { AgentTool } from '../types.ts'
import { requireOwnedAssignment, requireOwnedClassroom } from './shared.ts'

// ==================================================
// Shared: resolving which subject an assignment write belongs to.
//
// The ticket's create_assignment/copy_assignment_to_classrooms input
// shapes name only a classroomId, but assignments.subject_id is NOT
// NULL (0006) and assignments_insert_own (0006) requires the caller to
// own that subject AND for it to actually be linked to the target
// classroom via subject_classrooms. A classroom can be linked to zero,
// one, or several subjects (0002's subject_classrooms is many-to-many),
// so "the classroom's subject" is not always unambiguous. Resolution
// rule, kept identical for both write tools:
//   - exactly one subject linked to the classroom -> use it, no
//     disambiguation needed.
//   - more than one (or the caller passed an explicit subjectId) ->
//     an explicit `subjectId` argument is required/validated against
//     that link.
//   - zero -> ValidationError; there is nothing a subject-scoped
//     assignment could attach to.
// This is documented explicitly in the Phase 1 report rather than
// silently guessed, since it's a real gap between the ticket's literal
// tool schema and the database's existing NOT NULL constraint.
// ==================================================

async function resolveSubjectForClassroom(
  client: any,
  classroomId: string,
  explicitSubjectId: string | undefined,
): Promise<{ subjectId: string; subjectName: string }> {
  const { data: links, error } = await client
    .from('subject_classrooms')
    .select('subject_id, subjects(id, name)')
    .eq('classroom_id', classroomId)
  if (error) throw error
  const candidates = ((links ?? []) as any[])
    .map((link) => link.subjects)
    .filter((s): s is { id: string; name: string } => Boolean(s))

  if (explicitSubjectId) {
    const match = candidates.find((s) => s.id === explicitSubjectId)
    if (!match) {
      throw new ValidationError('รายวิชานี้ไม่ได้เชื่อมกับห้องเรียนนี้')
    }
    return { subjectId: match.id, subjectName: match.name }
  }

  if (candidates.length === 1) {
    return { subjectId: candidates[0].id, subjectName: candidates[0].name }
  }
  if (candidates.length === 0) {
    throw new ValidationError('ห้องเรียนนี้ยังไม่ได้เชื่อมกับรายวิชาใด ไม่สามารถสร้างงานได้')
  }
  throw new ValidationError(
    'ห้องเรียนนี้เชื่อมกับหลายรายวิชา กรุณาระบุ subjectId เพื่อเลือกรายวิชาที่ต้องการ',
  )
}

// ==================================================
// 6. create_assignment
// ==================================================

interface CreateAssignmentArgs {
  classroomId: string
  title: string
  description?: string
  maxScore: number
  dueDate?: string
  /** Not in the original ticket schema — see the module doc comment
   * above for why it exists (disambiguating a multi-subject classroom). */
  subjectId?: string
}

async function createAssignment(ctx: AgentContext, args: CreateAssignmentArgs) {
  const { client, teacherId } = ctx
  await requireOwnedClassroom(client, args.classroomId)
  if (args.maxScore <= 0) throw new ValidationError('คะแนนเต็มต้องมากกว่า 0')

  const subject = await resolveSubjectForClassroom(client, args.classroomId, args.subjectId)

  // Plain insert, identical shape to assignment-service.ts's own
  // createAssignment — assignments_insert_own (0006) is the actual
  // authorization boundary (ownership of both classroom and subject,
  // and the subject/classroom link), enforced by the database via the
  // caller's own RLS-scoped client, not by this handler. No
  // assignment_submissions row is created by this insert (submissions
  // are created lazily per-student elsewhere in the app) — so this tool
  // can never create student data, matching the ticket's "no student
  // submissions/scores are created" requirement.
  const { data, error } = await client
    .from('assignments')
    .insert({
      subject_id: subject.subjectId,
      classroom_id: args.classroomId,
      title: args.title,
      description: args.description ?? null,
      max_score: args.maxScore,
      due_date: args.dueDate ?? null,
      created_by: teacherId,
    })
    .select('id, title, description, max_score, due_date, is_archived')
    .single()
  if (error) throw error

  return {
    assignmentId: data.id,
    classroomId: args.classroomId,
    subjectId: subject.subjectId,
    subjectName: subject.subjectName,
    title: data.title,
    description: data.description,
    maxScore: data.max_score,
    dueDate: data.due_date,
    isArchived: data.is_archived,
  }
}

export const createAssignmentTool: AgentTool<CreateAssignmentArgs> = {
  name: 'create_assignment',
  description:
    'Creates a new, non-archived assignment in a classroom the calling teacher owns. Creates no student submissions or scores.',
  inputSchema: {
    type: 'object',
    properties: {
      classroomId: { type: 'string', format: 'uuid' },
      title: { type: 'string' },
      description: { type: 'string' },
      maxScore: { type: 'number', minimum: 0.01 },
      dueDate: { type: 'string', format: 'date' },
      subjectId: {
        type: 'string',
        format: 'uuid',
        description: 'Required only if the classroom is linked to more than one subject.',
      },
    },
    required: ['classroomId', 'title', 'maxScore'],
  },
  handler: (ctx, args) => createAssignment(ctx, args),
}

// ==================================================
// 7. copy_assignment_to_classrooms
// ==================================================

interface CopyAssignmentArgs {
  assignmentId: string
  targetClassroomIds: string[]
}

async function copyAssignmentToClassrooms(ctx: AgentContext, args: CopyAssignmentArgs) {
  const { client, teacherId } = ctx
  const source = await requireOwnedAssignment(client, args.assignmentId)

  const { data: resources, error: resourcesError } = await client
    .from('assignment_resources')
    .select('resource_type, title, url, mime_type, drive_file_id, sort_order')
    .eq('assignment_id', args.assignmentId)
  if (resourcesError) throw resourcesError
  // Only 'link' resources (URLs, including Google Drive references) are
  // copied here — Phase 1's agent tool never touches Supabase Storage
  // directly (see the ticket's "never allow arbitrary Storage access"),
  // so a 'file' resource is intentionally skipped rather than copying
  // the underlying object. This never touches a teacher's original
  // Google Drive file either way — a Drive resource is only ever a URL
  // reference row, exactly like every other permanent-delete/copy path
  // in this codebase.
  const linkResources = ((resources ?? []) as any[]).filter((r) => r.resource_type === 'link')

  const results = await Promise.all(
    args.targetClassroomIds.map(async (targetClassroomId) => {
      try {
        await requireOwnedClassroom(client, targetClassroomId)
        const subject = await resolveSubjectForClassroom(client, targetClassroomId, source.subject_id)

        const { data: created, error: createError } = await client
          .from('assignments')
          .insert({
            subject_id: subject.subjectId,
            classroom_id: targetClassroomId,
            title: source.title,
            description: source.description,
            max_score: source.max_score,
            due_date: source.due_date,
            created_by: teacherId,
          })
          .select('id')
          .single()
        if (createError) throw createError

        for (const resource of linkResources) {
          const { error: resourceError } = await client.from('assignment_resources').insert({
            assignment_id: created.id,
            resource_type: 'link',
            title: resource.title,
            url: resource.url,
            mime_type: resource.mime_type,
            drive_file_id: resource.drive_file_id,
            sort_order: resource.sort_order,
            created_by: teacherId,
          })
          if (resourceError) throw resourceError
        }

        // No assignment_submissions row is ever created here — matching
        // the ticket's "no submissions/scores copied" requirement, and
        // identical to copyAssignmentToClassrooms in assignment-service.ts.
        return { classroomId: targetClassroomId, ok: true, assignmentId: created.id as string }
      } catch (err) {
        return {
          classroomId: targetClassroomId,
          ok: false,
          error: err instanceof Error ? err.message : 'ไม่สามารถคัดลอกงานไปยังห้องเรียนนี้ได้',
        }
      }
    }),
  )

  return {
    sourceAssignmentId: source.id,
    sourceTitle: source.title,
    results,
  }
}

export const copyAssignmentToClassroomsTool: AgentTool<CopyAssignmentArgs> = {
  name: 'copy_assignment_to_classrooms',
  description:
    'Copies an assignment (title/description/max score/due date/link resources) into one or more other classrooms the calling teacher owns. Never copies submissions or scores. Each target classroom is independent — one failing never blocks or rolls back the others.',
  inputSchema: {
    type: 'object',
    properties: {
      assignmentId: { type: 'string', format: 'uuid' },
      targetClassroomIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
    },
    required: ['assignmentId', 'targetClassroomIds'],
  },
  handler: (ctx, args) => copyAssignmentToClassrooms(ctx, args),
}

// ==================================================
// 8. mark_attendance_bulk
// ==================================================

const ATTENDANCE_STATUS_VALUES = ['present', 'late', 'leave', 'absent'] as const

interface AttendanceUpdateInput {
  studentId: string
  status: (typeof ATTENDANCE_STATUS_VALUES)[number]
  note?: string
}

interface MarkAttendanceBulkArgs {
  classroomId: string
  date: string
  updates: AttendanceUpdateInput[]
  subjectId?: string
  periodNumber?: number
}

async function markAttendanceBulk(ctx: AgentContext, args: MarkAttendanceBulkArgs) {
  const { client } = ctx
  await requireOwnedClassroom(client, args.classroomId)
  if (args.updates.length === 0) throw new ValidationError('กรุณาระบุรายการเช็คชื่ออย่างน้อย 1 รายการ')

  // Delegates ENTIRELY to save_attendance_session (0005) via the
  // caller's own RLS-scoped client — the exact same RPC
  // attendance-service.ts's saveAttendance calls from the browser app.
  // That function already: verifies classroom (and, when subjectId is
  // given, subject + subject-classroom link) ownership from auth.uid()
  // itself; validates each status against the same 4-value check
  // constraint; verifies each student is a CURRENT member of this
  // classroom before writing a record; and upserts on
  // (attendance_session_id, student_id) — so calling this tool twice
  // with the same date/classroom/records updates the same rows instead
  // of creating duplicates (reasonably idempotent, per the ticket).
  const { data, error } = await client.rpc('save_attendance_session', {
    p_classroom_id: args.classroomId,
    p_attendance_date: args.date,
    p_records: args.updates.map((u) => ({ student_id: u.studentId, status: u.status, note: u.note ?? null })),
    p_subject_id: args.subjectId ?? null,
    p_period_number: args.periodNumber ?? null,
  })
  if (error) throw error

  const session = data as { id: string; classroom_id: string; subject_id: string | null; attendance_date: string }

  return {
    sessionId: session.id,
    classroomId: session.classroom_id,
    subjectId: session.subject_id,
    date: session.attendance_date,
    changedCount: args.updates.length,
  }
}

export const markAttendanceBulkTool: AgentTool<MarkAttendanceBulkArgs> = {
  name: 'mark_attendance_bulk',
  description:
    'Records/updates attendance for one or more students in one classroom on one date, via the existing save_attendance_session database rule (idempotent upsert, explicit statuses only, classroom-membership checked per student).',
  inputSchema: {
    type: 'object',
    properties: {
      classroomId: { type: 'string', format: 'uuid' },
      date: { type: 'string', format: 'date' },
      subjectId: { type: 'string', format: 'uuid', description: 'Omit for homeroom attendance.' },
      periodNumber: { type: 'integer', minimum: 1 },
      updates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            studentId: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ATTENDANCE_STATUS_VALUES },
            note: { type: 'string' },
          },
          required: ['studentId', 'status'],
        },
      },
    },
    required: ['classroomId', 'date', 'updates'],
  },
  handler: (ctx, args) => markAttendanceBulk(ctx, args),
}

export const writeTools: AgentTool<any>[] = [createAssignmentTool, copyAssignmentToClassroomsTool, markAttendanceBulkTool]
