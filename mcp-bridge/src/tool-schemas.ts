import { z } from 'zod'

/**
 * The 5 READ tools' argument shapes and descriptions, copied verbatim
 * (field names, required-ness, uuid/enum/number constraints, and
 * descriptions) from the deployed Edge Function's own registry —
 * supabase/functions/teacher-agent-tools/tools/read-tools.ts's
 * `inputSchema` blocks and `description` strings.
 *
 * This is NOT the authoritative validator: the Edge Function itself
 * (via _shared/tool-schema.ts's validateArgs) is and remains the only
 * place argument validation is actually enforced — a Deno file cannot
 * be imported into this Node package, so mirroring the contract here
 * (in the MCP SDK's own zod-based input format, which the Deno
 * function's plain-JSON-Schema format can't be imported as either) is
 * the closest a thin protocol adapter can get to "reuse, don't
 * duplicate": the bridge adds no business rule of its own, it only
 * describes the same contract to the MCP client so Hermes can build
 * correct calls. Any drift between this file and the Edge Function is
 * caught by the request itself — an argument this file wrongly allowed
 * through still gets rejected server-side with a normal `invalid_arguments`
 * error, exactly as if the bridge had forwarded it as-is.
 *
 * WRITE tools (create_assignment, copy_assignment_to_classrooms,
 * mark_attendance_bulk) are deliberately NOT listed here — see
 * server.ts, which registers ONLY the entries in this object.
 */

const ASSIGNMENT_STATUS_VALUES = ['active', 'archived', 'all'] as const

export const toolSchemas = {
  list_classrooms: {
    description:
      "Lists the calling teacher's own classrooms (optionally filtered to one subject), each with its linked subjects and current student count.",
    input: {
      subjectId: z.string().uuid().optional().describe('Only classrooms linked to this subject.'),
    },
  },
  list_assignments: {
    description:
      "Lists a classroom's assignments (default: active only) with submission/pending/late counts derived from that classroom's current roster.",
    input: {
      classroomId: z.string().uuid(),
      status: z.enum(ASSIGNMENT_STATUS_VALUES).optional().describe('active (default) | archived | all'),
    },
  },
  get_missing_submissions: {
    description: 'Lists the students in an assignment\'s classroom who have not submitted (or been marked "late") it.',
    input: {
      assignmentId: z.string().uuid(),
    },
  },
  get_classroom_summary: {
    description:
      'Classroom-level dashboard: student count, attendance/assignment/score summaries, and students needing attention under simple, transparent, documented rules (never opaque AI scoring).',
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
} as const

export type ToolName = keyof typeof toolSchemas

export const READ_TOOL_NAMES: readonly ToolName[] = Object.keys(toolSchemas) as ToolName[]

/** Tool names this bridge must NEVER register — used by a test to keep
 * this list honest if the write tools' names ever change upstream. */
export const EXCLUDED_WRITE_TOOL_NAMES = [
  'create_assignment',
  'copy_assignment_to_classrooms',
  'mark_attendance_bulk',
] as const
