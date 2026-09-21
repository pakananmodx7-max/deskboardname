import type { SgsScoreCalculationFormula } from './sgs-score-calculation'

/**
 * The "คะแนน SGS" workspace — a grade model DELIBERATELY INDEPENDENT
 * from `assignments`/`assignment_submissions` (see
 * src/types/assignment.ts). An `SgsScoreColumn` is never an assignment:
 * it exists only to mirror one real SGS score-entry column (e.g. "ช่อง
 * 10" เต็ม 15, confirmed against the live SGS page via the SGS Bridge
 * Chrome extension's diagnostic — see sgs-bridge/README.md), and writing
 * a score here never touches, and is never derived from, a normal
 * assignment grade. See docs/DATABASE.md Phase 16 for the full schema
 * rationale (supabase/migrations/0023_sgs_score_workspace.sql).
 */
export interface SgsScoreColumn {
  id: string
  subjectId: string
  classroomId: string
  label: string
  maxScore: number
  position: number
  /**
   * The teacher's saved calculation configuration for this column, if
   * any — see src/types/sgs-score-calculation.ts. `null` means either
   * "no formula saved yet" OR "not fetched by this call" — see
   * sgs-score-workspace-service.ts's own comment on
   * SGS_SCORE_COLUMN_SELECT: getSgsScoreColumns/createSgsScoreColumn
   * deliberately never populate this field (always `null`), so the base
   * workspace load can never fail because of it. Only
   * getSgsScoreColumnFormulas and updateSgsScoreColumnFormula's own
   * return value carry a real value. Saving/clearing a formula never
   * writes or changes any score by itself — only "คำนวณใหม่" plus an
   * explicit approved preview ever does that.
   */
  calculationFormula: SgsScoreCalculationFormula | null
  createdAt: string
  updatedAt: string
}

export interface CreateSgsScoreColumnInput {
  subjectId: string
  classroomId: string
  label: string
  maxScore: number
}

/** One roster student's current SGS scores, keyed by `SgsScoreColumn.id`
 * — `null` means "no score entered yet," never an implicit 0. */
export interface SgsScoreWorkspaceRow {
  studentId: string
  studentNumber: number | null
  studentCode: string | null
  fullName: string
  scoresByColumnId: Record<string, number | null>
}

// ==================================================
// Bridge payload — a SEPARATE payload family from src/types/sgs-bridge.ts's
// SgsBridgePayload (the assignment-scoped one, version 2). Deliberately
// NOT unified with it and NOT sharing its `SGS_BRIDGE_PAYLOAD_VERSION`
// constant: the two payloads describe fundamentally different score
// sources (one assignment's assignment_submissions.score vs. one
// sgs_score_columns row's sgs_scores.score) and must never be mistaken
// for each other, in either direction. The extension tells them apart by
// the explicit `kind` field below, never by guessing from shape.
// ==================================================

export const SGS_SCORE_WORKSPACE_PAYLOAD_VERSION = 1 as const
export const SGS_SCORE_WORKSPACE_PAYLOAD_KIND = 'sgs_score_workspace' as const

export interface SgsScoreWorkspaceColumnDefinition {
  /** The `sgs_score_columns.id` this payload's scores came from — also
   * doubles as the opaque, stable `key` the whole bridge/extension
   * pipeline already uses to guarantee a write never crosses into a
   * different column (see sgs-bridge/src/lib/sgs-real-fill.js). */
  key: string
  label: string
  maxScore: number
}

export interface SgsScoreWorkspaceStudentScore {
  studentId: string
  studentNumber: number | null
  studentCode: string | null
  fullName: string
  /** Always a finite number, 0 <= score <= targetColumn.maxScore. Never
   * null — a null score means the student isn't in this array at all
   * (see computeSgsScoreWorkspaceSendPlan's 'skip_no_score' action). */
  score: number
}

export type SgsScoreWorkspaceSkipReason = 'no_score' | 'over_max_score'

export interface SgsScoreWorkspaceSkippedStudent {
  studentId: string
  studentNumber: number | null
  studentCode: string | null
  fullName: string
  reason: SgsScoreWorkspaceSkipReason
}

export interface SgsScoreWorkspacePayload {
  kind: typeof SGS_SCORE_WORKSPACE_PAYLOAD_KIND
  version: typeof SGS_SCORE_WORKSPACE_PAYLOAD_VERSION
  /** ISO 8601 — when this payload was generated, for the teacher's own
   * reference inside the extension; never used for auth or ordering. */
  generatedAt: string
  subject: { id: string; name: string }
  classroom: { id: string; name: string }
  /** The ONE SGS column this payload may ever write to. */
  targetColumn: SgsScoreWorkspaceColumnDefinition
  students: SgsScoreWorkspaceStudentScore[]
  skippedStudentIds: SgsScoreWorkspaceSkippedStudent[]
}

// ==================================================
// MULTI-COLUMN bridge payload — the production workflow's own payload
// family. The teacher sets SGS to show the whole classroom on ONE page
// and sends SEVERAL score columns in a single run, so one payload
// carries every selected column's definition plus each student's score
// PER COLUMN. Deliberately a separate `kind` from the single-column
// SgsScoreWorkspacePayload above (which keeps working unchanged): the
// extension tells the two apart by that explicit field, never by
// guessing from shape.
// ==================================================

export const SGS_SCORE_WORKSPACE_MULTI_PAYLOAD_VERSION = 1 as const
export const SGS_SCORE_WORKSPACE_MULTI_PAYLOAD_KIND = 'sgs_score_workspace_multi' as const

export interface SgsScoreWorkspaceMultiStudent {
  studentId: string
  studentNumber: number | null
  studentCode: string | null
  fullName: string
  /** Keyed by `SgsScoreWorkspaceColumnDefinition.key`. `null` means "no
   * score entered for this student in this column" — never an implicit
   * 0, which is itself a real, sendable score. A column the student has
   * no entry for at all may simply be absent from this record. */
  scoresByColumnKey: Record<string, number | null>
}

export interface SgsScoreWorkspaceMultiPayload {
  kind: typeof SGS_SCORE_WORKSPACE_MULTI_PAYLOAD_KIND
  version: typeof SGS_SCORE_WORKSPACE_MULTI_PAYLOAD_VERSION
  generatedAt: string
  subject: { id: string; name: string }
  classroom: { id: string; name: string }
  /** Every column this payload may write to — each with its OWN
   * maxScore, which is the only max ever applied to that column's
   * scores. */
  columns: SgsScoreWorkspaceColumnDefinition[]
  /** The FULL roster, every student exactly once. A student with no
   * score in a given column is represented by a null/absent entry in
   * `scoresByColumnKey`, never by omission from this list. */
  students: SgsScoreWorkspaceMultiStudent[]
}
