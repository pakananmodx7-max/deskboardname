/**
 * The payload shape KrunameClass hands to the local SGS Bridge Chrome
 * extension (see sgs-bridge/) — never sent to any server, never
 * containing Supabase tokens or SGS credentials. `version` exists so a
 * future breaking change to this shape can be detected explicitly by
 * the extension (an old extension talking to a new payload, or vice
 * versa) instead of failing on an unexpected/missing field.
 *
 * Only students with an ACTUAL, non-null score are included in
 * `students` — a null score ("no work graded yet") is never converted
 * to 0 and never sent at all. `skippedStudentIds` records who was left
 * out and why, purely for the teacher's own audit trail; the extension
 * never needs it to do its job.
 *
 * v2 adds column-specific filling (`targetColumn` + `overwriteMode`):
 * every write this payload can ever cause is scoped to exactly ONE SGS
 * score column, chosen by the teacher in KrunameClass BEFORE the file is
 * downloaded — every other column on the SGS page must stay untouched.
 * `students[].score` is still just "the KrunameClass score, for a
 * student who has one" — whether it actually gets WRITTEN also depends
 * on `overwriteMode` and whatever the extension reads as that column's
 * current value on the live SGS page (only the extension can know that;
 * see sgs-bridge/src/lib/column-fill.js).
 *
 * NOTE: this is the ASSIGNMENT-scoped payload family only (one
 * assignment's `assignment_submissions.score`). A completely separate,
 * independent payload family exists for the "คะแนน SGS" workspace (its
 * own `sgs_score_columns`/`sgs_scores` data, never an assignment) — see
 * `src/types/sgs-score-workspace.ts`'s `SgsScoreWorkspacePayload` and its
 * own version/kind constants. The two are never unified: the extension
 * tells them apart by an explicit `kind` field, never by shape-guessing.
 */
export const SGS_BRIDGE_PAYLOAD_VERSION = 2 as const

/**
 * One selectable SGS score column. `key` is an opaque, stable id this
 * whole pipeline uses to guarantee a write never crosses into a
 * different column (see computeSgsColumnFillPlan/
 * buildSgsColumnWriteInstructions) — it is NOT a CSS selector; Phase 5
 * hasn't confirmed the real SGS DOM yet, so no selector is invented
 * here either.
 */
export interface SgsColumnDefinition {
  key: string
  label: string
  maxScore: number
}

export type SgsOverwriteMode = 'skip_existing' | 'overwrite_selected_column'

/** "ข้ามคะแนนที่มีอยู่แล้ว" — never overwrite a column that already has a
 * value unless the teacher explicitly opts in. */
export const DEFAULT_SGS_OVERWRITE_MODE: SgsOverwriteMode = 'skip_existing'

export interface SgsBridgeStudentScore {
  studentId: string
  studentNumber: number | null
  fullName: string
  /** Always a finite number, 0 <= score <= min(assignmentMaxScore,
   * targetColumn.maxScore). Never null — a null score means the student
   * isn't in this array at all. */
  score: number
}

export interface SgsBridgeSkippedStudent {
  studentId: string
  studentNumber: number | null
  fullName: string
  reason: 'no_score'
}

export interface SgsBridgePayload {
  version: typeof SGS_BRIDGE_PAYLOAD_VERSION
  /** ISO 8601 — when this payload was generated, for the teacher's own
   * reference inside the extension; never used for auth or ordering. */
  generatedAt: string
  subjectId: string
  subjectName: string
  classroomId: string
  classroomName: string
  assignmentId: string
  assignmentTitle: string
  assignmentMaxScore: number
  /** The ONE SGS column this payload may ever write to. */
  targetColumn: SgsColumnDefinition
  /** The teacher's explicit choice, made in KrunameClass before download
   * (see sgs-export-dialog.tsx) — the extension must honor this exactly
   * and never silently pick the other mode. */
  overwriteMode: SgsOverwriteMode
  students: SgsBridgeStudentScore[]
  skippedStudentIds: SgsBridgeSkippedStudent[]
}
