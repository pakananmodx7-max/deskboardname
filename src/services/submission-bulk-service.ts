import { callTeacherAgentTool } from '@/services/teacher-agent-tools-client'
import type { SubmissionStatus } from '@/types/assignment'

/**
 * Mirrors supabase/functions/teacher-agent-tools/tools/write-tools.ts's
 * own MAX_BULK_SUBMISSION_STATUS_UPDATES exactly (also mirrored by
 * mcp-bridge/src/tool-schemas.ts for Hermes) — the Edge Function is
 * still the authoritative enforcement; a batch over this limit is
 * rejected there with invalid_arguments regardless of how this client
 * chunks it. Kept here only so this client can chunk BEFORE sending,
 * never so a >50 request slips through and gets rejected wholesale.
 */
export const MAX_BULK_SUBMISSION_STATUS_UPDATES = 50

export interface BulkSubmissionStatusUpdate {
  assignmentId: string
  studentId: string
  status: SubmissionStatus
}

export interface BulkSubmissionStatusFailure {
  assignmentId: string
  studentId: string
  code: string
  message: string
}

export interface BulkSubmissionStatusResult {
  requestedCount: number
  changedCount: number
  unchangedCount: number
  failedCount: number
  failures: BulkSubmissionStatusFailure[]
}

/**
 * Every (student × assignment) combination as one update, all sharing
 * the same target `status` — the "5 นักเรียน × 3 งาน = 15 รายการ" cross
 * product the matrix's multi-select bulk bar (and each column's own
 * "ทั้งห้อง" quick action, a 1-assignment special case of the same
 * shape) builds before calling bulkMarkSubmissionStatus. Assignment-
 * major order, matching computeModeItemCount's own iteration order
 * elsewhere in this codebase.
 */
export function buildBulkSubmissionStatusUpdates(
  studentIds: string[],
  assignmentIds: string[],
  status: SubmissionStatus,
): BulkSubmissionStatusUpdate[] {
  const updates: BulkSubmissionStatusUpdate[] = []
  for (const assignmentId of assignmentIds) {
    for (const studentId of studentIds) {
      updates.push({ assignmentId, studentId, status })
    }
  }
  return updates
}

/**
 * Splits `updates` into groups no larger than `chunkSize` (default the
 * tool's own max batch size), preserving order — a >50-item bulk action
 * from the matrix is never sent as one oversized request, and never as
 * one request per student either (each chunk is still one request for
 * up to 50 items).
 */
export function chunkBulkSubmissionStatusUpdates(
  updates: BulkSubmissionStatusUpdate[],
  chunkSize: number = MAX_BULK_SUBMISSION_STATUS_UPDATES,
): BulkSubmissionStatusUpdate[][] {
  if (chunkSize <= 0) throw new Error('chunkSize must be positive')
  const chunks: BulkSubmissionStatusUpdate[][] = []
  for (let i = 0; i < updates.length; i += chunkSize) {
    chunks.push(updates.slice(i, i + chunkSize))
  }
  return chunks
}

/**
 * One chunk's outcome — either the Edge Function's own per-chunk
 * aggregate (which can itself carry per-item failures from
 * mark_submission_status_bulk's independent-per-item try/catch), or the
 * WHOLE chunk failing before any per-item result existed at all
 * (network error, expired session, a batch-size/shape validation
 * error) — in which case every item in that chunk is reported as a
 * failure, named individually, never silently dropped.
 */
export type BulkChunkOutcome =
  | { ok: true; data: BulkSubmissionStatusResult }
  | { ok: false; chunk: BulkSubmissionStatusUpdate[]; error: { code: string; message: string } }

/**
 * Combines every chunk's outcome into one running total — the exact
 * shape the UI renders (a toast with counts, an inline failures list).
 * Pure and never throws: a whole-chunk failure just becomes that
 * chunk's items in `failures`, using the SAME failure shape a per-item
 * server-side failure already has, so the UI never needs to special-
 * case "which kind of failure was this."
 */
export function aggregateBulkSubmissionStatusOutcomes(outcomes: BulkChunkOutcome[]): BulkSubmissionStatusResult {
  const result: BulkSubmissionStatusResult = {
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
 * The web app's own bulk submission-status write path — calls the
 * SAME mark_submission_status_bulk tool Hermes uses, through the SAME
 * teacher-agent-tools Edge Function (callTeacherAgentTool), chunked at
 * the tool's own max batch size so a >50-item bulk action from the
 * matrix (whole-column, multi-select, or multi-assignment) never
 * exceeds it, and NEVER sends one request per student — each chunk of
 * up to 50 items is exactly one request. One source of truth: this
 * never writes to assignment_submissions directly and never
 * re-implements the ownership/validation logic that already lives
 * server-side in write-tools.ts, so a change made here is exactly as
 * visible to Hermes (and vice versa) as any other write to that table.
 */
export async function bulkMarkSubmissionStatus(updates: BulkSubmissionStatusUpdate[]): Promise<BulkSubmissionStatusResult> {
  const chunks = chunkBulkSubmissionStatusUpdates(updates)
  const outcomes: BulkChunkOutcome[] = []

  for (const chunk of chunks) {
    const response = await callTeacherAgentTool<BulkSubmissionStatusResult>('mark_submission_status_bulk', { updates: chunk })
    if (response.ok) {
      outcomes.push({ ok: true, data: response.data })
    } else {
      outcomes.push({ ok: false, chunk, error: response.error })
    }
  }

  return aggregateBulkSubmissionStatusOutcomes(outcomes)
}
