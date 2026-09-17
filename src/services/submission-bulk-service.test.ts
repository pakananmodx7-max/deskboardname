import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  MAX_BULK_SUBMISSION_STATUS_UPDATES,
  aggregateBulkSubmissionStatusOutcomes,
  buildBulkSubmissionStatusUpdates,
  chunkBulkSubmissionStatusUpdates,
  type BulkChunkOutcome,
  type BulkSubmissionStatusUpdate,
} from '@/services/submission-bulk-service'

function readSource(): string {
  return readFileSync(new URL('./submission-bulk-service.ts', import.meta.url), 'utf-8')
}

describe('buildBulkSubmissionStatusUpdates — the "N นักเรียน × M งาน" cross product', () => {
  it('builds one update per (assignment, student) pair, all sharing the same status', () => {
    const updates = buildBulkSubmissionStatusUpdates(['s1', 's2'], ['a1', 'a2', 'a3'], 'submitted')
    expect(updates).toHaveLength(6)
    expect(updates.every((u) => u.status === 'submitted')).toBe(true)
  })

  it('matches the "5 นักเรียน × 3 งาน = 15 รายการ" example exactly', () => {
    const students = Array.from({ length: 5 }, (_, i) => `s${i}`)
    const assignments = Array.from({ length: 3 }, (_, i) => `a${i}`)
    expect(buildBulkSubmissionStatusUpdates(students, assignments, 'missing')).toHaveLength(15)
  })

  it('is assignment-major: every student for a1 comes before any student for a2', () => {
    const updates = buildBulkSubmissionStatusUpdates(['s1', 's2'], ['a1', 'a2'], 'late')
    expect(updates.map((u) => `${u.assignmentId}:${u.studentId}`)).toEqual(['a1:s1', 'a1:s2', 'a2:s1', 'a2:s2'])
  })

  it('an empty student or assignment list produces zero updates', () => {
    expect(buildBulkSubmissionStatusUpdates([], ['a1'], 'submitted')).toEqual([])
    expect(buildBulkSubmissionStatusUpdates(['s1'], [], 'submitted')).toEqual([])
  })

  it('REGRESSION — the exact ทั้งหมด-mode bulk bar examples from the task spec: 8 students × 1 assignment = 8, 8 students × 3 assignments = 24, 32 students × 3 assignments = 96', () => {
    const students8 = Array.from({ length: 8 }, (_, i) => `s${i}`)
    const students32 = Array.from({ length: 32 }, (_, i) => `s${i}`)
    expect(buildBulkSubmissionStatusUpdates(students8, ['a0'], 'submitted')).toHaveLength(8)
    expect(buildBulkSubmissionStatusUpdates(students8, ['a0', 'a1', 'a2'], 'submitted')).toHaveLength(24)
    expect(buildBulkSubmissionStatusUpdates(students32, ['a0', 'a1', 'a2'], 'submitted')).toHaveLength(96)
  })
})

describe('chunkBulkSubmissionStatusUpdates — >50 updates are chunked safely', () => {
  function makeUpdates(count: number): BulkSubmissionStatusUpdate[] {
    return Array.from({ length: count }, (_, i) => ({ assignmentId: 'a1', studentId: `s${i}`, status: 'submitted' as const }))
  }

  it('MAX_BULK_SUBMISSION_STATUS_UPDATES is 50, matching write-tools.ts and mcp-bridge exactly', () => {
    expect(MAX_BULK_SUBMISSION_STATUS_UPDATES).toBe(50)
  })

  it('a batch of exactly 50 stays in one chunk', () => {
    expect(chunkBulkSubmissionStatusUpdates(makeUpdates(50))).toHaveLength(1)
    expect(chunkBulkSubmissionStatusUpdates(makeUpdates(50))[0]).toHaveLength(50)
  })

  it('a batch of 51 splits into [50, 1] — never a single 51-item request', () => {
    const chunks = chunkBulkSubmissionStatusUpdates(makeUpdates(51))
    expect(chunks.map((c) => c.length)).toEqual([50, 1])
  })

  it('a batch of 123 splits into [50, 50, 23], preserving order across chunks', () => {
    const updates = makeUpdates(123)
    const chunks = chunkBulkSubmissionStatusUpdates(updates)
    expect(chunks.map((c) => c.length)).toEqual([50, 50, 23])
    expect(chunks.flat()).toEqual(updates)
  })

  it('an empty list chunks to zero chunks', () => {
    expect(chunkBulkSubmissionStatusUpdates([])).toEqual([])
  })

  it('REGRESSION — the exact task-spec example end-to-end: 32 students × 3 assignments = 96 updates chunks as [50, 46], built via buildBulkSubmissionStatusUpdates then chunked — the teacher still only triggers ONE bulk action', () => {
    const students32 = Array.from({ length: 32 }, (_, i) => `s${i}`)
    const updates = buildBulkSubmissionStatusUpdates(students32, ['a0', 'a1', 'a2'], 'submitted')
    expect(updates).toHaveLength(96)
    const chunks = chunkBulkSubmissionStatusUpdates(updates)
    expect(chunks.map((c) => c.length)).toEqual([50, 46])
    expect(chunks.flat()).toEqual(updates)
  })

  it('respects a custom chunkSize when given', () => {
    expect(chunkBulkSubmissionStatusUpdates(makeUpdates(10), 4).map((c) => c.length)).toEqual([4, 4, 2])
  })

  it('rejects a non-positive chunkSize rather than looping forever', () => {
    expect(() => chunkBulkSubmissionStatusUpdates(makeUpdates(1), 0)).toThrow()
    expect(() => chunkBulkSubmissionStatusUpdates(makeUpdates(1), -5)).toThrow()
  })
})

describe('aggregateBulkSubmissionStatusOutcomes — partial failures are reported, never silently dropped', () => {
  it('sums counts across multiple successful chunks', () => {
    const outcomes: BulkChunkOutcome[] = [
      { ok: true, data: { requestedCount: 50, changedCount: 30, unchangedCount: 20, failedCount: 0, failures: [] } },
      { ok: true, data: { requestedCount: 23, changedCount: 23, unchangedCount: 0, failedCount: 0, failures: [] } },
    ]
    const result = aggregateBulkSubmissionStatusOutcomes(outcomes)
    expect(result).toEqual({ requestedCount: 73, changedCount: 53, unchangedCount: 20, failedCount: 0, failures: [] })
  })

  it('carries forward per-item failures from a successful chunk response unchanged', () => {
    const failure = { assignmentId: 'a1', studentId: 's5', code: 'not_found', message: 'ไม่พบนักเรียนคนนี้' }
    const outcomes: BulkChunkOutcome[] = [
      { ok: true, data: { requestedCount: 3, changedCount: 2, unchangedCount: 0, failedCount: 1, failures: [failure] } },
    ]
    const result = aggregateBulkSubmissionStatusOutcomes(outcomes)
    expect(result.failedCount).toBe(1)
    expect(result.failures).toEqual([failure])
  })

  it('a whole-chunk failure (network/auth/validation) reports EVERY item in that chunk as failed, individually named — nothing silently dropped', () => {
    const chunk: BulkSubmissionStatusUpdate[] = [
      { assignmentId: 'a1', studentId: 's1', status: 'submitted' },
      { assignmentId: 'a1', studentId: 's2', status: 'submitted' },
      { assignmentId: 'a2', studentId: 's1', status: 'submitted' },
    ]
    const outcomes: BulkChunkOutcome[] = [
      { ok: false, chunk, error: { code: 'network_error', message: 'ไม่สามารถเชื่อมต่อฟังก์ชันได้' } },
    ]
    const result = aggregateBulkSubmissionStatusOutcomes(outcomes)
    expect(result.requestedCount).toBe(3)
    expect(result.failedCount).toBe(3)
    expect(result.changedCount).toBe(0)
    expect(result.failures).toHaveLength(3)
    for (const item of chunk) {
      expect(result.failures).toContainEqual({
        assignmentId: item.assignmentId,
        studentId: item.studentId,
        code: 'network_error',
        message: 'ไม่สามารถเชื่อมต่อฟังก์ชันได้',
      })
    }
  })

  it('mixes a successful chunk and a failed chunk correctly in one aggregate — this is the >50-updates real-world case (2 chunks, one fails)', () => {
    const failedChunk: BulkSubmissionStatusUpdate[] = [{ assignmentId: 'a1', studentId: 's99', status: 'missing' }]
    const outcomes: BulkChunkOutcome[] = [
      { ok: true, data: { requestedCount: 50, changedCount: 40, unchangedCount: 10, failedCount: 0, failures: [] } },
      { ok: false, chunk: failedChunk, error: { code: 'unauthorized', message: 'Teacher authentication failed.' } },
    ]
    const result = aggregateBulkSubmissionStatusOutcomes(outcomes)
    expect(result.requestedCount).toBe(51)
    expect(result.changedCount).toBe(40)
    expect(result.unchangedCount).toBe(10)
    expect(result.failedCount).toBe(1)
    expect(result.failures).toEqual([{ assignmentId: 'a1', studentId: 's99', code: 'unauthorized', message: 'Teacher authentication failed.' }])
  })

  it('an empty outcomes list aggregates to all zeros', () => {
    expect(aggregateBulkSubmissionStatusOutcomes([])).toEqual({
      requestedCount: 0,
      changedCount: 0,
      unchangedCount: 0,
      failedCount: 0,
      failures: [],
    })
  })
})

// ==================================================
// bulkMarkSubmissionStatus — the network-calling orchestrator. Source-
// text guard (the established convention for anything that calls
// Supabase/an Edge Function in this codebase, since vitest.config.ts
// runs in a `node` environment with no DOM) — its actual chunking and
// aggregation behavior is already covered above with real, executed
// tests against the pure functions it calls.
// ==================================================

describe('bulkMarkSubmissionStatus — calls mark_submission_status_bulk (Hermes\' own tool) through callTeacherAgentTool, chunked', () => {
  const source = readSource()
  const fn = source.slice(
    source.indexOf('export async function bulkMarkSubmissionStatus'),
    source.length,
  )

  it('chunks before sending anything', () => {
    expect(fn).toContain('chunkBulkSubmissionStatusUpdates(updates)')
  })

  it('calls the Edge Function client with the exact tool name mark_submission_status_bulk, one call per chunk', () => {
    expect(fn).toContain("callTeacherAgentTool<BulkSubmissionStatusResult>('mark_submission_status_bulk', { updates: chunk })")
    expect(fn).toMatch(/for \(const chunk of chunks\)/)
  })

  it('never writes to assignment_submissions directly — no raw Supabase table call in this function', () => {
    expect(fn).not.toMatch(/\.from\('assignment_submissions'\)/)
    expect(fn).not.toMatch(/getSupabaseClient/)
  })

  it('aggregates every chunk outcome (success or failure) through aggregateBulkSubmissionStatusOutcomes — never returns a raw per-chunk result', () => {
    expect(fn).toContain('aggregateBulkSubmissionStatusOutcomes(outcomes)')
    expect(fn).toContain("outcomes.push({ ok: true, data: response.data })")
    expect(fn).toContain('outcomes.push({ ok: false, chunk, error: response.error })')
  })
})

describe('bulk checking never assigns a score — the update shape has no score field, matching mark_submission_status_bulk on the server', () => {
  it('a built bulk status update carries only { assignmentId, studentId, status } — no score key exists to accidentally send', () => {
    const [update] = buildBulkSubmissionStatusUpdates(['s1'], ['a1'], 'submitted')
    expect(Object.keys(update).sort()).toEqual(['assignmentId', 'status', 'studentId'])
    expect('score' in update).toBe(false)
  })

  it('the server-side Edge Function tool this calls (write-tools.ts) also only ever writes { status } — bulk checking is structurally incapable of creating a score', () => {
    const writeToolsSource = readFileSync(
      new URL('../../supabase/functions/teacher-agent-tools/tools/write-tools.ts', import.meta.url),
      'utf-8',
    )
    expect(writeToolsSource).toContain('Never creates or changes a score or note.')
    const upsertCallStart = writeToolsSource.indexOf('.upsert(', writeToolsSource.indexOf('async function markSubmissionStatus'))
    const upsertArgsBlock = writeToolsSource.slice(upsertCallStart, writeToolsSource.indexOf(')', upsertCallStart))
    expect(upsertArgsBlock).toContain('{ assignment_id: args.assignmentId, student_id: args.studentId, status: args.status }')
    expect(upsertArgsBlock).not.toContain('score')
  })
})
