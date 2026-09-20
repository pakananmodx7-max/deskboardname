import { describe, expect, it } from 'vitest'

import {
  AUTO_RUN_FAILURE_THRESHOLD_RATIO,
  buildAutoRunPreRunSummary,
  buildAutoRunReport,
  countReadyRows,
  emptyAutoRunSummary,
  evaluateAutoRunStopCondition,
  isPaginationReadyForAutoRun,
  mergeAutoRunSummaries,
  PAGINATION_UNKNOWN_MESSAGE,
  pageFailureExceedsThreshold,
  planHasAmbiguousWriteCandidate,
  summarizeAutoRunPageResult,
} from '../src/lib/auto-run.js'
import { buildWholeColumnWriteInstructions, collectFailedStudents, computeWholeColumnPlan, verifyWholeColumnWrite } from '../src/lib/whole-column-write.js'

function kn(studentId: string, studentNumber: number | null, fullName: string, score: number | null) {
  return { studentId, studentNumber, fullName, score }
}
function matched(rowKey: string) {
  return { status: 'MATCHED', matchedSgsRowKey: rowKey, reason: 'จับคู่ด้วยชื่อ-นามสกุล' }
}
function notFound() {
  return { status: 'NOT_FOUND', matchedSgsRowKey: null, reason: 'ไม่พบนักเรียนคนนี้ในหน้า SGS' }
}
function ambiguous() {
  return { status: 'AMBIGUOUS', matchedSgsRowKey: null, reason: 'พบชื่อ-นามสกุลซ้ำกัน' }
}

const okRevalidation = { ok: true, reason: null }

describe('pageFailureExceedsThreshold', () => {
  it('never exceeds when nothing was attempted', () => {
    expect(pageFailureExceedsThreshold({ failed: 0 }, 0)).toBe(false)
  })

  it('does not exceed at exactly the threshold ratio', () => {
    // 2/10 = 0.2, not strictly greater than AUTO_RUN_FAILURE_THRESHOLD_RATIO
    expect(pageFailureExceedsThreshold({ failed: 2 }, 10)).toBe(false)
    expect(AUTO_RUN_FAILURE_THRESHOLD_RATIO).toBe(0.2)
  })

  it('exceeds once strictly more than the threshold ratio fails', () => {
    expect(pageFailureExceedsThreshold({ failed: 3 }, 10)).toBe(true)
  })
})

describe('planHasAmbiguousWriteCandidate', () => {
  it('true when an AMBIGUOUS row also carries a real score', () => {
    const plan = computeWholeColumnPlan([kn('k1', 1, 'กำกวม', 8)], [ambiguous()], {}, 'skip_existing', 15)
    expect(planHasAmbiguousWriteCandidate(plan)).toBe(true)
  })

  it('false when the AMBIGUOUS row has no score to write at all', () => {
    const plan = computeWholeColumnPlan([kn('k1', 1, 'กำกวม', null)], [ambiguous()], {}, 'skip_existing', 15)
    expect(planHasAmbiguousWriteCandidate(plan)).toBe(false)
  })

  it('false when nothing is ambiguous', () => {
    const plan = computeWholeColumnPlan([kn('k1', 1, 'สมชาย', 8)], [matched('row-0')], {}, 'skip_existing', 15)
    expect(planHasAmbiguousWriteCandidate(plan)).toBe(false)
  })
})

describe('isPaginationReadyForAutoRun — BUG FIX: never a safe default to guess forward from when the real SGS pagination could not be confidently read', () => {
  it('true for a fully detected, internally consistent pagination', () => {
    expect(isPaginationReadyForAutoRun({ detected: true, currentPage: 1, totalPages: 4 })).toBe(true)
  })

  it('false when not detected at all', () => {
    expect(isPaginationReadyForAutoRun({ detected: false, currentPage: null, totalPages: null })).toBe(false)
  })

  it('false for a null/undefined pagination value', () => {
    expect(isPaginationReadyForAutoRun(null)).toBe(false)
    expect(isPaginationReadyForAutoRun(undefined)).toBe(false)
  })

  it('false when currentPage is null even though detected is true', () => {
    expect(isPaginationReadyForAutoRun({ detected: true, currentPage: null, totalPages: 4 })).toBe(false)
  })

  it('false when totalPages is null even though detected is true', () => {
    expect(isPaginationReadyForAutoRun({ detected: true, currentPage: 1, totalPages: null })).toBe(false)
  })

  it('false when currentPage is less than 1 — never a real page number', () => {
    expect(isPaginationReadyForAutoRun({ detected: true, currentPage: 0, totalPages: 4 })).toBe(false)
  })

  it('false when totalPages is less than currentPage — internally inconsistent, never trusted', () => {
    expect(isPaginationReadyForAutoRun({ detected: true, currentPage: 5, totalPages: 4 })).toBe(false)
  })

  it('true when currentPage equals totalPages (the final page)', () => {
    expect(isPaginationReadyForAutoRun({ detected: true, currentPage: 4, totalPages: 4 })).toBe(true)
  })
})

describe('evaluateAutoRunStopCondition', () => {
  function okInput() {
    return {
      gridFound: true,
      paginationReady: true,
      contextRevalidation: okRevalidation,
      columnWritableNow: true,
      headerCheckboxOk: true,
      hasAmbiguousWriteCandidate: false,
    }
  }

  it('does not stop when everything holds', () => {
    expect(evaluateAutoRunStopCondition(okInput())).toEqual({ shouldStop: false, reason: null })
  })

  it('stops when the grid cannot be found', () => {
    const result = evaluateAutoRunStopCondition({ ...okInput(), gridFound: false })
    expect(result.shouldStop).toBe(true)
  })

  it('BUG FIX (item 3): stops with the exact required message when pagination could not be confidently read — never starts/continues a run at an unknown page', () => {
    const result = evaluateAutoRunStopCondition({ ...okInput(), paginationReady: false })
    expect(result.shouldStop).toBe(true)
    expect(result.reason).toBe(PAGINATION_UNKNOWN_MESSAGE)
  })

  it('stops on a subject/classroom/column revalidation failure — the reason is passed straight through', () => {
    const result = evaluateAutoRunStopCondition({
      ...okInput(),
      contextRevalidation: { ok: false, reason: 'ตัวกรองวิชาบนหน้า SGS เปลี่ยนไปตั้งแต่ตอนดูตัวอย่าง — ยกเลิกเพื่อความปลอดภัย' },
    })
    expect(result.shouldStop).toBe(true)
    expect(result.reason).toContain('ตัวกรองวิชา')
  })

  it('stops when the column is no longer writable now', () => {
    expect(evaluateAutoRunStopCondition({ ...okInput(), columnWritableNow: false }).shouldStop).toBe(true)
  })

  it('stops when the header checkbox is no longer enabled', () => {
    expect(evaluateAutoRunStopCondition({ ...okInput(), headerCheckboxOk: false }).shouldStop).toBe(true)
  })

  it('stops when an ambiguous write candidate is present', () => {
    expect(evaluateAutoRunStopCondition({ ...okInput(), hasAmbiguousWriteCandidate: true }).shouldStop).toBe(true)
  })

  it('a page-advance failure surfaces here ONLY as a confirmed context mismatch (via contextRevalidation) — a merely-unconfirmed advance is handled by popup.js\'s manual-continue fallback, never this stop gate', () => {
    const result = evaluateAutoRunStopCondition({
      ...okInput(),
      contextRevalidation: { ok: false, reason: 'รายวิชาบนหน้า SGS เปลี่ยนไปหลังเปลี่ยนหน้า — หยุดเพื่อความปลอดภัย' },
    })
    expect(result.shouldStop).toBe(true)
    expect(result.reason).toContain('รายวิชา')
  })

  it('checks conditions in a fixed order — the FIRST failing one wins, never a batch', () => {
    // Both gridFound and columnWritableNow are false here — gridFound
    // must be reported, not columnWritableNow.
    const result = evaluateAutoRunStopCondition({ ...okInput(), gridFound: false, columnWritableNow: false })
    expect(result.reason).toContain('ไม่พบตารางคะแนนนักเรียน')
  })
})

describe('buildAutoRunPreRunSummary', () => {
  it('reports the pre-run counts item 2 requires, from the first page\'s plan plus detected pagination', () => {
    const plan = computeWholeColumnPlan(
      [kn('k1', 1, 'พร้อมส่ง', 8), kn('k2', 2, 'ไม่มีคะแนน', null), kn('k3', 3, 'มีคะแนนเดิม', 5)],
      [matched('row-0'), matched('row-1'), matched('row-2')],
      { 'row-2': 3 },
      'skip_existing',
      15,
    )
    const pagination = { detected: true, currentPage: 1, totalPages: 4, visibleStudentRows: 10, totalStudentRows: 32 }
    const summary = buildAutoRunPreRunSummary(plan, pagination, 32)
    expect(summary).toEqual({
      rosterCount: 32,
      toSend: 1,
      noScore: 1,
      existingToSkip: 1,
      sgsTotalPages: 4,
      sgsTotalStudents: 32,
    })
  })

  it('reports null pagination counts honestly when pagination was not detected', () => {
    const plan = computeWholeColumnPlan([kn('k1', 1, 'พร้อมส่ง', 8)], [matched('row-0')], {}, 'skip_existing', 15)
    const pagination = { detected: false, currentPage: null, totalPages: null, visibleStudentRows: 1, totalStudentRows: null }
    const summary = buildAutoRunPreRunSummary(plan, pagination, 1)
    expect(summary.sgsTotalPages).toBeNull()
    expect(summary.sgsTotalStudents).toBeNull()
  })
})

describe('summarizeAutoRunPageResult / emptyAutoRunSummary / mergeAutoRunSummaries', () => {
  it('adds invalidScore on top of the same six buckets summarizeWholeColumnResult already produces', () => {
    const students = [
      kn('k1', 1, 'สำเร็จ', 8),
      kn('k2', 2, 'ไม่มีคะแนน', null),
      kn('k3', 3, 'มีคะแนนเดิม', 5),
      kn('k4', 4, 'เกินคะแนนเต็ม', 99),
      kn('k5', 5, 'ไม่พบ', 7),
      kn('k6', 6, 'กำกวม', 7),
    ]
    const mappings = [matched('row-0'), matched('row-1'), matched('row-2'), matched('row-3'), notFound(), ambiguous()]
    const plan = computeWholeColumnPlan(students, mappings, { 'row-2': 3 }, 'skip_existing', 15)
    const { writesByOffset } = buildWholeColumnWriteInstructions(plan, 4)
    const verified = verifyWholeColumnWrite(plan, writesByOffset, { found: true, writtenCount: 1, missingOffsets: [] }, { found: true, values: { 0: 8 } })
    const summary = summarizeAutoRunPageResult(verified)
    expect(summary).toEqual({
      written: 1,
      skippedNoScore: 1,
      skippedExisting: 1,
      notFound: 1,
      ambiguous: 1,
      failed: 0,
      invalidScore: 1,
    })
  })

  it('emptyAutoRunSummary has every field at zero, merges cleanly', () => {
    const empty = emptyAutoRunSummary()
    expect(empty).toEqual({ written: 0, skippedNoScore: 0, skippedExisting: 0, notFound: 0, ambiguous: 0, failed: 0, invalidScore: 0 })
    const page = { written: 5, skippedNoScore: 1, skippedExisting: 1, notFound: 0, ambiguous: 0, failed: 0, invalidScore: 1 }
    expect(mergeAutoRunSummaries(empty, page)).toEqual(page)
  })

  it('mergeAutoRunSummaries adds every field, including invalidScore, across pages', () => {
    const page1 = { written: 8, skippedNoScore: 1, skippedExisting: 1, notFound: 0, ambiguous: 0, failed: 0, invalidScore: 0 }
    const page2 = { written: 7, skippedNoScore: 0, skippedExisting: 0, notFound: 1, ambiguous: 1, failed: 1, invalidScore: 1 }
    expect(mergeAutoRunSummaries(page1, page2)).toEqual({
      written: 15,
      skippedNoScore: 1,
      skippedExisting: 1,
      notFound: 1,
      ambiguous: 1,
      failed: 1,
      invalidScore: 1,
    })
  })
})

describe('countReadyRows', () => {
  it('counts only READY rows', () => {
    const plan = computeWholeColumnPlan(
      [kn('k1', 1, 'พร้อม1', 8), kn('k2', 2, 'พร้อม2', 5), kn('k3', 3, 'ไม่มีคะแนน', null)],
      [matched('row-0'), matched('row-1'), matched('row-2')],
      {},
      'skip_existing',
      15,
    )
    expect(countReadyRows(plan)).toBe(2)
  })
})

describe('collectFailedStudents (reused, unchanged) still works against an auto-run-verified plan', () => {
  it('lists exactly the FAILED rows', () => {
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

describe('buildAutoRunReport — item 9\'s downloadable/copyable report', () => {
  it('contains exactly the required fields, no credential/session/cookie, no internal studentId', () => {
    const report = buildAutoRunReport({
      subjectName: 'สังคมศึกษา3',
      classroomName: '2/1',
      columnLabel: 'ช่อง 10',
      pagesProcessed: [1, 2, 3, 4],
      perStudentResults: [
        { studentNumber: 1, fullName: 'เกศ ศรีคำฉิม', studentId: 'internal-uuid-1', status: 'READY', writeOutcome: 'WRITTEN' },
        { studentNumber: 2, fullName: 'สมชาย ใจดี', studentId: 'internal-uuid-2', status: 'SKIP_NO_SCORE', writeOutcome: null },
      ],
    })
    expect(report.subject).toBe('สังคมศึกษา3')
    expect(report.classroom).toBe('2/1')
    expect(report.sgsColumn).toBe('ช่อง 10')
    expect(report.pagesProcessed).toEqual([1, 2, 3, 4])
    expect(typeof report.timestamp).toBe('string')
    expect(report.students).toEqual([
      { studentNumber: 1, fullName: 'เกศ ศรีคำฉิม', status: 'READY', writeOutcome: 'WRITTEN' },
      { studentNumber: 2, fullName: 'สมชาย ใจดี', status: 'SKIP_NO_SCORE', writeOutcome: null },
    ])
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('internal-uuid')
    expect(serialized.toLowerCase()).not.toMatch(/password|token|cookie|secret|credential|session/)
  })
})

describe('BUG FIX — accumulated results survive all 4 SGS pages of a real 32-student classroom', () => {
  it('merges four 8-student pages into one correct final total, with pagesProcessed listing every page in order', () => {
    let summary = emptyAutoRunSummary()
    let allResults: unknown[] = []
    const pagesProcessed: number[] = []

    for (let page = 1; page <= 4; page++) {
      const students = Array.from({ length: 8 }, (_, i) => kn(`k${page}-${i}`, i + 1, `นักเรียน ${page}-${i}`, i === 0 ? null : 5))
      const mappings = students.map((_, i) => (i === 0 ? matched(`row-${i}`) : matched(`row-${i}`)))
      const plan = computeWholeColumnPlan(students, mappings, {}, 'skip_existing', 15)
      const { writesByOffset } = buildWholeColumnWriteInstructions(plan, 4)
      const fillResult = { found: true, writtenCount: Object.keys(writesByOffset).length, missingOffsets: [] }
      const freshValuesResult = { found: true, values: writesByOffset }
      const verified = verifyWholeColumnWrite(plan, writesByOffset, fillResult, freshValuesResult)
      summary = mergeAutoRunSummaries(summary, summarizeAutoRunPageResult(verified))
      allResults = allResults.concat(verified)
      pagesProcessed.push(page)
    }

    // 4 pages x 8 students = 32; one blank score per page -> 4 skipped,
    // the other 28 all written successfully.
    expect(summary.written).toBe(28)
    expect(summary.skippedNoScore).toBe(4)
    expect(summary.failed).toBe(0)
    expect(allResults.length).toBe(32)
    expect(pagesProcessed).toEqual([1, 2, 3, 4])

    const report = buildAutoRunReport({
      subjectName: 'สังคมศึกษา3',
      classroomName: '2/1',
      columnLabel: 'ช่อง 10',
      pagesProcessed,
      perStudentResults: allResults as never,
    })
    expect(report.students.length).toBe(32)
    expect(report.pagesProcessed).toEqual([1, 2, 3, 4])
  })
})
