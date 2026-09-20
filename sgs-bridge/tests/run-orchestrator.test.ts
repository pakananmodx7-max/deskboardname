import { describe, expect, it } from 'vitest'

import {
  applyAbort,
  applyCompleted,
  applyManualPause,
  applyPageComplete,
  applyPageProgress,
  applyResume,
  applyStopped,
  applyStopRequested,
  AR_MESSAGE,
  AUTO_RUN_STATUS,
  clearPendingAdvance,
  createInitialRunState,
  isPaginationHydrationValid,
  isTerminalStatus,
  PAGINATION_HYDRATION_FAILED_MESSAGE,
  shouldContentScriptProcess,
  withConfirmedContext,
  withPendingAdvance,
} from '../src/lib/run-orchestrator'

function baseInit() {
  return {
    runId: 'run-1',
    tabId: 42,
    subject: 'คณิตศาสตร์',
    classroom: 'ม.2/1',
    targetColumn: { key: 'col-10', label: '10', maxScore: 10 },
    payload: { students: [], skippedStudentIds: [] },
    overwriteMode: 'skip_existing',
  }
}

describe('createInitialRunState', () => {
  it('item 3: stores exactly the fields the spec lists (runId, tabId, subject, classroom, targetColumn, payload, overwriteMode, currentPage, totalPages, summary, approved) plus active/running bookkeeping', () => {
    const state = createInitialRunState(baseInit())
    expect(state.runId).toBe('run-1')
    expect(state.tabId).toBe(42)
    expect(state.subject).toBe('คณิตศาสตร์')
    expect(state.classroom).toBe('ม.2/1')
    expect(state.targetColumn).toEqual({ key: 'col-10', label: '10', maxScore: 10 })
    expect(state.payload).toEqual({ students: [], skippedStudentIds: [] })
    expect(state.overwriteMode).toBe('skip_existing')
    expect(state.currentPage).toBeNull()
    expect(state.totalPages).toBeNull()
    expect(state.summary).toEqual({ written: 0, skippedNoScore: 0, skippedExisting: 0, notFound: 0, ambiguous: 0, failed: 0, invalidScore: 0 })
    expect(state.approved).toBe(true)
    expect(state.active).toBe(true)
    expect(state.status).toBe(AUTO_RUN_STATUS.RUNNING)
  })

  it('starts with no accumulated pages/results/failures — only a page-complete transition ever adds to them', () => {
    const state = createInitialRunState(baseInit())
    expect(state.pagesProcessed).toEqual([])
    expect(state.allStudentResults).toEqual([])
    expect(state.failedStudents).toEqual([])
  })
})

describe('FINAL AUTO-RUN STATE BUG FIX: createInitialRunState HYDRATES pagination immediately — never status "running" with currentPage/totalPages still null', () => {
  it('item 7\'s exact regression: currentPage=1, totalPages=4, totalRows=32, pageSize=10 given at creation time — the initial state already shows page 1 of 4, never "?/?"', () => {
    const state = createInitialRunState({
      ...baseInit(),
      currentPage: 1,
      totalPages: 4,
      totalStudentRows: 32,
      pageSize: 10,
    })
    expect(state.currentPage).toBe(1)
    expect(state.totalPages).toBe(4)
    expect(state.totalStudentRows).toBe(32)
    expect(state.pageSize).toBe(10)
    expect(state.status).toBe(AUTO_RUN_STATUS.RUNNING)
    expect(state.active).toBe(true)
    // Never the bug this whole fix targets: a "running" state must never
    // report an unknown page.
    expect(state.currentPage).not.toBeNull()
    expect(state.totalPages).not.toBeNull()
  })

  it('expectedNextPage starts at the SAME confirmed currentPage — content-script.js\'s very first page-gate check also verifies its own fresh re-scan still matches what was inspected at start time', () => {
    const state = createInitialRunState({ ...baseInit(), currentPage: 1, totalPages: 4 })
    expect(state.expectedNextPage).toBe(1)
  })

  it('without pagination fields (an older caller, or a test not exercising this path), still defaults to null — never crashes, never fabricates a page number', () => {
    const state = createInitialRunState(baseInit())
    expect(state.currentPage).toBeNull()
    expect(state.totalPages).toBeNull()
    expect(state.totalStudentRows).toBeNull()
    expect(state.pageSize).toBeNull()
    expect(state.expectedNextPage).toBeNull()
  })

  it('a plain JSON round-trip (simulating chrome.runtime message passing) preserves every pagination field exactly — no schema mismatch, no field dropped/renamed/reset to null', () => {
    const state = createInitialRunState({ ...baseInit(), currentPage: 1, totalPages: 4, totalStudentRows: 32, pageSize: 10 })
    const roundTripped = JSON.parse(JSON.stringify(state))
    expect(roundTripped.currentPage).toBe(1)
    expect(roundTripped.totalPages).toBe(4)
    expect(roundTripped.totalStudentRows).toBe(32)
    expect(roundTripped.pageSize).toBe(10)
    expect(roundTripped.expectedNextPage).toBe(1)
  })
})

describe('isPaginationHydrationValid — item 6\'s hard guard, shared by popup.js and background.js so neither can drift from the other', () => {
  it('true only when BOTH currentPage and totalPages are real numbers', () => {
    expect(isPaginationHydrationValid({ currentPage: 1, totalPages: 4 })).toBe(true)
    expect(isPaginationHydrationValid({ currentPage: 1, totalPages: 4, totalStudentRows: 32, pageSize: 10 })).toBe(true)
  })

  it('false when either is null/undefined, or the whole object is missing', () => {
    expect(isPaginationHydrationValid({ currentPage: null, totalPages: 4 })).toBe(false)
    expect(isPaginationHydrationValid({ currentPage: 1, totalPages: null })).toBe(false)
    expect(isPaginationHydrationValid({ currentPage: undefined, totalPages: 4 })).toBe(false)
    expect(isPaginationHydrationValid(null)).toBe(false)
    expect(isPaginationHydrationValid(undefined)).toBe(false)
    expect(isPaginationHydrationValid({})).toBe(false)
  })

  it('PAGINATION_HYDRATION_FAILED_MESSAGE is the one shared refusal string both guards show', () => {
    expect(PAGINATION_HYDRATION_FAILED_MESSAGE).toBe('ยังอ่านข้อมูลหน้าของ SGS ไม่สำเร็จ')
  })
})

describe('shouldContentScriptProcess — the ONE gate a content script must pass before scanning/writing anything', () => {
  it('is true only for a running, approved, active run belonging to the EXACT requesting tab', () => {
    const state = createInitialRunState(baseInit())
    expect(shouldContentScriptProcess(state, 42)).toBe(true)
  })

  it('is false for a different tab id — a stale run from a previously-used tab is never picked up by an unrelated tab', () => {
    const state = createInitialRunState(baseInit())
    expect(shouldContentScriptProcess(state, 99)).toBe(false)
  })

  it('is false once stopped requested — the content script must not start a new page while a stop is pending', () => {
    const state = applyStopRequested(createInitialRunState(baseInit()))
    expect(shouldContentScriptProcess(state, 42)).toBe(false)
  })

  it('is false while paused for manual continue — only an explicit AR_MANUAL_CONTINUE (applyResume) clears the pause', () => {
    const state = applyManualPause(createInitialRunState(baseInit()), { reason: 'no confirmed control', expectedNextPage: 2 })
    expect(shouldContentScriptProcess(state, 42)).toBe(false)
    const resumed = applyResume(state)
    expect(shouldContentScriptProcess(resumed, 42)).toBe(true)
  })

  it('is false for any terminal state (completed/stopped/aborted)', () => {
    const state = createInitialRunState(baseInit())
    expect(shouldContentScriptProcess(applyCompleted(state), 42)).toBe(false)
    expect(shouldContentScriptProcess(applyStopped(state), 42)).toBe(false)
    expect(shouldContentScriptProcess(applyAbort(state, 'mismatch'), 42)).toBe(false)
  })

  it('is false for a null state — no run recorded for this tab at all', () => {
    expect(shouldContentScriptProcess(null, 42)).toBe(false)
  })
})

describe('a full 4-page run sequence — page 1 -> page 2 -> page 3 -> page 4 -> completed, matching item 9\'s test list', () => {
  it('accumulates each page\'s summary/pagesProcessed/allStudentResults across all four pages, then reaches COMPLETED with active=false', () => {
    let state = createInitialRunState(baseInit())

    for (let page = 1; page <= 4; page++) {
      state = applyPageProgress(state, { pageNumber: page, totalPages: 4, runningSummary: state.summary })
      if (page === 1) {
        state = withConfirmedContext(state, { subjectFilterText: 'คณิตศาสตร์', classroomFilterText: 'ม.2 กลุ่ม 1', columnKey: 'col-10' })
      }
      state = applyPageComplete(state, {
        pageNumber: page,
        pageSummary: { written: 8, skippedNoScore: 0, skippedExisting: 0, notFound: 0, ambiguous: 0, failed: 0, invalidScore: 0 },
        failedStudents: [],
        studentResults: [{ studentNumber: page, fullName: `Student ${page}`, writeOutcome: 'WRITTEN' }],
      })
    }

    state = applyCompleted(state)

    expect(state.pagesProcessed).toEqual([1, 2, 3, 4])
    expect(state.allStudentResults).toHaveLength(4)
    expect(state.summary.written).toBe(32)
    expect(state.status).toBe(AUTO_RUN_STATUS.COMPLETED)
    expect(state.active).toBe(false)
    expect(state.approved).toBe(false)
    expect(isTerminalStatus(state.status)).toBe(true)
  })

  it('the confirmed context, once set from the first successful page, is never overwritten by a later page\'s own values (withConfirmedContext no-ops once set)', () => {
    let state = createInitialRunState(baseInit())
    state = withConfirmedContext(state, { subjectFilterText: 'คณิตศาสตร์', classroomFilterText: 'ม.2 กลุ่ม 1', columnKey: 'col-10' })
    const driftedAttempt = withConfirmedContext(state, { subjectFilterText: 'วิทยาศาสตร์', classroomFilterText: 'ม.2 กลุ่ม 1', columnKey: 'col-10' })
    expect(driftedAttempt.confirmedContext.subjectFilterText).toBe('คณิตศาสตร์')
  })
})

describe('state survives a reload/reopen — resumption is driven entirely by the persisted state\'s own fields, never anything popup.js reconstructs locally', () => {
  it('a state with status RUNNING and matching tabId is exactly what a fresh content-script.js instance is allowed to continue processing', () => {
    let state = createInitialRunState(baseInit())
    state = applyPageComplete(
      applyPageProgress(state, { pageNumber: 1, totalPages: 4, runningSummary: state.summary }),
      { pageNumber: 1, pageSummary: { written: 8, skippedNoScore: 0, skippedExisting: 0, notFound: 0, ambiguous: 0, failed: 0, invalidScore: 0 }, failedStudents: [], studentResults: [] },
    )
    // Simulate "popup closed, SGS posted back to page 2, a fresh
    // content-script.js instance loaded" — the SAME state object
    // (as background.js would hand back from chrome.storage.session)
    // is still enough on its own to decide whether to keep going.
    expect(shouldContentScriptProcess(state, state.tabId)).toBe(true)
    expect(state.pagesProcessed).toEqual([1])
  })

  it('a pending advance survives being handed to a fresh instance via withPendingAdvance/clearPendingAdvance', () => {
    let state = createInitialRunState(baseInit())
    const pendingAdvance = { expectedNextPage: 2, beforeFingerprint: 'a|b', confirmedContext: null, targetColumnKey: 'col-10' }
    state = withPendingAdvance(state, pendingAdvance)
    expect(state.pendingAdvance).toEqual(pendingAdvance)
    state = clearPendingAdvance(state)
    expect(state.pendingAdvance).toBeNull()
  })
})

describe('wrong subject/classroom/page/column each abort immediately (item 5) — content-script.js reports these via AR_ABORT, and applyAbort is the ONE place that ends the run for any of them', () => {
  it('applyAbort sets a terminal ABORTED status, active=false, approved=false, and records the given reason verbatim', () => {
    const state = applyAbort(createInitialRunState(baseInit()), 'รายวิชาบนหน้า SGS ไม่ตรงกับ Bridge Payload ที่โหลดไว้ — หยุดเพื่อความปลอดภัย')
    expect(state.status).toBe(AUTO_RUN_STATUS.ABORTED)
    expect(state.abortReason).toBe('รายวิชาบนหน้า SGS ไม่ตรงกับ Bridge Payload ที่โหลดไว้ — หยุดเพื่อความปลอดภัย')
    expect(state.active).toBe(false)
    expect(state.approved).toBe(false)
  })

  it('once aborted, no further processing is ever permitted for that tab again', () => {
    const state = applyAbort(createInitialRunState(baseInit()), 'ห้องเรียนไม่ตรงกัน')
    expect(shouldContentScriptProcess(state, state.tabId)).toBe(false)
  })
})

describe('Stop works (item 6): applyStopRequested only sets a flag; only applyStopped (after the current cell finishes) ends the run', () => {
  it('a stop request alone does not end the run — it stays RUNNING until the content script reports AR_STOPPED', () => {
    const state = applyStopRequested(createInitialRunState(baseInit()))
    expect(state.status).toBe(AUTO_RUN_STATUS.RUNNING)
    expect(state.active).toBe(true)
    expect(state.stopRequested).toBe(true)
  })

  it('applyStopped ends the run with a terminal STOPPED_BY_USER status', () => {
    const state = applyStopped(applyStopRequested(createInitialRunState(baseInit())))
    expect(state.status).toBe(AUTO_RUN_STATUS.STOPPED_BY_USER)
    expect(state.active).toBe(false)
    expect(state.approved).toBe(false)
    expect(isTerminalStatus(state.status)).toBe(true)
  })
})

describe('final 32-student summary persists (item 7): the reducer never discards accumulated state on any terminal transition', () => {
  it('applyCompleted/applyStopped/applyAbort all preserve summary/pagesProcessed/allStudentResults exactly as accumulated so far', () => {
    let state = createInitialRunState(baseInit())
    state = applyPageComplete(state, {
      pageNumber: 1,
      pageSummary: { written: 32, skippedNoScore: 0, skippedExisting: 0, notFound: 0, ambiguous: 0, failed: 0, invalidScore: 0 },
      failedStudents: [],
      studentResults: Array.from({ length: 32 }, (_, i) => ({ studentNumber: i + 1, fullName: `S${i + 1}`, writeOutcome: 'WRITTEN' })),
    })
    const completed = applyCompleted(state)
    expect(completed.summary.written).toBe(32)
    expect(completed.allStudentResults).toHaveLength(32)

    const stopped = applyStopped(state)
    expect(stopped.summary.written).toBe(32)

    const aborted = applyAbort(state, 'reason')
    expect(aborted.summary.written).toBe(32)
  })
})

describe('AR_MESSAGE — every sender/receiver pair in this codebase shares the exact same string constants', () => {
  it('defines the full popup<->background<->content-script vocabulary this message protocol relies on', () => {
    expect(AR_MESSAGE.START).toBe('AR_START')
    expect(AR_MESSAGE.STOP).toBe('AR_STOP')
    expect(AR_MESSAGE.GET_STATE).toBe('AR_GET_STATE')
    expect(AR_MESSAGE.MANUAL_CONTINUE).toBe('AR_MANUAL_CONTINUE')
    expect(AR_MESSAGE.CHECK_ACTIVE).toBe('AR_CHECK_ACTIVE')
    expect(AR_MESSAGE.PENDING_ADVANCE).toBe('AR_PENDING_ADVANCE')
    expect(AR_MESSAGE.PAGE_PROGRESS).toBe('AR_PAGE_PROGRESS')
    expect(AR_MESSAGE.PAGE_COMPLETE).toBe('AR_PAGE_COMPLETE')
    expect(AR_MESSAGE.ADVANCE_CONFIRMED).toBe('AR_ADVANCE_CONFIRMED')
    expect(AR_MESSAGE.MANUAL_PAUSE).toBe('AR_MANUAL_PAUSE')
    expect(AR_MESSAGE.ABORT).toBe('AR_ABORT')
    expect(AR_MESSAGE.STOPPED).toBe('AR_STOPPED')
    expect(AR_MESSAGE.COMPLETE).toBe('AR_COMPLETE')
    expect(AR_MESSAGE.KICKOFF).toBe('AR_KICKOFF')
    expect(AR_MESSAGE.RESUME).toBe('AR_RESUME')
    expect(AR_MESSAGE.STATE_CHANGED).toBe('AR_STATE_CHANGED')
  })
})
