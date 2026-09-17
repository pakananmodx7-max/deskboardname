import { callTeacherAgentTool } from '@/services/teacher-agent-tools-client'

/**
 * Mirrors supabase/functions/teacher-agent-tools/tools/write-tools.ts's
 * own MAX_BULK_SCORE_UPDATES exactly (also mirrored by
 * mcp-bridge/src/tool-schemas.ts for Hermes) — the Edge Function is
 * still the authoritative enforcement; a batch over this limit is
 * rejected there with invalid_arguments regardless of how this client
 * chunks it. Kept here only so this client can chunk BEFORE sending,
 * never so a >50 request slips through and gets rejected wholesale.
 */
export const MAX_BULK_SCORE_UPDATES = 50

export interface BulkScoreUpdate {
  assignmentId: string
  studentId: string
  score: number
}

export interface BulkScoreFailure {
  assignmentId: string
  studentId: string
  code: string
  message: string
}

export interface BulkScoreResult {
  requestedCount: number
  changedCount: number
  unchangedCount: number
  failedCount: number
  failures: BulkScoreFailure[]
}

/**
 * One update per selected student, all sharing the same target `score`
 * on the ONE assignment the ตรวจงานและคะแนน bulk grading bar operates
 * on — unlike the status bulk bar (which can target several assignment
 * columns at once), bulk grading always assigns one specific score to
 * one assignment, matching the "เลือกแล้ว N คน / งาน: X /max" UI copy.
 */
export function buildBulkScoreUpdates(studentIds: string[], assignmentId: string, score: number): BulkScoreUpdate[] {
  return studentIds.map((studentId) => ({ assignmentId, studentId, score }))
}

/**
 * Splits `updates` into groups no larger than `chunkSize` (default the
 * tool's own max batch size), preserving order — a >50-student bulk
 * grade action from the matrix is never sent as one oversized request,
 * and never as one request per student either (each chunk is still one
 * request for up to 50 students).
 */
export function chunkBulkScoreUpdates(updates: BulkScoreUpdate[], chunkSize: number = MAX_BULK_SCORE_UPDATES): BulkScoreUpdate[][] {
  if (chunkSize <= 0) throw new Error('chunkSize must be positive')
  const chunks: BulkScoreUpdate[][] = []
  for (let i = 0; i < updates.length; i += chunkSize) {
    chunks.push(updates.slice(i, i + chunkSize))
  }
  return chunks
}

/**
 * One chunk's outcome — either the Edge Function's own per-chunk
 * aggregate (which can itself carry per-item failures from
 * set_assignment_scores_bulk's independent-per-item try/catch), or the
 * WHOLE chunk failing before any per-item result existed at all
 * (network error, expired session, a batch-size/shape validation
 * error) — in which case every item in that chunk is reported as a
 * failure, named individually, never silently dropped.
 */
export type BulkScoreChunkOutcome =
  | { ok: true; data: BulkScoreResult }
  | { ok: false; chunk: BulkScoreUpdate[]; error: { code: string; message: string } }

/**
 * Combines every chunk's outcome into one running total — the exact
 * shape the UI renders (a toast with counts, an inline failures list).
 * Pure and never throws: a whole-chunk failure just becomes that
 * chunk's items in `failures`, using the SAME failure shape a per-item
 * server-side failure already has, so the UI never needs to special-
 * case "which kind of failure was this."
 */
export function aggregateBulkScoreOutcomes(outcomes: BulkScoreChunkOutcome[]): BulkScoreResult {
  const result: BulkScoreResult = {
    requestedCount: 0,
    changedCount: 0,
    unchangedCount: 0,
    failedCount: 0,
    failures: [],
  }

  for (const outcome of outcomes) {
    if (outcome.ok) {
      result.requestedCount += outcome.data.requestedCount
      result.changedCount += outcome.data.changedCount
      result.unchangedCount += outcome.data.unchangedCount
      result.failedCount += outcome.data.failedCount
      result.failures.push(...outcome.data.failures)
    } else {
      result.requestedCount += outcome.chunk.length
      result.failedCount += outcome.chunk.length
      result.failures.push(
        ...outcome.chunk.map((u) => ({
          assignmentId: u.assignmentId,
          studentId: u.studentId,
          code: outcome.error.code,
          message: outcome.error.message,
        })),
      )
    }
  }

  return result
}

/**
 * The web app's own bulk grading write path — calls the SAME
 * set_assignment_scores_bulk tool Hermes would use, through the SAME
 * teacher-agent-tools Edge Function (callTeacherAgentTool), chunked at
 * the tool's own max batch size so a >50-student bulk grade action from
 * the matrix (multi-select bar or a "ทั้งห้อง" shortcut) never exceeds
 * it, and NEVER sends one request per student — each chunk of up to 50
 * items is exactly one request. One source of truth: this never writes
 * to assignment_submissions directly and never re-implements the
 * ownership/validation/score-bound logic that already lives server-side
 * in write-tools.ts, so a change made here is exactly as visible to
 * Hermes (and vice versa) as any other write to that table.
 */
export async function bulkSetAssignmentScores(updates: BulkScoreUpdate[]): Promise<BulkScoreResult> {
  const chunks = chunkBulkScoreUpdates(updates)
  const outcomes: BulkScoreChunkOutcome[] = []

  for (const chunk of chunks) {
    const response = await callTeacherAgentTool<BulkScoreResult>('set_assignment_scores_bulk', { updates: chunk })
    if (response.ok) {
      outcomes.push({ ok: true, data: response.data })
    } else {
      outcomes.push({ ok: false, chunk, error: response.error })
    }
  }

  return aggregateBulkScoreOutcomes(outcomes)
}
