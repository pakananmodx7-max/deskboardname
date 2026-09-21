/**
 * Rebuilds the FULL roster (graded + skipped) from a normalized Bridge
 * Payload's two lists — `students` (score field) and `skippedStudentIds`
 * (no score at all, always null here) — so any preview/plan built from
 * this shows every student, not just the ones that will actually
 * transfer. Shared by popup.js (sections 4/6/7's previews) AND
 * content-script.js (auto-run's own in-page per-page plan) so the two
 * never build the roster two different ways.
 */
export function buildFullRosterFromPayload(payload) {
  return [
    ...payload.students.map((s) => ({
      studentId: s.studentId,
      studentNumber: s.studentNumber,
      // Only the SGS Score Workspace payload family carries studentCode
      // (see src/types/sgs-score-workspace.ts) — the legacy assignment-
      // scoped payload has no such field at all, so this is honestly
      // null for it rather than guessed from anything else.
      studentCode: s.studentCode ?? null,
      fullName: s.fullName,
      krunameScore: s.score,
      score: s.score,
    })),
    ...payload.skippedStudentIds.map((s) => ({
      studentId: s.studentId,
      studentNumber: s.studentNumber,
      studentCode: s.studentCode ?? null,
      fullName: s.fullName,
      krunameScore: null,
      score: null,
    })),
  ]
}

/**
 * PRODUCTION multi-column payload — the full roster, exactly once per
 * student. Unlike the single-column payload family there is no separate
 * `skippedStudentIds` list: a student with no score in a given column
 * simply carries `null` for that column (see
 * buildScoresByStudentIdAndColumnKey below), so every student is always
 * present here and "no score in column X" never means "missing from the
 * roster."
 */
export function buildFullRosterFromMultiPayload(payload) {
  return (payload?.students ?? []).map((student) => ({
    studentId: student.studentId,
    studentNumber: student.studentNumber ?? null,
    studentCode: student.studentCode ?? null,
    fullName: student.fullName,
  }))
}

/**
 * `{ [studentId]: { [columnKey]: number|null } }` — the lookup
 * buildMultiColumnPlan projects onto one column at a time. A missing
 * entry and an explicit `null` both mean "no score entered," and are
 * never confused with a real 0.
 */
export function buildScoresByStudentIdAndColumnKey(payload) {
  const out = {}
  for (const student of payload?.students ?? []) {
    const scores = {}
    for (const [columnKey, value] of Object.entries(student.scoresByColumnKey ?? {})) {
      scores[columnKey] = typeof value === 'number' && Number.isFinite(value) ? value : null
    }
    out[student.studentId] = scores
  }
  return out
}
