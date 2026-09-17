import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  MAX_BULK_SCORE_UPDATES,
  aggregateBulkScoreOutcomes,
  buildBulkScoreUpdates,
  chunkBulkScoreUpdates,
  type BulkScoreChunkOutcome,
  type BulkScoreUpdate,
} from '@/services/score-bulk-service'

function readSource(): string {
  return readFileSync(new URL('./score-bulk-service.ts', import.meta.url), 'utf-8')
}

describe('buildBulkScoreUpdates — one update per selected student, same score, one assignment', () => {
  it('builds one update per student, all sharing the same assignment and score', () => {
    const updates = buildBulkScoreUpdates(['s1', 's2', 's3'], 'a1', 10)
    expect(updates).toHaveLength(3)
    expect(updates.every((u) => u.assignmentId === 'a1' && u.score === 10)).toBe(true)
  })

  it('matches the "เลือกแล้ว 31 คน" example shape exactly', () => {
    const studentIds = Array.from({ length: 31 }, (_, i) => `s${i}`)
    const updates = buildBulkScoreUpdates(studentIds, 'a1', 10)
    expect(updates).toHaveLength(31)
  })

  it('preserves student order', () => {
    const updates = buildBulkScoreUpdates(['s2', 's1', 's3'], 'a1', 5)
    expect(updates.map((u) => u.studentId)).toEqual(['s2', 's1', 's3'])
  })

  it('an empty student list produces zero updates', () => {
    expect(buildBulkScoreUpdates([], 'a1', 10)).toEqual([])
  })

  it('accepts a score of exactly 0 — never confused with "no update"', () => {
    const updates = buildBulkScoreUpdates(['s1'], 'a1', 0)
    expect(updates).toEqual([{ assignmentId: 'a1', studentId: 's1', score: 0 }])
  })
})

describe('chunkBulkScoreUpdates — >50 updates are chunked safely', () => {
  function makeUpdates(count: number): BulkScoreUpdate[] {
    return Array.from({ length: count }, (_, i) => ({ assignmentId: 'a1', studentId: `s${i}`, score: 10 }))
  }

  it('MAX_BULK_SCORE_UPDATES is 50, matching write-tools.ts and mcp-bridge exactly', () => {
    expect(MAX_BULK_SCORE_UPDATES).toBe(50)
  })

  it('a batch of exactly 50 stays in one chunk', () => {
    expect(chunkBulkScoreUpdates(makeUpdates(50))).toHaveLength(1)
    expect(chunkBulkScoreUpdates(makeUpdates(50))[0]).toHaveLength(50)
  })

  it('a batch of 51 splits into [50, 1] — never a single 51-item request', () => {
    const chunks = chunkBulkScoreUpdates(makeUpdates(51))
    expect(chunks.map((c) => c.length)).toEqual([50, 1])
  })

  it('a batch of 123 splits into [50, 50, 23], preserving order across chunks', () => {
    const updates = makeUpdates(123)
    const chunks = chunkBulkScoreUpdates(updates)
    expect(chunks.map((c) => c.length)).toEqual([50, 50, 23])
    expect(chunks.flat()).toEqual(updates)
  })

  it('an empty list chunks to zero chunks', () => {
    expect(chunkBulkScoreUpdates([])).toEqual([])
  })

  it('respects a custom chunkSize when given', () => {
    expect(chunkBulkScoreUpdates(makeUpdates(10), 4).map((c) => c.length)).toEqual([4, 4, 2])
  })

  it('rejects a non-positive chunkSize rather than looping forever', () => {
    expect(() => chunkBulkScoreUpdates(makeUpdates(1), 0)).toThrow()
    expect(() => chunkBulkScoreUpdates(makeUpdates(1), -5)).toThrow()
  })
})

describe('aggregateBulkScoreOutcomes — partial failures are reported, never silently dropped', () => {
  it('sums counts across multiple successful chunks', () => {
    const outcomes: BulkScoreChunkOutcome[] = [
      { ok: true, data: { requestedCount: 50, changedCount: 30, unchangedCount: 20, failedCount: 0, failures: [] } },
      { ok: true, data: { requestedCount: 23, changedCount: 23, unchangedCount: 0, failedCount: 0, failures: [] } },
    ]
    const result = aggregateBulkScoreOutcomes(outcomes)
    expect(result).toEqual({ requestedCount: 73, changedCount: 53, unchangedCount: 20, failedCount: 0, failures: [] })
  })

  it('carries forward per-item failures from a successful chunk response unchanged', () => {
    const failure = { assignmentId: 'a1', studentId: 's5', code: 'invalid_arguments', message: 'คะแนนต้องไม่เกิน 10' }
    const outcomes: BulkScoreChunkOutcome[] = [
      { ok: true, data: { requestedCount: 3, changedCount: 2, unchangedCount: 0, failedCount: 1, failures: [failure] } },
    ]
    const result = aggregateBulkScoreOutcomes(outcomes)
    expect(result.failedCount).toBe(1)
    expect(result.failures).toEqual([failure])
  })

  it('a whole-chunk failure (network/auth/validation) reports EVERY item in that chunk as failed, individually named — nothing silently dropped', () => {
    const chunk: BulkScoreUpdate[] = [
      { assignmentId: 'a1', studentId: 's1', score: 10 },
      { assignmentId: 'a1', studentId: 's2', score: 10 },
      { assignmentId: 'a1', studentId: 's3', score: 10 },
    ]
    const outcomes: BulkScoreChunkOutcome[] = [
      { ok: false, chunk, error: { code: 'network_error', message: 'ไม่สามารถเชื่อมต่อฟังก์ชันได้' } },
    ]
    const result = aggregateBulkScoreOutcomes(outcomes)
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
    const failedChunk: BulkScoreUpdate[] = [{ assignmentId: 'a1', studentId: 's99', score: 10 }]
    const outcomes: BulkScoreChunkOutcome[] = [
      { ok: true, data: { requestedCount: 50, changedCount: 40, unchangedCount: 10, failedCount: 0, failures: [] } },
      { ok: false, chunk: failedChunk, error: { code: 'unauthorized', message: 'Teacher authentication failed.' } },
    ]
    const result = aggregateBulkScoreOutcomes(outcomes)
    expect(result.requestedCount).toBe(51)
    expect(result.changedCount).toBe(40)
    expect(result.unchangedCount).toBe(10)
    expect(result.failedCount).toBe(1)
    expect(result.failures).toEqual([{ assignmentId: 'a1', studentId: 's99', code: 'unauthorized', message: 'Teacher authentication failed.' }])
  })

  it('an empty outcomes list aggregates to all zeros', () => {
    expect(aggregateBulkScoreOutcomes([])).toEqual({
      requestedCount: 0,
      changedCount: 0,
      unchangedCount: 0,
      failedCount: 0,
      failures: [],
    })
  })
})

// ==================================================
// bulkSetAssignmentScores — the network-calling orchestrator. Source-
// text guard (the established convention for anything that calls
// Supabase/an Edge Function in this codebase, since vitest.config.ts
// runs in a `node` environment with no DOM) — its actual chunking and
// aggregation behavior is already covered above with real, executed
// tests against the pure functions it calls.
// ==================================================

describe('bulkSetAssignmentScores — calls set_assignment_scores_bulk through callTeacherAgentTool, chunked', () => {
  const source = readSource()
  const fn = source.slice(source.indexOf('export async function bulkSetAssignmentScores'), source.length)

  it('chunks before sending anything', () => {
    expect(fn).toContain('chunkBulkScoreUpdates(updates)')
  })

  it('calls the Edge Function client with the exact tool name set_assignment_scores_bulk, one call per chunk', () => {
    expect(fn).toContain("callTeacherAgentTool<BulkScoreResult>('set_assignment_scores_bulk', { updates: chunk })")
    expect(fn).toMatch(/for \(const chunk of chunks\)/)
  })

  it('never writes to assignment_submissions directly — no raw Supabase table call in this function', () => {
    expect(fn).not.toMatch(/\.from\('assignment_submissions'\)/)
    expect(fn).not.toMatch(/getSupabaseClient/)
  })

  it('aggregates every chunk outcome (success or failure) through aggregateBulkScoreOutcomes — never returns a raw per-chunk result', () => {
    expect(fn).toContain('aggregateBulkScoreOutcomes(outcomes)')
    expect(fn).toContain('outcomes.push({ ok: true, data: response.data })')
    expect(fn).toContain('outcomes.push({ ok: false, chunk, error: response.error })')
  })
})

describe('bulk grading targets exactly one assignment per call — the update shape mirrors write-tools.ts on the server', () => {
  it('a built bulk score update carries exactly { assignmentId, studentId, score }', () => {
    const [update] = buildBulkScoreUpdates(['s1'], 'a1', 8)
    expect(Object.keys(update).sort()).toEqual(['assignmentId', 'score', 'studentId'])
  })

  it('the server-side Edge Function tool this calls (write-tools.ts) enforces the same 0 <= score <= max_score bound this client\'s validation (parseBulkScoreInput) already checks client-side', () => {
    const writeToolsSource = readFileSync(
      new URL('../../supabase/functions/teacher-agent-tools/tools/write-tools.ts', import.meta.url),
      'utf-8',
    )
    expect(writeToolsSource).toContain('set_assignment_scores_bulk')
    expect(writeToolsSource).toContain('args.score < 0')
    expect(writeToolsSource).toContain('args.score > assignment.max_score')
  })
})
