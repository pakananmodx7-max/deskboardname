import { describe, expect, it } from 'vitest'

import {
  appendDebugEvent,
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
  CONTENT_SCRIPT_UNAVAILABLE_MESSAGE,
  createInitialRunState,
  DEBUG_LOG_MAX_ENTRIES,
  isPaginationHydrationValid,
  isTerminalStatus,
  PAGINATION_HYDRATION_FAILED_MESSAGE,
  runIdFromWatchdogAlarmName,
  shouldAbortForMissingProcessing,
  shouldContentScriptProcess,
  watchdogAlarmName,
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

  it('FINAL AUTO-RUN EXECUTION BUG FIX (item 7 — "run state survives worker suspension"): the SAME JSON round-trip also preserves hasStartedProcessing/debugLog exactly — a suspended-then-woken service worker re-reading chrome.storage.session sees the identical shape it persisted', () => {
    let state = createInitialRunState({ ...baseInit(), currentPage: 1, totalPages: 4, totalStudentRows: 32, pageSize: 10 })
    state = applyPageProgress(state, { pageNumber: 1, totalPages: 4, runningSummary: state.summary })
    state = appendDebugEvent(state, { event: 'PAGE_SCAN_OK', detail: { page: 1 } })
    const roundTripped = JSON.parse(JSON.stringify(state))
    expect(roundTripped.hasStartedProcessing).toBe(true)
    expect(roundTripped.debugLog).toEqual(state.debugLog)
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

describe('FINAL AUTO-RUN EXECUTION BUG FIX: hasStartedProcessing — proof page-1 processing actually began, never inferred from status alone', () => {
  it('starts false on a brand-new run, even one hydrated with valid pagination — a run existing is not proof it ever began processing a page', () => {
    const state = createInitialRunState({ ...baseInit(), currentPage: 1, totalPages: 4, totalStudentRows: 32, pageSize: 10 })
    expect(state.hasStartedProcessing).toBe(false)
  })

  it('item 7\'s exact regression: "progress changes 0 -> page1 count" — applyPageProgress (content-script.js\'s FIRST report for page 1, sent before any cell write) flips it true immediately, well before applyPageComplete ever accumulates a single result', () => {
    let state = createInitialRunState({ ...baseInit(), currentPage: 1, totalPages: 4, totalStudentRows: 32, pageSize: 10 })
    expect(state.hasStartedProcessing).toBe(false)
    expect(state.allStudentResults.length).toBe(0)

    state = applyPageProgress(state, { pageNumber: 1, totalPages: 4, totalStudentRows: 32, pageSize: 10, runningSummary: state.summary })
    expect(state.hasStartedProcessing).toBe(true)
    // processedCount (what popup.js's renderAutoRunLiveProgress shows) is
    // still allStudentResults.length, which only grows on PAGE_COMPLETE —
    // AR_PAGE_PROGRESS alone never fabricates a processed count.
    expect(state.allStudentResults.length).toBe(0)

    const tenResults = Array.from({ length: 10 }, (_, i) => ({ studentId: `s${i}`, writeOutcome: 'WRITTEN' }))
    state = applyPageComplete(state, { pageNumber: 1, pageSummary: { written: 10 }, failedStudents: [], studentResults: tenResults })
    expect(state.allStudentResults.length).toBe(10)
  })

  it('never reset back to false by anything once true — a later page\'s own applyPageProgress call still leaves it true', () => {
    let state = createInitialRunState({ ...baseInit(), currentPage: 1, totalPages: 4 })
    state = applyPageProgress(state, { pageNumber: 1, totalPages: 4, runningSummary: state.summary })
    state = applyPageProgress(state, { pageNumber: 2, totalPages: 4, runningSummary: state.summary })
    expect(state.hasStartedProcessing).toBe(true)
  })
})

describe('FINAL AUTO-RUN EXECUTION BUG FIX: the watchdog — item 6\'s "never leave a dead run" (status=running, processed=0, forever)', () => {
  it('CONTENT_SCRIPT_UNAVAILABLE_MESSAGE is the one shared refusal/abort string for both "no PING response before start" and "watchdog fired" ', () => {
    expect(CONTENT_SCRIPT_UNAVAILABLE_MESSAGE).toBe('ไม่พบตัวเชื่อมหน้า SGS กรุณารีเฟรชหน้า SGS แล้วลองใหม่')
  })

  it('watchdogAlarmName/runIdFromWatchdogAlarmName round-trip a runId exactly, and never confuse a plain runId string for an alarm name that merely happens to look similar', () => {
    expect(watchdogAlarmName('run-1')).toBe('sgsBridgeAutoRunWatchdog:run-1')
    expect(runIdFromWatchdogAlarmName('sgsBridgeAutoRunWatchdog:run-1')).toBe('run-1')
    expect(runIdFromWatchdogAlarmName('some-other-alarm')).toBeNull()
    expect(runIdFromWatchdogAlarmName('run-1')).toBeNull()
  })

  it('"run state survives worker suspension" (item 7): shouldAbortForMissingProcessing takes only the ALREADY-PERSISTED state and an alarm name — no in-memory value the alarm firing after a worker restart could ever have lost', () => {
    const state = createInitialRunState({ ...baseInit(), runId: 'run-1', currentPage: 1, totalPages: 4 })
    expect(shouldAbortForMissingProcessing(state, runIdFromWatchdogAlarmName(watchdogAlarmName('run-1')))).toBe(true)
  })

  it('"no dead running state at 0/32" (item 7): aborts a run that is still running and has NEVER reported hasStartedProcessing', () => {
    const state = createInitialRunState({ ...baseInit(), runId: 'run-1', currentPage: 1, totalPages: 4 })
    expect(shouldAbortForMissingProcessing(state, 'run-1')).toBe(true)
    const aborted = applyAbort(state, CONTENT_SCRIPT_UNAVAILABLE_MESSAGE)
    expect(aborted.status).toBe(AUTO_RUN_STATUS.ABORTED)
    expect(aborted.abortReason).toBe(CONTENT_SCRIPT_UNAVAILABLE_MESSAGE)
    expect(aborted.active).toBe(false)
  })

  it('never aborts a run that already reported page-1 progress, however long page 1 itself is still taking', () => {
    let state = createInitialRunState({ ...baseInit(), runId: 'run-1', currentPage: 1, totalPages: 4 })
    state = applyPageProgress(state, { pageNumber: 1, totalPages: 4, runningSummary: state.summary })
    expect(shouldAbortForMissingProcessing(state, 'run-1')).toBe(false)
  })

  it('never aborts a run the alarm does not actually belong to (a stale/previous run\'s own already-fired alarm)', () => {
    const state = createInitialRunState({ ...baseInit(), runId: 'run-2', currentPage: 1, totalPages: 4 })
    expect(shouldAbortForMissingProcessing(state, 'run-1')).toBe(false)
  })

  it('never aborts a run that is not (or no longer) "running" — already paused/aborted/stopped/completed runs are left alone', () => {
    const runningState = createInitialRunState({ ...baseInit(), runId: 'run-1', currentPage: 1, totalPages: 4 })
    const stoppedState = applyStopped(runningState)
    expect(shouldAbortForMissingProcessing(stoppedState, 'run-1')).toBe(false)
  })

  it('never aborts when there is no persisted state at all (e.g. a teacher already started a brand-new run before the old alarm fired)', () => {
    expect(shouldAbortForMissingProcessing(null, 'run-1')).toBe(false)
  })
})

describe('FINAL AUTO-RUN EXECUTION BUG FIX: appendDebugEvent — item 4\'s message trace, capped so a long run\'s state never grows unbounded', () => {
  it('appends one {ts, event, detail} entry per call, in order', () => {
    let state = createInitialRunState(baseInit())
    state = appendDebugEvent(state, { event: 'PAGE_SCAN_OK', detail: { page: 1 } })
    state = appendDebugEvent(state, { event: 'PAGE_PLAN_READY', detail: { planLength: 10 } })
    expect(state.debugLog.map((e) => e.event)).toEqual(['PAGE_SCAN_OK', 'PAGE_PLAN_READY'])
    expect(state.debugLog[0].detail).toEqual({ page: 1 })
    expect(typeof state.debugLog[0].ts).toBe('number')
  })

  it('a missing detail defaults to null rather than undefined (JSON-round-trip safe)', () => {
    let state = createInitialRunState(baseInit())
    state = appendDebugEvent(state, { event: 'AR_START received' })
    expect(state.debugLog[0].detail).toBeNull()
  })

  it(`caps the log at the most recent ${DEBUG_LOG_MAX_ENTRIES} entries — a long run's persisted state never grows without bound`, () => {
    let state = createInitialRunState(baseInit())
    for (let i = 0; i < DEBUG_LOG_MAX_ENTRIES + 5; i++) {
      state = appendDebugEvent(state, { event: `EVENT_${i}` })
    }
    expect(state.debugLog.length).toBe(DEBUG_LOG_MAX_ENTRIES)
    expect(state.debugLog[0].event).toBe('EVENT_5')
    expect(state.debugLog[state.debugLog.length - 1].event).toBe(`EVENT_${DEBUG_LOG_MAX_ENTRIES + 4}`)
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

  it('FINAL SGS AUTO-RUN FIX: PING/CONTENT_READY/STARTUP_TRACE — the content-script connection handshake vocabulary', () => {
    expect(AR_MESSAGE.PING).toBe('AR_PING')
    expect(AR_MESSAGE.CONTENT_READY).toBe('AR_SGS_CONTENT_READY')
    expect(AR_MESSAGE.STARTUP_TRACE).toBe('AR_STARTUP_TRACE')
  })
})
