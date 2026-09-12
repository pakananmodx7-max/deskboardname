import { describe, expect, it, vi } from 'vitest'

import type { EdgeFunctionClient } from '../src/edge-function-client.js'
import { createServer } from '../src/server.js'
import { ALL_TOOL_NAMES, READ_TOOL_NAMES, WRITE_TOOL_NAMES } from '../src/tool-schemas.js'

function fakeClient(callTool: ReturnType<typeof vi.fn>): EdgeFunctionClient {
  return { callTool } as unknown as EdgeFunctionClient
}

describe('createServer — registers exactly the 8 tools (5 read + 3 write)', () => {
  it('registers exactly ALL_TOOL_NAMES, no more, no fewer', () => {
    const { registeredTools } = createServer(fakeClient(vi.fn()))
    expect(Object.keys(registeredTools).sort()).toEqual([...ALL_TOOL_NAMES].sort())
    expect(Object.keys(registeredTools)).toHaveLength(8)
  })

  it('registers all 5 read tools', () => {
    const { registeredTools } = createServer(fakeClient(vi.fn()))
    for (const name of READ_TOOL_NAMES) {
      expect(registeredTools[name]).toBeDefined()
    }
  })

  it('registers all 3 write tools', () => {
    const { registeredTools } = createServer(fakeClient(vi.fn()))
    for (const name of WRITE_TOOL_NAMES) {
      expect(registeredTools[name]).toBeDefined()
    }
  })

  it('carries over each tool\'s description unchanged', () => {
    const { registeredTools } = createServer(fakeClient(vi.fn()))
    expect(registeredTools.list_classrooms.description).toMatch(/classrooms/i)
    expect(registeredTools.get_classroom_summary.description).toMatch(/transparent/i)
    expect(registeredTools.create_assignment.description).toMatch(/Creates a new, non-archived assignment/)
  })

  it('every write tool\'s description carries the explicit "mutates production data" warning; no read tool does', () => {
    const { registeredTools } = createServer(fakeClient(vi.fn()))
    for (const name of WRITE_TOOL_NAMES) {
      expect(registeredTools[name].description).toMatch(/^\[WRITE — mutates production data\]/)
    }
    for (const name of READ_TOOL_NAMES) {
      expect(registeredTools[name].description).not.toMatch(/mutates production data/)
    }
  })

  it('every write tool is annotated readOnlyHint: false; every read tool is readOnlyHint: true', () => {
    const { registeredTools } = createServer(fakeClient(vi.fn()))
    for (const name of WRITE_TOOL_NAMES) {
      expect(registeredTools[name].annotations?.readOnlyHint).toBe(false)
    }
    for (const name of READ_TOOL_NAMES) {
      expect(registeredTools[name].annotations?.readOnlyHint).toBe(true)
    }
  })

  it('mark_attendance_bulk is annotated idempotent; create_assignment and copy_assignment_to_classrooms are not', () => {
    const { registeredTools } = createServer(fakeClient(vi.fn()))
    expect(registeredTools.mark_attendance_bulk.annotations?.idempotentHint).toBe(true)
    expect(registeredTools.create_assignment.annotations?.idempotentHint).toBe(false)
    expect(registeredTools.copy_assignment_to_classrooms.annotations?.idempotentHint).toBe(false)
  })

  it('no tool is annotated destructive — this Edge Function has no delete capability', () => {
    const { registeredTools } = createServer(fakeClient(vi.fn()))
    for (const name of ALL_TOOL_NAMES) {
      expect(registeredTools[name].annotations?.destructiveHint).toBe(false)
    }
  })
})

describe('createServer — read tool handler success/error paths (unchanged behavior)', () => {
  it('returns the Edge Function\'s data as both text content and structuredContent, unmodified', async () => {
    const data = { classrooms: [{ classroomId: '1', classroomName: 'ม.5/1', subjects: [], studentCount: 30 }] }
    const callTool = vi.fn().mockResolvedValue({ ok: true, tool: 'list_classrooms', data })
    const { registeredTools } = createServer(fakeClient(callTool))

    const result = await registeredTools.list_classrooms.handler({}, {} as never)

    expect(callTool).toHaveBeenCalledExactlyOnceWith('list_classrooms', {})
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toEqual(data)
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(data, null, 2) }])
  })

  it('forwards the exact args object it was called with to the Edge Function client', async () => {
    const callTool = vi.fn().mockResolvedValue({ ok: true, tool: 'get_missing_submissions', data: {} })
    const { registeredTools } = createServer(fakeClient(callTool))

    await registeredTools.get_missing_submissions.handler({ assignmentId: 'abc-123' }, {} as never)

    expect(callTool).toHaveBeenCalledExactlyOnceWith('get_missing_submissions', { assignmentId: 'abc-123' })
  })

  it('maps an { ok: false } result to isError: true with the code and message visible in the text content', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ ok: false, tool: 'get_classroom_summary', error: { code: 'not_found', message: 'ไม่พบห้องเรียนนี้' } })
    const { registeredTools } = createServer(fakeClient(callTool))

    const result = await registeredTools.get_classroom_summary.handler({ classroomId: 'x' }, {} as never)

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'not_found: ไม่พบห้องเรียนนี้' }])
    expect(result.structuredContent).toBeUndefined()
  })

  it('never throws out of a tool handler, even if the client itself throws unexpectedly', async () => {
    const callTool = vi.fn().mockRejectedValue(new Error('unexpected crash'))
    const { registeredTools } = createServer(fakeClient(callTool))

    const result = await registeredTools.list_classrooms.handler({}, {} as never)

    expect(result.isError).toBe(true)
    expect(result.content?.[0]).toMatchObject({ type: 'text' })
  })

  it('the backstop error text never includes the raw exception message (which could theoretically carry request internals)', async () => {
    const callTool = vi.fn().mockRejectedValue(new Error('super-sensitive-detail-should-not-leak'))
    const { registeredTools } = createServer(fakeClient(callTool))

    const result = await registeredTools.list_classrooms.handler({}, {} as never)

    const content = result.content?.[0] as { text: string } | undefined
    expect(content?.text).not.toContain('super-sensitive-detail-should-not-leak')
  })
})

describe('createServer — write tool handler success paths', () => {
  it('create_assignment: forwards args and returns the created assignment data unmodified', async () => {
    const data = { assignmentId: 'new-1', classroomId: 'c1', subjectId: 's1', subjectName: 'คณิตศาสตร์', title: 'งานใหม่', maxScore: 100 }
    const callTool = vi.fn().mockResolvedValue({ ok: true, tool: 'create_assignment', data })
    const { registeredTools } = createServer(fakeClient(callTool))
    const args = { classroomId: 'c1', title: 'งานใหม่', maxScore: 100 }

    const result = await registeredTools.create_assignment.handler(args, {} as never)

    expect(callTool).toHaveBeenCalledExactlyOnceWith('create_assignment', args)
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toEqual(data)
  })

  it('copy_assignment_to_classrooms: forwards args and returns the per-target results unmodified', async () => {
    const data = { sourceAssignmentId: 'a1', sourceTitle: 'งาน 1', results: [{ classroomId: 'c2', ok: true, assignmentId: 'a2' }] }
    const callTool = vi.fn().mockResolvedValue({ ok: true, tool: 'copy_assignment_to_classrooms', data })
    const { registeredTools } = createServer(fakeClient(callTool))
    const args = { assignmentId: 'a1', targetClassroomIds: ['c2'] }

    const result = await registeredTools.copy_assignment_to_classrooms.handler(args, {} as never)

    expect(callTool).toHaveBeenCalledExactlyOnceWith('copy_assignment_to_classrooms', args)
    expect(result.structuredContent).toEqual(data)
  })

  it('mark_attendance_bulk: forwards args (including nested updates) and returns the session summary unmodified', async () => {
    const data = { sessionId: 'sess-1', classroomId: 'c1', subjectId: null, date: '2026-09-12', changedCount: 2 }
    const callTool = vi.fn().mockResolvedValue({ ok: true, tool: 'mark_attendance_bulk', data })
    const { registeredTools } = createServer(fakeClient(callTool))
    const args = {
      classroomId: 'c1',
      date: '2026-09-12',
      updates: [
        { studentId: 's1', status: 'present' },
        { studentId: 's2', status: 'absent' },
      ],
    }

    const result = await registeredTools.mark_attendance_bulk.handler(args, {} as never)

    expect(callTool).toHaveBeenCalledExactlyOnceWith('mark_attendance_bulk', args)
    expect(result.structuredContent).toEqual(data)
  })
})

describe('createServer — write tool handler error paths (ownership/authorization failures)', () => {
  it('create_assignment: a classroom the teacher does not own surfaces as isError with the Edge Function\'s forbidden/not_found code, never a silent success', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ ok: false, tool: 'create_assignment', error: { code: 'not_found', message: 'ไม่พบห้องเรียนนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' } })
    const { registeredTools } = createServer(fakeClient(callTool))

    const result = await registeredTools.create_assignment.handler(
      { classroomId: 'not-mine', title: 'x', maxScore: 100 },
      {} as never,
    )

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'not_found: ไม่พบห้องเรียนนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' }])
  })

  it('copy_assignment_to_classrooms: a source assignment the teacher does not own surfaces as isError', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ ok: false, tool: 'copy_assignment_to_classrooms', error: { code: 'not_found', message: 'ไม่พบงานนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' } })
    const { registeredTools } = createServer(fakeClient(callTool))

    const result = await registeredTools.copy_assignment_to_classrooms.handler(
      { assignmentId: 'not-mine', targetClassroomIds: ['c1'] },
      {} as never,
    )

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'not_found: ไม่พบงานนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' }])
  })

  it('mark_attendance_bulk: a classroom the teacher does not own surfaces as isError, never partially writes', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ ok: false, tool: 'mark_attendance_bulk', error: { code: 'not_found', message: 'ไม่พบห้องเรียนนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' } })
    const { registeredTools } = createServer(fakeClient(callTool))

    const result = await registeredTools.mark_attendance_bulk.handler(
      { classroomId: 'not-mine', date: '2026-09-12', updates: [{ studentId: 's1', status: 'present' }] },
      {} as never,
    )

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'not_found: ไม่พบห้องเรียนนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' }])
  })

  it('an unauthorized (expired/invalid teacher session) error on a write tool surfaces exactly like on a read tool', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ ok: false, tool: 'mark_attendance_bulk', error: { code: 'unauthorized', message: 'Teacher authentication failed.' } })
    const { registeredTools } = createServer(fakeClient(callTool))

    const result = await registeredTools.mark_attendance_bulk.handler(
      { classroomId: 'c1', date: '2026-09-12', updates: [{ studentId: 's1', status: 'present' }] },
      {} as never,
    )

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'unauthorized: Teacher authentication failed.' }])
  })

  it('never throws out of a write tool handler even if the client itself throws unexpectedly', async () => {
    const callTool = vi.fn().mockRejectedValue(new Error('boom'))
    const { registeredTools } = createServer(fakeClient(callTool))

    const result = await registeredTools.create_assignment.handler(
      { classroomId: 'c1', title: 'x', maxScore: 100 },
      {} as never,
    )

    expect(result.isError).toBe(true)
  })
})
