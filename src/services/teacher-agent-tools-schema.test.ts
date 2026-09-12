import { describe, expect, it } from 'vitest'

import {
  toJsonSchema,
  validateArgs,
  type ToolInputSchema,
} from '../../supabase/functions/_shared/tool-schema'

// ==================================================
// Real, executed unit tests for the Teacher Agent Tool Layer's argument
// validator (supabase/functions/_shared/tool-schema.ts). This file has
// zero Deno-only dependencies (no `Deno.*`, no `npm:` specifier), so —
// unlike the Deno Edge Function files themselves — it can be imported
// and actually run under Vitest/Node, giving real behavioral coverage
// of "malformed arguments" rather than only a source-text guard.
// ==================================================

const classroomSchema: ToolInputSchema = {
  type: 'object',
  properties: { classroomId: { type: 'string', format: 'uuid' } },
  required: ['classroomId'],
}

const VALID_UUID = '11111111-1111-1111-1111-111111111111'

describe('validateArgs — required fields', () => {
  it('accepts a valid required uuid field', () => {
    expect(validateArgs(classroomSchema, { classroomId: VALID_UUID }).ok).toBe(true)
  })

  it('rejects a missing required field', () => {
    const result = validateArgs(classroomSchema, {})
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('classroomId'))).toBe(true)
  })

  it('rejects a null value for a required field the same as missing', () => {
    const result = validateArgs(classroomSchema, { classroomId: null })
    expect(result.ok).toBe(false)
  })

  it('rejects args that are not an object at all (string/array/number)', () => {
    expect(validateArgs(classroomSchema, 'nope' as unknown).ok).toBe(false)
    expect(validateArgs(classroomSchema, [] as unknown).ok).toBe(false)
    expect(validateArgs(classroomSchema, 42 as unknown).ok).toBe(false)
  })
})

describe('validateArgs — type/format checking', () => {
  it('rejects a non-string value where a string is required', () => {
    expect(validateArgs(classroomSchema, { classroomId: 123 }).ok).toBe(false)
  })

  it('rejects a string that is not a valid UUID when format is "uuid"', () => {
    expect(validateArgs(classroomSchema, { classroomId: 'not-a-uuid' }).ok).toBe(false)
  })

  it('rejects an invalid date and accepts a valid one for format "date"', () => {
    const schema: ToolInputSchema = { type: 'object', properties: { date: { type: 'string', format: 'date' } } }
    expect(validateArgs(schema, { date: '2026-09-01' }).ok).toBe(true)
    expect(validateArgs(schema, { date: '09/01/2026' }).ok).toBe(false)
  })

  it('rejects a value outside an enum and accepts one inside it', () => {
    const schema: ToolInputSchema = {
      type: 'object',
      properties: { status: { type: 'string', enum: ['active', 'archived'] } },
    }
    expect(validateArgs(schema, { status: 'active' }).ok).toBe(true)
    expect(validateArgs(schema, { status: 'deleted' }).ok).toBe(false)
  })

  it('enforces integer vs plain number, and a numeric minimum', () => {
    const schema: ToolInputSchema = {
      type: 'object',
      properties: {
        periodNumber: { type: 'integer', minimum: 1 },
        maxScore: { type: 'number', minimum: 0.01 },
      },
    }
    expect(validateArgs(schema, { periodNumber: 3 }).ok).toBe(true)
    expect(validateArgs(schema, { periodNumber: 1.5 }).ok).toBe(false)
    expect(validateArgs(schema, { periodNumber: 0 }).ok).toBe(false)
    expect(validateArgs(schema, { maxScore: 0 }).ok).toBe(false)
    expect(validateArgs(schema, { maxScore: 100 }).ok).toBe(true)
  })

  it('rejects an unknown top-level field — a tool\'s surface is exactly what it declares', () => {
    const result = validateArgs(classroomSchema, { classroomId: VALID_UUID, extraField: 'nope' })
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('extraField'))).toBe(true)
  })
})

describe('validateArgs — arrays and nested objects (mark_attendance_bulk\'s shape)', () => {
  const attendanceSchema: ToolInputSchema = {
    type: 'object',
    properties: {
      classroomId: { type: 'string', format: 'uuid' },
      date: { type: 'string', format: 'date' },
      updates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            studentId: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['present', 'late', 'leave', 'absent'] },
          },
          required: ['studentId', 'status'],
        },
      },
    },
    required: ['classroomId', 'date', 'updates'],
  }

  it('accepts a well-formed array of update objects', () => {
    const result = validateArgs(attendanceSchema, {
      classroomId: VALID_UUID,
      date: '2026-09-01',
      updates: [{ studentId: VALID_UUID, status: 'present' }],
    })
    expect(result.ok).toBe(true)
  })

  it('rejects an array item with an invalid enum status, naming the offending index', () => {
    const result = validateArgs(attendanceSchema, {
      classroomId: VALID_UUID,
      date: '2026-09-01',
      updates: [{ studentId: VALID_UUID, status: 'sick' }],
    })
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('updates[0]'))).toBe(true)
  })

  it('rejects a non-array value for an array-typed field', () => {
    const result = validateArgs(attendanceSchema, { classroomId: VALID_UUID, date: '2026-09-01', updates: 'nope' })
    expect(result.ok).toBe(false)
  })

  it('rejects an array item missing its own required field', () => {
    const result = validateArgs(attendanceSchema, {
      classroomId: VALID_UUID,
      date: '2026-09-01',
      updates: [{ studentId: VALID_UUID }],
    })
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('status'))).toBe(true)
  })
})

describe('toJsonSchema', () => {
  it('round-trips a schema unchanged (a real JSON Schema object, ready for an OpenAI/Hermes tool definition)', () => {
    expect(toJsonSchema(classroomSchema)).toEqual({
      type: 'object',
      properties: { classroomId: { type: 'string', format: 'uuid' } },
      required: ['classroomId'],
    })
  })
})
