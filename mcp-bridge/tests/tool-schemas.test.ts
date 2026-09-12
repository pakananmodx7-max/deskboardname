import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { EXCLUDED_WRITE_TOOL_NAMES, READ_TOOL_NAMES, toolSchemas } from '../src/tool-schemas.js'

describe('toolSchemas — exactly the 5 read tools from the Edge Function registry', () => {
  it('lists exactly these 5 names, in no particular order requirement', () => {
    expect(new Set(READ_TOOL_NAMES)).toEqual(
      new Set(['list_classrooms', 'list_assignments', 'get_missing_submissions', 'get_classroom_summary', 'get_student_summary']),
    )
  })

  it('never overlaps with the write tool names', () => {
    for (const writeTool of EXCLUDED_WRITE_TOOL_NAMES) {
      expect(READ_TOOL_NAMES).not.toContain(writeTool)
    }
  })
})

describe('toolSchemas — argument shapes match the deployed Edge Function\'s contract', () => {
  it('list_classrooms: only an optional subjectId', () => {
    const shape = z.object(toolSchemas.list_classrooms.input)
    expect(shape.safeParse({}).success).toBe(true)
    expect(shape.safeParse({ subjectId: '11111111-1111-1111-1111-111111111111' }).success).toBe(true)
    expect(shape.safeParse({ subjectId: 'not-a-uuid' }).success).toBe(false)
  })

  it('list_assignments: classroomId required, status is one of active|archived|all', () => {
    const shape = z.object(toolSchemas.list_assignments.input)
    expect(shape.safeParse({}).success).toBe(false)
    expect(shape.safeParse({ classroomId: '11111111-1111-1111-1111-111111111111' }).success).toBe(true)
    expect(shape.safeParse({ classroomId: '11111111-1111-1111-1111-111111111111', status: 'archived' }).success).toBe(true)
    expect(shape.safeParse({ classroomId: '11111111-1111-1111-1111-111111111111', status: 'deleted' }).success).toBe(false)
  })

  it('get_missing_submissions: assignmentId required', () => {
    const shape = z.object(toolSchemas.get_missing_submissions.input)
    expect(shape.safeParse({}).success).toBe(false)
    expect(shape.safeParse({ assignmentId: '11111111-1111-1111-1111-111111111111' }).success).toBe(true)
  })

  it('get_classroom_summary: classroomId required; 3 optional numeric thresholds', () => {
    const shape = z.object(toolSchemas.get_classroom_summary.input)
    expect(shape.safeParse({}).success).toBe(false)
    const valid = {
      classroomId: '11111111-1111-1111-1111-111111111111',
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
    expect(shape.safeParse({ studentId: '11111111-1111-1111-1111-111111111111' }).success).toBe(true)
    expect(
      shape.safeParse({
        studentId: '11111111-1111-1111-1111-111111111111',
        classroomId: '22222222-2222-2222-2222-222222222222',
        subjectId: '33333333-3333-3333-3333-333333333333',
      }).success,
    ).toBe(true)
  })
})

describe('toolSchemas — every entry carries a non-empty description (shown to Hermes/the teacher)', () => {
  it('has a description for every tool', () => {
    for (const name of READ_TOOL_NAMES) {
      expect(toolSchemas[name].description.length).toBeGreaterThan(10)
    }
  })
})
