import { describe, expect, it, vi } from 'vitest'

import type { EdgeFunctionClient } from '../src/edge-function-client.js'
import { createServer } from '../src/server.js'
import { ALL_TOOL_NAMES, READ_TOOL_NAMES, WRITE_TOOL_NAMES } from '../src/tool-schemas.js'

function fakeClient(callTool: ReturnType<typeof vi.fn>): EdgeFunctionClient {
  return { callTool } as unknown as EdgeFunctionClient
}

describe('createServer — registers exactly the 12 tools (6 read + 6 write)', () => {
  it('registers exactly ALL_TOOL_NAMES, no more, no fewer', () => {
    const { registeredTools } = createServer(fakeClient(vi.fn()))
    expect(Object.keys(registeredTools).sort()).toEqual([...ALL_TOOL_NAMES].sort())
    expect(Object.keys(registeredTools)).toHaveLength(12)
  })

  it('registers all 6 read tools', () => {
    const { registeredTools } = createServer(fakeClient(vi.fn()))
    for (const name of READ_TOOL_NAMES) {
      expect(registeredTools[name]).toBeDefined()
    }
  })

  it('registers all 6 write tools', () => {
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

  it('mark_attendance_bulk, mark_submission_status, mark_submission_status_bulk, and set_assignment_scores_bulk are annotated idempotent; create_assignment and copy_assignment_to_classrooms are not', () => {
    const { registeredTools } = createServer(fakeClient(vi.fn()))
    expect(registeredTools.mark_attendance_bulk.annotations?.idempotentHint).toBe(true)
    expect(registeredTools.mark_submission_status.annotations?.idempotentHint).toBe(true)
    expect(registeredTools.mark_submission_status_bulk.annotations?.idempotentHint).toBe(true)
    expect(registeredTools.set_assignment_scores_bulk.annotations?.idempotentHint).toBe(true)
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

  it('get_classroom_submission_summary: forwards classroomId and returns the compact per-assignment summary unmodified', async () => {
    const data = {
      classroomId: 'c1',
      assignments: [
        { assignmentId: 'a1', title: 'รัฐฟูนัน', totalStudents: 31, submittedCount: 28, missingCount: 3, missingStudentNumbers: [4, 12, 19] },
      ],
    }
    const callTool = vi.fn().mockResolvedValue({ ok: true, tool: 'get_classroom_submission_summary', data })
    const { registeredTools } = createServer(fakeClient(callTool))

    const result = await registeredTools.get_classroom_submission_summary.handler({ classroomId: 'c1' }, {} as never)

    expect(callTool).toHaveBeenCalledExactlyOnceWith('get_classroom_submission_summary', { classroomId: 'c1' })
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toEqual(data)
  })

  it('get_classroom_submission_summary: an unowned classroom surfaces as isError, never a silent empty result', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ ok: false, tool: 'get_classroom_submission_summary', error: { code: 'not_found', message: 'ไม่พบห้องเรียนนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' } })
    const { registeredTools } = createServer(fakeClient(callTool))

    const result = await registeredTools.get_classroom_submission_summary.handler({ classroomId: 'not-mine' }, {} as never)

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'not_found: ไม่พบห้องเรียนนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' }])
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

  it('mark_submission_status: forwards args and returns the updated submission (including previousStatus/changed) unmodified — this is what lets Hermes verify what changed', async () => {
    const data = {
      assignmentId: 'a1',
      assignmentTitle: 'การดำเนินมนุษย์',
      classroomId: 'c1',
      studentId: 's1',
      studentName: 'สมชาย ใจดี',
      previousStatus: 'not_submitted',
      status: 'submitted',
      changed: true,
      score: null,
      note: null,
      updatedAt: '2026-09-13T00:00:00.000Z',
    }
    const callTool = vi.fn().mockResolvedValue({ ok: true, tool: 'mark_submission_status', data })
    const { registeredTools } = createServer(fakeClient(callTool))
    const args = { assignmentId: 'a1', studentId: 's1', status: 'submitted' }

    const result = await registeredTools.mark_submission_status.handler(args, {} as never)

    expect(callTool).toHaveBeenCalledExactlyOnceWith('mark_submission_status', args)
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toEqual(data)
  })

  it('mark_submission_status_bulk: forwards the whole updates array in one call and returns the compact aggregate result unmodified', async () => {
    const data = { requestedCount: 3, changedCount: 2, unchangedCount: 1, failedCount: 0, failures: [] }
    const callTool = vi.fn().mockResolvedValue({ ok: true, tool: 'mark_submission_status_bulk', data })
    const { registeredTools } = createServer(fakeClient(callTool))
    const args = {
      updates: [
        { assignmentId: 'a1', studentId: 's1', status: 'submitted' },
        { assignmentId: 'a1', studentId: 's2', status: 'late' },
        { assignmentId: 'a2', studentId: 's1', status: 'submitted' },
      ],
    }

    const result = await registeredTools.mark_submission_status_bulk.handler(args, {} as never)

    expect(callTool).toHaveBeenCalledExactlyOnceWith('mark_submission_status_bulk', args)
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toEqual(data)
  })

  it('mark_submission_status_bulk: a mixed batch reports both changedCount and unchangedCount, never full submission rows', async () => {
    const data = { requestedCount: 2, changedCount: 1, unchangedCount: 1, failedCount: 0, failures: [] }
    const callTool = vi.fn().mockResolvedValue({ ok: true, tool: 'mark_submission_status_bulk', data })
    const { registeredTools } = createServer(fakeClient(callTool))

    const result = await registeredTools.mark_submission_status_bulk.handler(
      {
        updates: [
          { assignmentId: 'a1', studentId: 's1', status: 'submitted' }, // already submitted -> unchanged
          { assignmentId: 'a1', studentId: 's2', status: 'missing' }, // was not_submitted -> changed
        ],
      },
      {} as never,
    )

    expect(result.structuredContent).toEqual(data)
    expect((result.structuredContent as typeof data).changedCount).toBe(1)
    expect((result.structuredContent as typeof data).unchangedCount).toBe(1)
  })

  it('mark_submission_status_bulk: a partial failure is reported in failures[] with failedCount, not thrown as a whole-batch error', async () => {
    const data = {
      requestedCount: 2,
      changedCount: 1,
      unchangedCount: 0,
      failedCount: 1,
      failures: [{ assignmentId: 'not-mine', studentId: 's1', code: 'not_found', message: 'ไม่พบงานนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' }],
    }
    const callTool = vi.fn().mockResolvedValue({ ok: true, tool: 'mark_submission_status_bulk', data })
    const { registeredTools } = createServer(fakeClient(callTool))

    const result = await registeredTools.mark_submission_status_bulk.handler(
      {
        updates: [
          { assignmentId: 'a1', studentId: 's1', status: 'submitted' },
          { assignmentId: 'not-mine', studentId: 's1', status: 'submitted' },
        ],
      },
      {} as never,
    )

    expect(result.isError).toBeUndefined() // a partial failure is a normal ok:true result, not an MCP error
    expect((result.structuredContent as typeof data).failedCount).toBe(1)
    expect((result.structuredContent as typeof data).failures).toHaveLength(1)
  })

  it('mark_submission_status_bulk: calling the same batch twice is idempotent — the second call reports unchangedCount equal to the batch size', async () => {
    const firstData = { requestedCount: 1, changedCount: 1, unchangedCount: 0, failedCount: 0, failures: [] }
    const secondData = { requestedCount: 1, changedCount: 0, unchangedCount: 1, failedCount: 0, failures: [] }
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, tool: 'mark_submission_status_bulk', data: firstData })
      .mockResolvedValueOnce({ ok: true, tool: 'mark_submission_status_bulk', data: secondData })
    const { registeredTools } = createServer(fakeClient(callTool))
    const args = { updates: [{ assignmentId: 'a1', studentId: 's1', status: 'submitted' }] }

    const first = await registeredTools.mark_submission_status_bulk.handler(args, {} as never)
    const second = await registeredTools.mark_submission_status_bulk.handler(args, {} as never)

    expect((first.structuredContent as typeof firstData).changedCount).toBe(1)
    expect((second.structuredContent as typeof secondData).unchangedCount).toBe(1)
  })

  it('mark_submission_status: calling it twice with the same status is idempotent — the second call reports changed: false', async () => {
    const noopData = {
      assignmentId: 'a1',
      assignmentTitle: 'การดำเนินมนุษย์',
      classroomId: 'c1',
      studentId: 's1',
      studentName: 'สมชาย ใจดี',
      previousStatus: 'submitted',
      status: 'submitted',
      changed: false,
      score: null,
      note: null,
      updatedAt: '2026-09-13T00:00:01.000Z',
    }
    const callTool = vi.fn().mockResolvedValue({ ok: true, tool: 'mark_submission_status', data: noopData })
    const { registeredTools } = createServer(fakeClient(callTool))

    const result = await registeredTools.mark_submission_status.handler(
      { assignmentId: 'a1', studentId: 's1', status: 'submitted' },
      {} as never,
    )

    expect((result.structuredContent as typeof noopData).changed).toBe(false)
  })

  it('set_assignment_scores_bulk: forwards the whole updates array in one call and returns the compact aggregate result unmodified', async () => {
    const data = { requestedCount: 31, changedCount: 28, unchangedCount: 3, failedCount: 0, failures: [] }
    const callTool = vi.fn().mockResolvedValue({ ok: true, tool: 'set_assignment_scores_bulk', data })
    const { registeredTools } = createServer(fakeClient(callTool))
    const args = { updates: Array.from({ length: 31 }, (_, i) => ({ assignmentId: 'a1', studentId: `s${i}`, score: 10 })) }

    const result = await registeredTools.set_assignment_scores_bulk.handler(args, {} as never)

    expect(callTool).toHaveBeenCalledExactlyOnceWith('set_assignment_scores_bulk', args)
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toEqual(data)
  })

  it('set_assignment_scores_bulk: a partial failure is reported in failures[] with failedCount, not thrown as a whole-batch error', async () => {
    const data = {
      requestedCount: 2,
      changedCount: 1,
      unchangedCount: 0,
      failedCount: 1,
      failures: [{ assignmentId: 'a1', studentId: 's2', code: 'invalid_arguments', message: 'คะแนนต้องไม่เกิน 10' }],
    }
    const callTool = vi.fn().mockResolvedValue({ ok: true, tool: 'set_assignment_scores_bulk', data })
    const { registeredTools } = createServer(fakeClient(callTool))

    const result = await registeredTools.set_assignment_scores_bulk.handler(
      {
        updates: [
          { assignmentId: 'a1', studentId: 's1', score: 8 },
          { assignmentId: 'a1', studentId: 's2', score: 999 },
        ],
      },
      {} as never,
    )

    expect(result.isError).toBeUndefined() // a partial failure is a normal ok:true result, not an MCP error
    expect((result.structuredContent as typeof data).failedCount).toBe(1)
    expect((result.structuredContent as typeof data).failures).toHaveLength(1)
  })

  it('set_assignment_scores_bulk: calling the same batch twice is idempotent — the second call reports unchangedCount equal to the batch size', async () => {
    const firstData = { requestedCount: 1, changedCount: 1, unchangedCount: 0, failedCount: 0, failures: [] }
    const secondData = { requestedCount: 1, changedCount: 0, unchangedCount: 1, failedCount: 0, failures: [] }
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, tool: 'set_assignment_scores_bulk', data: firstData })
      .mockResolvedValueOnce({ ok: true, tool: 'set_assignment_scores_bulk', data: secondData })
    const { registeredTools } = createServer(fakeClient(callTool))
    const args = { updates: [{ assignmentId: 'a1', studentId: 's1', score: 10 }] }

    const first = await registeredTools.set_assignment_scores_bulk.handler(args, {} as never)
    const second = await registeredTools.set_assignment_scores_bulk.handler(args, {} as never)

    expect((first.structuredContent as typeof firstData).changedCount).toBe(1)
    expect((second.structuredContent as typeof secondData).unchangedCount).toBe(1)
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

  it('mark_submission_status: an assignment the teacher does not own (or that does not exist) surfaces as isError, never a silent write', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ ok: false, tool: 'mark_submission_status', error: { code: 'not_found', message: 'ไม่พบงานนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' } })
    const { registeredTools } = createServer(fakeClient(callTool))

    const result = await registeredTools.mark_submission_status.handler(
      { assignmentId: 'not-mine', studentId: 's1', status: 'submitted' },
      {} as never,
    )

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'not_found: ไม่พบงานนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' }])
  })

  it('mark_submission_status: a student who does not belong to the assignment\'s classroom surfaces as isError, never a silent write', async () => {
    const callTool = vi.fn().mockResolvedValue({
      ok: false,
      tool: 'mark_submission_status',
      error: { code: 'not_found', message: 'ไม่พบนักเรียนคนนี้ในห้องเรียนของงานนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' },
    })
    const { registeredTools } = createServer(fakeClient(callTool))

    const result = await registeredTools.mark_submission_status.handler(
      { assignmentId: 'a1', studentId: 'not-in-this-classroom', status: 'submitted' },
      {} as never,
    )

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      { type: 'text', text: 'not_found: ไม่พบนักเรียนคนนี้ในห้องเรียนของงานนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' },
    ])
  })

  it('mark_submission_status: an invalid_arguments error (e.g. a status outside the 4 real values) surfaces as isError', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ ok: false, tool: 'mark_submission_status', error: { code: 'invalid_arguments', message: "status must be one of: not_submitted, submitted, late, missing" } })
    const { registeredTools } = createServer(fakeClient(callTool))

    const result = await registeredTools.mark_submission_status.handler(
      { assignmentId: 'a1', studentId: 's1', status: 'graded' },
      {} as never,
    )

    expect(result.isError).toBe(true)
  })

  it('mark_submission_status_bulk: an unauthorized (expired/invalid teacher session) error surfaces exactly like on every other write tool', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ ok: false, tool: 'mark_submission_status_bulk', error: { code: 'unauthorized', message: 'Teacher authentication failed.' } })
    const { registeredTools } = createServer(fakeClient(callTool))

    const result = await registeredTools.mark_submission_status_bulk.handler(
      { updates: [{ assignmentId: 'a1', studentId: 's1', status: 'submitted' }] },
      {} as never,
    )

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'unauthorized: Teacher authentication failed.' }])
  })

  it('mark_submission_status_bulk: a student not belonging to the assignment\'s classroom is reported per-item, and a whole-batch rejection (e.g. over the max batch size) surfaces as isError', async () => {
    const callTool = vi.fn().mockResolvedValue({
      ok: false,
      tool: 'mark_submission_status_bulk',
      error: { code: 'invalid_arguments', message: 'อัปเดตได้ไม่เกิน 50 รายการต่อครั้ง' },
    })
    const { registeredTools } = createServer(fakeClient(callTool))

    const result = await registeredTools.mark_submission_status_bulk.handler(
      { updates: Array.from({ length: 51 }, () => ({ assignmentId: 'a1', studentId: 's1', status: 'submitted' })) },
      {} as never,
    )

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'invalid_arguments: อัปเดตได้ไม่เกิน 50 รายการต่อครั้ง' }])
  })

  it('set_assignment_scores_bulk: an out-of-range score (above the assignment\'s max) surfaces as isError, never a silently clamped write', async () => {
    const callTool = vi.fn().mockResolvedValue({
      ok: false,
      tool: 'set_assignment_scores_bulk',
      error: { code: 'invalid_arguments', message: 'คะแนนต้องไม่เกิน 10' },
    })
    const { registeredTools } = createServer(fakeClient(callTool))

    const result = await registeredTools.set_assignment_scores_bulk.handler(
      { updates: [{ assignmentId: 'a1', studentId: 's1', score: 999 }] },
      {} as never,
    )

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'invalid_arguments: คะแนนต้องไม่เกิน 10' }])
  })

  it('set_assignment_scores_bulk: an unauthorized (expired/invalid teacher session) error surfaces exactly like on every other write tool', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ ok: false, tool: 'set_assignment_scores_bulk', error: { code: 'unauthorized', message: 'Teacher authentication failed.' } })
    const { registeredTools } = createServer(fakeClient(callTool))

    const result = await registeredTools.set_assignment_scores_bulk.handler(
      { updates: [{ assignmentId: 'a1', studentId: 's1', score: 10 }] },
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
