import { describe, expect, it, vi } from 'vitest'

import type { EdgeFunctionClient } from '../src/edge-function-client.js'
import { createServer } from '../src/server.js'
import { EXCLUDED_WRITE_TOOL_NAMES, READ_TOOL_NAMES } from '../src/tool-schemas.js'

function fakeClient(callTool: ReturnType<typeof vi.fn>): EdgeFunctionClient {
  return { callTool } as unknown as EdgeFunctionClient
}

describe('createServer — registers exactly the 5 read tools, never a write tool', () => {
  it('registers all 5 read tool names', () => {
    const { registeredTools } = createServer(fakeClient(vi.fn()))
    expect(Object.keys(registeredTools).sort()).toEqual([...READ_TOOL_NAMES].sort())
  })

  it('never registers any of the 3 write tools', () => {
    const { registeredTools } = createServer(fakeClient(vi.fn()))
    for (const writeTool of EXCLUDED_WRITE_TOOL_NAMES) {
      expect(registeredTools[writeTool]).toBeUndefined()
    }
  })

  it('carries over each tool\'s description unchanged', () => {
    const { registeredTools } = createServer(fakeClient(vi.fn()))
    expect(registeredTools.list_classrooms.description).toMatch(/classrooms/i)
    expect(registeredTools.get_classroom_summary.description).toMatch(/transparent/i)
  })
})

describe('createServer — tool handler success path', () => {
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
})

describe('createServer — tool handler error path', () => {
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
