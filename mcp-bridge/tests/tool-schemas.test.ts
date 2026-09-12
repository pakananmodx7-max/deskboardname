import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { ALL_TOOL_NAMES, READ_TOOL_NAMES, WRITE_TOOL_NAMES, toolSchemas } from '../src/tool-schemas.js'

const UUID = '11111111-1111-1111-1111-111111111111'
const UUID_2 = '22222222-2222-2222-2222-222222222222'

describe('toolSchemas — exactly the 8 tools from the Edge Function registry (5 read + 3 write)', () => {
  it('lists exactly these 5 read tool names', () => {
    expect(new Set(READ_TOOL_NAMES)).toEqual(
      new Set(['list_classrooms', 'list_assignments', 'get_missing_submissions', 'get_classroom_summary', 'get_student_summary']),
    )
  })

  it('lists exactly these 3 write tool names', () => {
    expect(new Set(WRITE_TOOL_NAMES)).toEqual(
      new Set(['create_assignment', 'copy_assignment_to_classrooms', 'mark_attendance_bulk']),
    )
  })

  it('ALL_TOOL_NAMES is exactly the union of read and write, 8 total, no overlap', () => {
    expect(ALL_TOOL_NAMES).toHaveLength(8)
    expect(new Set(ALL_TOOL_NAMES)).toEqual(new Set([...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES]))
    for (const writeTool of WRITE_TOOL_NAMES) {
      expect(READ_TOOL_NAMES).not.toContain(writeTool)
    }
  })

  it('toolSchemas itself has exactly these 8 keys — nothing registered that isn\'t named here', () => {
    expect(Object.keys(toolSchemas).sort()).toEqual([...ALL_TOOL_NAMES].sort())
  })

  it('no delete/destroy tool exists anywhere in this list — the Edge Function has no delete capability', () => {
    expect(ALL_TOOL_NAMES.some((name) => name.startsWith('delete_'))).toBe(false)
  })
})

describe('toolSchemas — READ argument shapes match the deployed Edge Function\'s contract', () => {
  it('list_classrooms: only an optional subjectId', () => {
    const shape = z.object(toolSchemas.list_classrooms.input)
    expect(shape.safeParse({}).success).toBe(true)
    expect(shape.safeParse({ subjectId: UUID }).success).toBe(true)
    expect(shape.safeParse({ subjectId: 'not-a-uuid' }).success).toBe(false)
  })

  it('list_assignments: classroomId required, status is one of active|archived|all', () => {
    const shape = z.object(toolSchemas.list_assignments.input)
    expect(shape.safeParse({}).success).toBe(false)
    expect(shape.safeParse({ classroomId: UUID }).success).toBe(true)
    expect(shape.safeParse({ classroomId: UUID, status: 'archived' }).success).toBe(true)
    expect(shape.safeParse({ classroomId: UUID, status: 'deleted' }).success).toBe(false)
  })

  it('get_missing_submissions: assignmentId required', () => {
    const shape = z.object(toolSchemas.get_missing_submissions.input)
    expect(shape.safeParse({}).success).toBe(false)
    expect(shape.safeParse({ assignmentId: UUID }).success).toBe(true)
  })

  it('get_classroom_summary: classroomId required; 3 optional numeric thresholds', () => {
    const shape = z.object(toolSchemas.get_classroom_summary.input)
    expect(shape.safeParse({}).success).toBe(false)
    const valid = {
      classroomId: UUID,
      attendanceThresholdPercent: 75,
      missingAssignmentsThreshold: 3,
      scoreThresholdPercent: 60,
    }
    expect(shape.safeParse(valid).success).toBe(true)
    expect(shape.safeParse({ ...valid, missingAssignmentsThreshold: 1.5 }).success).toBe(false) // must be an integer
    expect(shape.safeParse({ ...valid, attendanceThresholdPercent: -1 }).success).toBe(false) // must be >= 0
  })

  it('get_student_summary: studentId required; classroomId/subjectId optional', () => {
    const shape = z.object(toolSchemas.get_student_summary.input)
    expect(shape.safeParse({}).success).toBe(false)
    expect(shape.safeParse({ studentId: UUID }).success).toBe(true)
    expect(shape.safeParse({ studentId: UUID, classroomId: UUID_2, subjectId: UUID_2 }).success).toBe(true)
  })
})

describe('toolSchemas — WRITE argument shapes match write-tools.ts\'s contract exactly', () => {
  it('create_assignment: classroomId/title/maxScore required; description/dueDate/subjectId optional', () => {
    const shape = z.object(toolSchemas.create_assignment.input)
    expect(shape.safeParse({}).success).toBe(false)
    expect(shape.safeParse({ classroomId: UUID, title: 'งาน 1' }).success).toBe(false) // maxScore missing
    expect(shape.safeParse({ classroomId: UUID, title: 'งาน 1', maxScore: 100 }).success).toBe(true)
    expect(
      shape.safeParse({
        classroomId: UUID,
        title: 'งาน 1',
        maxScore: 100,
        description: 'รายละเอียด',
        dueDate: '2026-10-01',
        subjectId: UUID_2,
      }).success,
    ).toBe(true)
  })

  it('create_assignment: maxScore must be a positive number (minimum 0.01, matching write-tools.ts)', () => {
    const shape = z.object(toolSchemas.create_assignment.input)
    expect(shape.safeParse({ classroomId: UUID, title: 'x', maxScore: 0 }).success).toBe(false)
    expect(shape.safeParse({ classroomId: UUID, title: 'x', maxScore: -5 }).success).toBe(false)
    expect(shape.safeParse({ classroomId: UUID, title: 'x', maxScore: 0.01 }).success).toBe(true)
  })

  it('create_assignment: dueDate must be a plain date string, not an arbitrary string', () => {
    const shape = z.object(toolSchemas.create_assignment.input)
    expect(shape.safeParse({ classroomId: UUID, title: 'x', maxScore: 1, dueDate: '2026-10-01' }).success).toBe(true)
    expect(shape.safeParse({ classroomId: UUID, title: 'x', maxScore: 1, dueDate: 'next tuesday' }).success).toBe(false)
  })

  it('create_assignment: classroomId must be a uuid, never an arbitrary string', () => {
    const shape = z.object(toolSchemas.create_assignment.input)
    expect(shape.safeParse({ classroomId: 'not-a-uuid', title: 'x', maxScore: 1 }).success).toBe(false)
  })

  it('copy_assignment_to_classrooms: assignmentId + targetClassroomIds required, target ids must each be uuids', () => {
    const shape = z.object(toolSchemas.copy_assignment_to_classrooms.input)
    expect(shape.safeParse({}).success).toBe(false)
    expect(shape.safeParse({ assignmentId: UUID }).success).toBe(false) // targetClassroomIds missing
    expect(shape.safeParse({ assignmentId: UUID, targetClassroomIds: [] }).success).toBe(true)
    expect(shape.safeParse({ assignmentId: UUID, targetClassroomIds: [UUID_2] }).success).toBe(true)
    expect(shape.safeParse({ assignmentId: UUID, targetClassroomIds: ['not-a-uuid'] }).success).toBe(false)
    expect(shape.safeParse({ assignmentId: UUID, targetClassroomIds: 'not-an-array' }).success).toBe(false)
  })

  it('mark_attendance_bulk: classroomId/date/updates required; subjectId/periodNumber optional', () => {
    const shape = z.object(toolSchemas.mark_attendance_bulk.input)
    expect(shape.safeParse({}).success).toBe(false)
    expect(shape.safeParse({ classroomId: UUID, date: '2026-09-12' }).success).toBe(false) // updates missing
    expect(shape.safeParse({ classroomId: UUID, date: '2026-09-12', updates: [] }).success).toBe(true)
    expect(
      shape.safeParse({
        classroomId: UUID,
        date: '2026-09-12',
        updates: [{ studentId: UUID_2, status: 'present' }],
        subjectId: UUID_2,
        periodNumber: 1,
      }).success,
    ).toBe(true)
  })

  it('mark_attendance_bulk: date must be a plain date string, not an arbitrary string', () => {
    const shape = z.object(toolSchemas.mark_attendance_bulk.input)
    expect(shape.safeParse({ classroomId: UUID, date: 'yesterday', updates: [] }).success).toBe(false)
  })

  it('mark_attendance_bulk: each update requires studentId + status; note is optional', () => {
    const shape = z.object(toolSchemas.mark_attendance_bulk.input)
    expect(shape.safeParse({ classroomId: UUID, date: '2026-09-12', updates: [{ studentId: UUID_2 }] }).success).toBe(false) // status missing
    expect(shape.safeParse({ classroomId: UUID, date: '2026-09-12', updates: [{ status: 'present' }] }).success).toBe(false) // studentId missing
    expect(
      shape.safeParse({
        classroomId: UUID,
        date: '2026-09-12',
        updates: [{ studentId: UUID_2, status: 'present', note: 'มาสาย 5 นาที' }],
      }).success,
    ).toBe(true)
  })

  it('mark_attendance_bulk: preserves exactly the 4 allowed attendance status values from write-tools.ts, no others', () => {
    const shape = z.object(toolSchemas.mark_attendance_bulk.input)
    for (const status of ['present', 'late', 'leave', 'absent']) {
      expect(shape.safeParse({ classroomId: UUID, date: '2026-09-12', updates: [{ studentId: UUID_2, status }] }).success).toBe(
        true,
      )
    }
    for (const invalidStatus of ['excused', 'sick', 'unknown', '']) {
      expect(
        shape.safeParse({ classroomId: UUID, date: '2026-09-12', updates: [{ studentId: UUID_2, status: invalidStatus }] })
          .success,
      ).toBe(false)
    }
  })

  it('mark_attendance_bulk: periodNumber must be a positive integer when given', () => {
    const shape = z.object(toolSchemas.mark_attendance_bulk.input)
    expect(shape.safeParse({ classroomId: UUID, date: '2026-09-12', updates: [], periodNumber: 0 }).success).toBe(false)
    expect(shape.safeParse({ classroomId: UUID, date: '2026-09-12', updates: [], periodNumber: 1.5 }).success).toBe(false)
    expect(shape.safeParse({ classroomId: UUID, date: '2026-09-12', updates: [], periodNumber: 2 }).success).toBe(true)
  })
})

describe('toolSchemas — descriptions and safety annotations', () => {
  it('every tool (read and write) has a description longer than 10 characters', () => {
    for (const name of ALL_TOOL_NAMES) {
      expect(toolSchemas[name].description.length).toBeGreaterThan(10)
    }
  })

  it('every write tool description starts with an explicit mutation warning', () => {
    for (const name of WRITE_TOOL_NAMES) {
      expect(toolSchemas[name].description).toMatch(/^\[WRITE — mutates production data\]/)
    }
  })

  it('every write tool description, after the warning prefix, matches write-tools.ts\'s own description verbatim', () => {
    expect(toolSchemas.create_assignment.description).toContain(
      'Creates a new, non-archived assignment in a classroom the calling teacher owns. Creates no student submissions or scores.',
    )
    expect(toolSchemas.copy_assignment_to_classrooms.description).toContain(
      'Copies an assignment (title/description/max score/due date/link resources) into one or more other classrooms the calling teacher owns. Never copies submissions or scores.',
    )
    expect(toolSchemas.mark_attendance_bulk.description).toContain(
      'Records/updates attendance for one or more students in one classroom on one date',
    )
  })

  it('no read tool description carries the write warning', () => {
    for (const name of READ_TOOL_NAMES) {
      expect(toolSchemas[name].description).not.toMatch(/\[WRITE/)
    }
  })

  it('read tools are annotated readOnlyHint: true; write tools readOnlyHint: false', () => {
    for (const name of READ_TOOL_NAMES) {
      expect(toolSchemas[name].annotations.readOnlyHint).toBe(true)
    }
    for (const name of WRITE_TOOL_NAMES) {
      expect(toolSchemas[name].annotations.readOnlyHint).toBe(false)
    }
  })
})
