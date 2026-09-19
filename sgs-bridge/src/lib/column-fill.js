/**
 * Mirrors src/services/sgs-export-service.ts's column-fill functions
 * EXACTLY (computeSgsColumnFillPlan, buildSgsColumnWriteInstructions,
 * formatSgsExistingScoreDisplay, formatSgsNewValueDisplay) — for the
 * same reason mapping.js and payload-validation.js mirror their
 * counterparts: this extension can't import a TS module from the main
 * app's src/. Any change to these RULES must be made in both places.
 *
 * This is also where the "column-specific fill" safety guarantee
 * actually matters most: buildSgsColumnWriteInstructions is the ONLY
 * function in this whole extension that will ever produce a "write
 * this value to SGS" instruction, and every instruction it produces
 * carries the exact `columnKey` it was called with — a caller that
 * asks for 'midterm' can never receive a 'col1' instruction back. The
 * (not-yet-built) DOM-filling step must only ever accept this shape and
 * must only look up the ONE selector belonging to that columnKey.
 */

export function computeSgsColumnFillPlan(rows, existingScoresByStudentId, overwriteMode) {
  return rows.map((row) => {
    const sgsExistingScore =
      Object.prototype.hasOwnProperty.call(existingScoresByStudentId, row.studentId)
        ? existingScoresByStudentId[row.studentId]
        : null
    let action
    if (row.krunameScore === null || row.krunameScore === undefined) {
      action = 'skip_no_score'
    } else if (sgsExistingScore !== null && overwriteMode === 'skip_existing') {
      action = 'skip_existing'
    } else {
      action = 'write'
    }
    return {
      studentId: row.studentId,
      studentNumber: row.studentNumber,
      fullName: row.fullName,
      krunameScore: row.krunameScore,
      sgsExistingScore,
      action,
    }
  })
}

export function formatSgsExistingScoreDisplay(score) {
  return score === null || score === undefined ? 'ว่าง' : String(score)
}

export function formatSgsNewValueDisplay(row) {
  return row.action === 'write' ? String(row.krunameScore) : 'ไม่เปลี่ยน'
}

export function buildSgsColumnWriteInstructions(plan, columnKey) {
  return plan
    .filter((row) => row.action === 'write')
    .map((row) => ({ studentId: row.studentId, columnKey, value: row.krunameScore }))
}
