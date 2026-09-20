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
