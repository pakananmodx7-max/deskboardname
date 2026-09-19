/**
 * Phase 2 — combines student mapping (mapping.js's matchStudentsToSgs,
 * built in Phase 1) with the column-fill rules (column-fill.js, Phase
 * 1.5) into the ONE decision that matters once real SGS data exists: for
 * each KrunameClass student, is their score written into the real,
 * matched SGS row's target-column cell, and if not, why not.
 *
 * This does NOT replace computeSgsColumnFillPlan (column-fill.js) —
 * that function still powers the "no live SGS connection yet" preview
 * (sgs-export-dialog.tsx and this extension's own preview before a real
 * table is inspected). This module is what runs once a real SGS table
 * has actually been read.
 */

/**
 * @param {{studentId: string, studentNumber: number|null, fullName: string, score: number}[]} krunameStudents
 * @param {ReturnType<typeof import('./mapping.js').matchStudentsToSgs>} mappingResults - same order/length as krunameStudents
 * @param {Record<string, number|null>} existingScoresBySgsRowKey - keyed by the matched row's sgsRowKey
 * @param {'skip_existing'|'overwrite_selected_column'} overwriteMode
 */
export function computeSgsRealFillPlan(krunameStudents, mappingResults, existingScoresBySgsRowKey, overwriteMode) {
  return krunameStudents.map((student, index) => {
    const mapping = mappingResults[index]
    const base = {
      studentId: student.studentId,
      studentNumber: student.studentNumber,
      fullName: student.fullName,
      krunameScore: student.score,
      mappingStatus: mapping.status,
      matchedSgsRowKey: mapping.matchedSgsRowKey,
      mappingReason: mapping.reason,
    }

    // A student KrunameClass can't confidently place in the real SGS
    // table (AMBIGUOUS or NOT_FOUND) is NEVER written — there is no
    // safe cell to write to, whatever their KrunameClass score is.
    if (mapping.status !== 'MATCHED') {
      return { ...base, sgsExistingScore: null, action: 'skip_unmatched' }
    }

    const sgsExistingScore = Object.prototype.hasOwnProperty.call(existingScoresBySgsRowKey, mapping.matchedSgsRowKey)
      ? existingScoresBySgsRowKey[mapping.matchedSgsRowKey]
      : null

    let action
    if (student.score === null || student.score === undefined) {
      action = 'skip_no_score'
    } else if (sgsExistingScore !== null && overwriteMode === 'skip_existing') {
      action = 'skip_existing'
    } else {
      action = 'write'
    }

    return { ...base, sgsExistingScore, action }
  })
}

export function formatSgsExistingScoreDisplay(row) {
  if (row.mappingStatus !== 'MATCHED') return 'ไม่ทราบ (ไม่พบแถวที่ตรงกัน)'
  return row.sgsExistingScore === null ? 'ว่าง' : String(row.sgsExistingScore)
}

export function formatSgsNewValueDisplay(row) {
  return row.action === 'write' ? String(row.krunameScore) : 'ไม่เปลี่ยน'
}

/**
 * The actual "what to write into the live page" list — every entry
 * carries the SAME `columnKey` requested, and a `rowIndex` derived
 * ONLY from the matched SGS row (never from anything else), so the DOM-
 * filling function in content-diagnostic.js can locate the exact cell
 * without needing to know anything about KrunameClass at all. A row
 * whose action isn't 'write' (unmatched, no score, or skipped-existing)
 * simply produces no instruction.
 */
export function buildSgsRealWriteInstructions(plan, columnKey) {
  return plan
    .filter((row) => row.action === 'write')
    .map((row) => ({
      studentId: row.studentId,
      sgsRowKey: row.matchedSgsRowKey,
      columnKey,
      value: row.krunameScore,
    }))
}

/**
 * The exact five buckets the "ทดลองกรอกเฉพาะช่องนี้" result must show:
 * matched / written / skipped no score / skipped existing / ambiguous
 * or not found. `matched` counts every MATCHED row regardless of what
 * action followed (a matched-but-skipped-existing row is still a
 * successful match); `ambiguousOrNotFound` combines both non-MATCHED
 * statuses into the one bucket the spec asks for, since a teacher
 * fixing either case takes the same next step (check that student by
 * hand).
 */
export function summarizeSgsRealFillPlan(plan) {
  return {
    matched: plan.filter((row) => row.mappingStatus === 'MATCHED').length,
    written: plan.filter((row) => row.action === 'write').length,
    skippedNoScore: plan.filter((row) => row.action === 'skip_no_score').length,
    skippedExisting: plan.filter((row) => row.action === 'skip_existing').length,
    ambiguousOrNotFound: plan.filter((row) => row.mappingStatus !== 'MATCHED').length,
  }
}
