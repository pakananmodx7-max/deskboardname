import { describe, expect, it } from 'vitest'

import {
  buildWholeColumnWriteInstructions,
  canEnableWholeColumnWrite,
  collectFailedStudents,
  computeWholeColumnPlan,
  emptyWholeColumnSummary,
  evaluateWholeColumnPreconditions,
  locateColumnOnCurrentPage,
  mergeWholeColumnSummaries,
  revalidateWholeColumnContext,
  summarizeWholeColumnResult,
  verifyWholeColumnWrite,
  WHOLE_COLUMN_STATUS,
} from '../src/lib/whole-column-write.js'

function kn(studentId: string, studentNumber: number | null, fullName: string, score: number | null) {
  return { studentId, studentNumber, fullName, score }
}

function matched(rowKey: string, reason = 'จับคู่ด้วยชื่อ-นามสกุล') {
  return { status: 'MATCHED', matchedSgsRowKey: rowKey, reason }
}
function notFound() {
  return { status: 'NOT_FOUND', matchedSgsRowKey: null, reason: 'ไม่พบนักเรียนคนนี้ในหน้า SGS' }
}
function ambiguous() {
  return { status: 'AMBIGUOUS', matchedSgsRowKey: null, reason: 'พบชื่อ-นามสกุลซ้ำกัน' }
}

describe('computeWholeColumnPlan', () => {
  it('a MATCHED student with a real score and no existing SGS value is READY', () => {
    const plan = computeWholeColumnPlan([kn('k1', 1, 'สมชาย ใจดี', 8)], [matched('row-0')], {}, 'skip_existing', 15)
    expect(plan[0].status).toBe(WHOLE_COLUMN_STATUS.READY)
    expect(plan[0].sgsRowOffset).toBe(0)
  })

  it('a null KrunameClass score is SKIP_NO_SCORE, never written', () => {
    const plan = computeWholeColumnPlan([kn('k1', 1, 'สมชาย ใจดี', null)], [matched('row-0')], {}, 'overwrite_selected_column', 15)
    expect(plan[0].status).toBe(WHOLE_COLUMN_STATUS.SKIP_NO_SCORE)
  })

  it('an explicit score of 0 is READY, never confused with "no score"', () => {
    const plan = computeWholeColumnPlan([kn('k1', 1, 'สมชาย ใจดี', 0)], [matched('row-0')], {}, 'skip_existing', 15)
    expect(plan[0].status).toBe(WHOLE_COLUMN_STATUS.READY)
    expect(plan[0].krunameScore).toBe(0)
  })

  it('an existing SGS value is skipped by DEFAULT (skip_existing)', () => {
    const plan = computeWholeColumnPlan([kn('k1', 1, 'สมชาย ใจดี', 8)], [matched('row-0')], { 'row-0': 6 }, 'skip_existing', 15)
    expect(plan[0].status).toBe(WHOLE_COLUMN_STATUS.SKIP_EXISTING)
  })

  it('overwrite requires the explicit teacher choice — skip_existing never overwrites, overwrite_selected_column does', () => {
    const skipMode = computeWholeColumnPlan([kn('k1', 1, 'สมชาย ใจดี', 8)], [matched('row-0')], { 'row-0': 6 }, 'skip_existing', 15)
    expect(skipMode[0].status).toBe(WHOLE_COLUMN_STATUS.SKIP_EXISTING)

    const overwriteMode = computeWholeColumnPlan(
      [kn('k1', 1, 'สมชาย ใจดี', 8)],
      [matched('row-0')],
      { 'row-0': 6 },
      'overwrite_selected_column',
      15,
    )
    expect(overwriteMode[0].status).toBe(WHOLE_COLUMN_STATUS.READY)
  })

  it('a score exceeding the CONFIRMED real column max is INVALID_SCORE — never silently clamped or written', () => {
    const plan = computeWholeColumnPlan([kn('k1', 1, 'สมชาย ใจดี', 20)], [matched('row-0')], {}, 'skip_existing', 15)
    expect(plan[0].status).toBe(WHOLE_COLUMN_STATUS.INVALID_SCORE)
  })

  it('a negative score is INVALID_SCORE', () => {
    const plan = computeWholeColumnPlan([kn('k1', 1, 'สมชาย ใจดี', -1)], [matched('row-0')], {}, 'skip_existing', 15)
    expect(plan[0].status).toBe(WHOLE_COLUMN_STATUS.INVALID_SCORE)
  })

  it('NOT_FOUND and AMBIGUOUS students are never written, whatever their score', () => {
    const plan = computeWholeColumnPlan(
      [kn('k1', 1, 'ไม่พบ', 8), kn('k2', 2, 'กำกวม', 8)],
      [notFound(), ambiguous()],
      {},
      'overwrite_selected_column',
      15,
    )
    expect(plan[0].status).toBe(WHOLE_COLUMN_STATUS.NOT_FOUND)
    expect(plan[1].status).toBe(WHOLE_COLUMN_STATUS.AMBIGUOUS)
    expect(plan[0].sgsRowOffset).toBeNull()
    expect(plan[1].sgsRowOffset).toBeNull()
  })
})

describe('buildWholeColumnWriteInstructions — structural single-column guarantee', () => {
  it('only READY rows produce a write instruction, keyed by sgsRowOffset', () => {
    const plan = computeWholeColumnPlan(
      [kn('k1', 1, 'พร้อมเขียน', 8), kn('k2', 2, 'ไม่มีคะแนน', null), kn('k3', 3, 'ไม่พบ', 5)],
      [matched('row-0'), matched('row-1'), notFound()],
      {},
      'skip_existing',
      15,
    )
    const { columnIndex, writesByOffset } = buildWholeColumnWriteInstructions(plan, 4)
    expect(columnIndex).toBe(4)
    expect(writesByOffset).toEqual({ 0: 8 })
  })

  it('every entry always carries the SAME columnIndex passed in — there is no way to smuggle a second column through', () => {
    const plan = computeWholeColumnPlan(
      [kn('k1', 1, 'A', 5), kn('k2', 2, 'B', 6)],
      [matched('row-0'), matched('row-1')],
      {},
      'skip_existing',
      15,
    )
    const resultA = buildWholeColumnWriteInstructions(plan, 3)
    const resultB = buildWholeColumnWriteInstructions(plan, 9)
    expect(resultA.columnIndex).toBe(3)
    expect(resultB.columnIndex).toBe(9)
    // Same plan, different columnIndex argument -> only the argument
    // changes; the function itself has no per-row column field to drift.
    expect(resultA.writesByOffset).toEqual(resultB.writesByOffset)
  })

  it('explicit 0 is written, never dropped as if it were empty', () => {
    const plan = computeWholeColumnPlan([kn('k1', 1, 'สมชาย ใจดี', 0)], [matched('row-0')], {}, 'skip_existing', 15)
    const { writesByOffset } = buildWholeColumnWriteInstructions(plan, 2)
    expect(writesByOffset[0]).toBe(0)
  })
})

describe('evaluateWholeColumnPreconditions', () => {
  function readyPlan() {
    return computeWholeColumnPlan([kn('k1', 1, 'สมชาย ใจดี', 8)], [matched('row-0')], {}, 'skip_existing', 15)
  }

  it('ok once every condition holds and at least one row is READY', () => {
    const result = evaluateWholeColumnPreconditions({
      subjectClassroomOk: true,
      columnWritableNow: true,
      headerCheckboxOk: true,
      plan: readyPlan(),
    })
    expect(result.ok).toBe(true)
  })

  it('subject/class mismatch aborts before anything else is even checked', () => {
    const result = evaluateWholeColumnPreconditions({
      subjectClassroomOk: false,
      columnWritableNow: true,
      headerCheckboxOk: true,
      plan: readyPlan(),
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('รายวิชา/ห้องเรียน')
  })

  it('blocks when the column is not writable now', () => {
    const result = evaluateWholeColumnPreconditions({
      subjectClassroomOk: true,
      columnWritableNow: false,
      headerCheckboxOk: true,
      plan: readyPlan(),
    })
    expect(result.ok).toBe(false)
  })

  it('blocks when the header checkbox is not enabled', () => {
    const result = evaluateWholeColumnPreconditions({
      subjectClassroomOk: true,
      columnWritableNow: true,
      headerCheckboxOk: false,
      plan: readyPlan(),
    })
    expect(result.ok).toBe(false)
  })

  it('blocks when any row is INVALID_SCORE, even if other rows are fine', () => {
    const plan = computeWholeColumnPlan(
      [kn('k1', 1, 'โอเค', 8), kn('k2', 2, 'เกินคะแนนเต็ม', 99)],
      [matched('row-0'), matched('row-1')],
      {},
      'skip_existing',
      15,
    )
    const result = evaluateWholeColumnPreconditions({ subjectClassroomOk: true, columnWritableNow: true, headerCheckboxOk: true, plan })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('เกินคะแนนเต็ม')
  })

  it('blocks when there is nothing READY to write at all', () => {
    const plan = computeWholeColumnPlan([kn('k1', 1, 'ไม่พบ', 8)], [notFound()], {}, 'skip_existing', 15)
    const result = evaluateWholeColumnPreconditions({ subjectClassroomOk: true, columnWritableNow: true, headerCheckboxOk: true, plan })
    expect(result.ok).toBe(false)
  })
})

describe('canEnableWholeColumnWrite', () => {
  it('requires BOTH passing preconditions AND explicit consent', () => {
    expect(canEnableWholeColumnWrite(true, true)).toBe(true)
    expect(canEnableWholeColumnWrite(true, false)).toBe(false)
    expect(canEnableWholeColumnWrite(false, true)).toBe(false)
  })
})

describe('verifyWholeColumnWrite / summarizeWholeColumnResult — the final six-bucket summary', () => {
  it('produces the exact six counts from a mixed page', () => {
    const students = [
      kn('k1', 1, 'เขียนสำเร็จ', 8),
      kn('k2', 2, 'ไม่มีคะแนน', null),
      kn('k3', 3, 'มีคะแนนเดิม', 5),
      kn('k4', 4, 'ไม่พบ', 7),
      kn('k5', 5, 'กำกวม', 7),
      kn('k6', 6, 'เขียนล้มเหลว', 9),
    ]
    const mappings = [matched('row-0'), matched('row-1'), matched('row-2'), notFound(), ambiguous(), matched('row-5')]
    const plan = computeWholeColumnPlan(students, mappings, { 'row-2': 3 }, 'skip_existing', 15)
    const { writesByOffset } = buildWholeColumnWriteInstructions(plan, 4)
    // row-0 (offset 0) succeeds; row-5 (offset 5) is reported missing by
    // the DOM write call, simulating a cell that vanished mid-operation.
    const fillResult = { found: true, writtenCount: 1, missingOffsets: [5] }
    const freshValuesResult = { found: true, values: { 0: 8 } }
    const verified = verifyWholeColumnWrite(plan, writesByOffset, fillResult, freshValuesResult)
    const summary = summarizeWholeColumnResult(verified)
    expect(summary).toEqual({
      written: 1,
      skippedNoScore: 1,
      skippedExisting: 1,
      notFound: 1,
      ambiguous: 1,
      failed: 1,
    })
  })

  it('a read-back value that does not match what was written is FAILED, even when the DOM write call reported success', () => {
    const plan = computeWholeColumnPlan([kn('k1', 1, 'สมชาย ใจดี', 8)], [matched('row-0')], {}, 'skip_existing', 15)
    const { writesByOffset } = buildWholeColumnWriteInstructions(plan, 4)
    const fillResult = { found: true, writtenCount: 1, missingOffsets: [] }
    // SGS's own JS ultimately kept a different value than what was set.
    const freshValuesResult = { found: true, values: { 0: 5 } }
    const verified = verifyWholeColumnWrite(plan, writesByOffset, fillResult, freshValuesResult)
    expect(verified[0].writeOutcome).toBe('FAILED')
  })

  it('collectFailedStudents lists exactly the FAILED rows', () => {
    const plan = computeWholeColumnPlan(
      [kn('k1', 1, 'สำเร็จ', 8), kn('k2', 2, 'ล้มเหลว', 9)],
      [matched('row-0'), matched('row-1')],
      {},
      'skip_existing',
      15,
    )
    const { writesByOffset } = buildWholeColumnWriteInstructions(plan, 4)
    const verified = verifyWholeColumnWrite(plan, writesByOffset, { found: true, writtenCount: 1, missingOffsets: [1] }, { found: true, values: { 0: 8 } })
    expect(collectFailedStudents(verified)).toEqual([{ studentNumber: 2, fullName: 'ล้มเหลว' }])
  })
})

describe('mergeWholeColumnSummaries — cumulative totals across semi-automatic pages', () => {
  it('adds every field across two pages', () => {
    const page1 = { written: 8, skippedNoScore: 1, skippedExisting: 1, notFound: 0, ambiguous: 0, failed: 0 }
    const page2 = { written: 7, skippedNoScore: 0, skippedExisting: 0, notFound: 1, ambiguous: 1, failed: 1 }
    expect(mergeWholeColumnSummaries(page1, page2)).toEqual({
      written: 15,
      skippedNoScore: 1,
      skippedExisting: 1,
      notFound: 1,
      ambiguous: 1,
      failed: 1,
    })
  })

  it('starting from emptyWholeColumnSummary and merging one page returns that page unchanged', () => {
    const page = { written: 3, skippedNoScore: 2, skippedExisting: 1, notFound: 0, ambiguous: 0, failed: 0 }
    expect(mergeWholeColumnSummaries(emptyWholeColumnSummary(), page)).toEqual(page)
  })
})

describe('locateColumnOnCurrentPage — pagination re-scan', () => {
  it('finds the confirmed column by key regardless of its index on the new page', () => {
    const writableScoreColumns = [
      { key: 'real-ช่อง-10-3', columnIndex: 5 },
      { key: 'real-กลางภาค-7', columnIndex: 8 },
    ]
    expect(locateColumnOnCurrentPage(writableScoreColumns, 'real-ช่อง-10-3')).toEqual({ key: 'real-ช่อง-10-3', columnIndex: 5 })
  })

  it('returns null (never a guess) when the column no longer appears on the current page', () => {
    const writableScoreColumns = [{ key: 'real-กลางภาค-7', columnIndex: 8 }]
    expect(locateColumnOnCurrentPage(writableScoreColumns, 'real-ช่อง-10-3')).toBeNull()
  })
})

describe('revalidateWholeColumnContext — stale DOM abort', () => {
  const confirmed = { subjectFilterText: 'ส22101 สังคมศึกษา3 ม.2', classroomFilterText: '1', columnKey: 'real-ช่อง-10-3' }

  it('ok when nothing has drifted', () => {
    expect(revalidateWholeColumnContext(confirmed, { ...confirmed })).toEqual({ ok: true, reason: null })
  })

  it('aborts when the subject filter has changed since the preview', () => {
    const result = revalidateWholeColumnContext(confirmed, { ...confirmed, subjectFilterText: 'ค22101 คณิตศาสตร์3 ม.2' })
    expect(result.ok).toBe(false)
  })

  it('aborts when the classroom filter has changed since the preview', () => {
    const result = revalidateWholeColumnContext(confirmed, { ...confirmed, classroomFilterText: '2' })
    expect(result.ok).toBe(false)
  })

  it('aborts when the confirmed column can no longer be located on a fresh scan (e.g. its header checkbox was unchecked) — locateColumnOnCurrentPage would have returned null, so fresh.columnKey is null here', () => {
    const result = revalidateWholeColumnContext(confirmed, { ...confirmed, columnKey: null })
    expect(result.ok).toBe(false)
  })
})
