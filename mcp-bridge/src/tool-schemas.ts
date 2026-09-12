import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

/**
 * All 8 tools' argument shapes, descriptions, and MCP annotations,
 * copied verbatim (field names, required-ness, uuid/enum/number
 * constraints, descriptions) from the deployed Edge Function's own
 * registry — supabase/functions/teacher-agent-tools/tools/read-tools.ts
 * and tools/write-tools.ts's `inputSchema` blocks and `description`
 * strings.
 *
 * This is NOT the authoritative validator: the Edge Function itself
 * (via _shared/tool-schema.ts's validateArgs, and — for the 3 write
 * tools — the actual RLS-scoped database operations in write-tools.ts)
 * is and remains the only place argument validation AND authorization
 * are actually enforced. A Deno file cannot be imported into this Node
 * package, so mirroring the contract here (in the MCP SDK's own
 * zod-based input format, which the Deno function's plain-JSON-Schema
 * format can't be imported as either) is the closest a thin protocol
 * adapter can get to "reuse, don't duplicate": the bridge adds no
 * business rule, ownership check, or write behavior of its own — every
 * write still goes through EdgeFunctionClient -> the same authenticated
 * teacher-agent-tools Edge Function -> the same RLS-scoped Postgres
 * client as every read. Any drift between this file and the Edge
 * Function is caught by the request itself: an argument this file
 * wrongly allowed through still gets rejected server-side with a normal
 * `invalid_arguments` error, and a classroom/assignment/student id this
 * file didn't reject still gets refused server-side with `forbidden` or
 * `not_found` if the calling teacher doesn't actually own it — exactly
 * as if the bridge had forwarded it as-is, because that is exactly what
 * happens.
 *
 * WRITE TOOLS (create_assignment, copy_assignment_to_classrooms,
 * mark_attendance_bulk) mutate real production data through the same
 * production Edge Function every read tool uses. Each one's
 * `description` below is prefixed with an explicit "[WRITE — mutates
 * production data]" marker (kept separate from the verbatim upstream
 * description that follows it) so an agent reading the tool list sees,
 * unambiguously, which of the 8 tools can change data before ever
 * calling one. Their `annotations` (readOnlyHint/destructiveHint/
 * idempotentHint) are the standard MCP mechanism for the same signal,
 * for any client that reads annotations rather than (or in addition to)
 * the description text. No delete/destroy tool is registered — none
 * exists in the Edge Function's own registry.
 */

const ASSIGNMENT_STATUS_VALUES = ['active', 'archived', 'all'] as const
const ATTENDANCE_STATUS_VALUES = ['present', 'late', 'leave', 'absent'] as const

const READ_ONLY_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

const WRITE_WARNING_PREFIX = '[WRITE — mutates production data] '

export const toolSchemas = {
  // ==================================================
  // READ TOOLS — unchanged from the initial bridge
  // ==================================================
  list_classrooms: {
    description:
      "Lists the calling teacher's own classrooms (optionally filtered to one subject), each with its linked subjects and current student count.",
    annotations: READ_ONLY_ANNOTATIONS,
    input: {
      subjectId: z.string().uuid().optional().describe('Only classrooms linked to this subject.'),
    },
  },
  list_assignments: {
    description:
      "Lists a classroom's assignments (default: active only) with submission/pending/late counts derived from that classroom's current roster.",
    annotations: READ_ONLY_ANNOTATIONS,
    input: {
      classroomId: z.string().uuid(),
      status: z.enum(ASSIGNMENT_STATUS_VALUES).optional().describe('active (default) | archived | all'),
    },
  },
  get_missing_submissions: {
    description: 'Lists the students in an assignment\'s classroom who have not submitted (or been marked "late") it.',
    annotations: READ_ONLY_ANNOTATIONS,
    input: {
      assignmentId: z.string().uuid(),
    },
  },
  get_classroom_summary: {
    description:
      'Classroom-level dashboard: student count, attendance/assignment/score summaries, and students needing attention under simple, transparent, documented rules (never opaque AI scoring).',
    annotations: READ_ONLY_ANNOTATIONS,
    input: {
      classroomId: z.string().uuid(),
      attendanceThresholdPercent: z.number().min(0).optional().describe('Default 80.'),
      missingAssignmentsThreshold: z.number().int().min(1).optional().describe('Default 2.'),
      scoreThresholdPercent: z.number().min(0).optional().describe('Default 50.'),
    },
  },
  get_student_summary: {
    description:
      'Concise per-student summary (attendance rate, assignment completion, missing assignments, average score, recent submissions) scoped to classrooms the calling teacher owns.',
    annotations: READ_ONLY_ANNOTATIONS,
    input: {
      studentId: z.string().uuid(),
      classroomId: z
        .string()
        .uuid()
        .optional()
        .describe('Disambiguates when a student is in more than one of your classrooms.'),
      subjectId: z.string().uuid().optional().describe('Scopes attendance/assignments to one subject only.'),
    },
  },

  // ==================================================
  // WRITE TOOLS — mutate production data. Each still requires the
  // calling teacher to own the classroom/assignment/subject involved;
  // that check happens server-side, in the Edge Function, exactly as
  // for every read tool — this bridge adds no authorization logic.
  // ==================================================
  create_assignment: {
    description:
      WRITE_WARNING_PREFIX +
      'Creates a new, non-archived assignment in a classroom the calling teacher owns. Creates no student submissions or scores.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      // Not idempotent: calling this twice with identical arguments
      // creates two separate assignments, matching write-tools.ts's own
      // plain insert (no natural unique key to upsert against).
      idempotentHint: false,
      openWorldHint: false,
    } satisfies ToolAnnotations,
    input: {
      classroomId: z.string().uuid(),
      title: z.string(),
      description: z.string().optional(),
      maxScore: z.number().min(0.01),
      dueDate: z.string().date().optional(),
      subjectId: z
        .string()
        .uuid()
        .optional()
        .describe('Required only if the classroom is linked to more than one subject.'),
    },
  },
  copy_assignment_to_classrooms: {
    description:
      WRITE_WARNING_PREFIX +
      'Copies an assignment (title/description/max score/due date/link resources) into one or more other classrooms the calling teacher owns. Never copies submissions or scores. Each target classroom is independent — one failing never blocks or rolls back the others.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      // Not idempotent: each call creates new assignment copies, same
      // reasoning as create_assignment above.
      idempotentHint: false,
      openWorldHint: false,
    } satisfies ToolAnnotations,
    input: {
      assignmentId: z.string().uuid(),
      targetClassroomIds: z.array(z.string().uuid()),
    },
  },
  mark_attendance_bulk: {
    description:
      WRITE_WARNING_PREFIX +
      'Records/updates attendance for one or more students in one classroom on one date, via the existing save_attendance_session database rule (idempotent upsert, explicit statuses only, classroom-membership checked per student).',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      // Idempotent BY DESIGN: save_attendance_session (the Edge
      // Function's own RPC call) upserts on (session, student), so
      // resubmitting the exact same classroom/date/updates updates the
      // same rows rather than creating duplicates — see
      // write-tools.ts's own doc comment on markAttendanceBulk.
      idempotentHint: true,
      openWorldHint: false,
    } satisfies ToolAnnotations,
    input: {
      classroomId: z.string().uuid(),
      date: z.string().date(),
      subjectId: z.string().uuid().optional().describe('Omit for homeroom attendance.'),
      periodNumber: z.number().int().min(1).optional(),
      updates: z.array(
        z.object({
          studentId: z.string().uuid(),
          status: z.enum(ATTENDANCE_STATUS_VALUES),
          note: z.string().optional(),
        }),
      ),
    },
  },
} as const

export type ToolName = keyof typeof toolSchemas

export const ALL_TOOL_NAMES: readonly ToolName[] = Object.keys(toolSchemas) as ToolName[]

export const READ_TOOL_NAMES = [
  'list_classrooms',
  'list_assignments',
  'get_missing_submissions',
  'get_classroom_summary',
  'get_student_summary',
] as const satisfies readonly ToolName[]

export const WRITE_TOOL_NAMES = [
  'create_assignment',
  'copy_assignment_to_classrooms',
  'mark_attendance_bulk',
] as const satisfies readonly ToolName[]
