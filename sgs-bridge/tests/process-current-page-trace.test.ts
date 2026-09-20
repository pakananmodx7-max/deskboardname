import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeLibsControl, resetFakeLibs } from './fixtures/fake-libs.js'

/**
 * THE FAILURE BOUNDARY, AS AN EXECUTED TEST.
 *
 * The live trace ended at CONTENT_SCRIPT_RECEIVED with processed 0/32,
 * no PING detail and no error — proving popup -> background -> the right
 * tab -> content script all worked, and that the stop was inside the
 * PROCESS_CURRENT_PAGE path.
 *
 * ROOT CAUSE (fixed in background.js): a content script cannot know its
 * own tabId, so it sends AR_GET_STATE without one. AR_GET_STATE was the
 * only content-script-reachable handler reading `message.tabId` instead
 * of the sender's own tab, so stateForTab compared `state.tabId ===
 * undefined`, returned null, and the KICKOFF handler's
 * `if (stateResponse?.state)` silently skipped processCurrentPage.
 *
 * content-script.js delegates every DOM read to the modules it imports
 * via chrome.runtime.getURL, and otherwise touches only `window` and
 * `location`. Pointing all eight of those URLs at tests/fixtures/fake-libs.js
 * therefore runs the REAL handler, in Node, with no DOM and nothing about
 * the pipeline reimplemented.
 */

const RUN_TAB_ID = 2121095410

function runState(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-1',
    tabId: RUN_TAB_ID,
    status: 'running',
    approved: true,
    active: true,
    stopRequested: false,
    subject: 'คณิตศาสตร์',
    classroom: 'ม.5/2',
    targetColumn: { key: 'real-11-6', label: '10', maxScore: 10 },
    payload: { students: [{ studentId: 's1', studentNumber: 1, fullName: 'ทดสอบ ระบบ', score: 8 }] },
    overwriteMode: 'skip_existing',
    currentPage: 1,
    totalPages: 1,
    confirmedContext: null,
    expectedNextPage: null,
    summary: {},
    ...overrides,
  }
}

interface Harness {
  traces: { step: string; detail: Record<string, unknown> }[]
  sent: Record<string, unknown>[]
  listeners: ((message: Record<string, unknown>, sender: unknown, sendResponse: (r: unknown) => void) => boolean | undefined)[]
  /** What background answers AR_GET_STATE with. */
  stateReply: { state: Record<string, unknown> | null }
}

/** Loads the real content-script.js with a chrome stub whose getURL
 * points every lib at the fake module. */
async function loadContentScript(options: { stateReply?: { state: Record<string, unknown> | null } } = {}): Promise<Harness> {
  const fakeLibsUrl = new URL('./fixtures/fake-libs.js', import.meta.url).href
  const harness: Harness = {
    traces: [],
    sent: [],
    listeners: [],
    stateReply: options.stateReply ?? { state: runState() },
  }

  const chromeStub = {
    runtime: {
      getURL: () => fakeLibsUrl,
      sendMessage: vi.fn(async (message: Record<string, unknown>) => {
        harness.sent.push(message)
        if (message.type === 'AR_PROCESS_TRACE') {
          harness.traces.push({ step: String(message.step), detail: (message.detail ?? {}) as Record<string, unknown> })
          return { ok: true }
        }
        if (message.type === 'AR_GET_STATE') return harness.stateReply
        if (message.type === 'AR_CHECK_ACTIVE') return { shouldProcess: false, state: null, pendingAdvance: null }
        return { ok: true }
      }),
      onMessage: {
        addListener: vi.fn((listener: Harness['listeners'][number]) => {
          harness.listeners.push(listener)
        }),
      },
    },
  }

  vi.stubGlobal('chrome', chromeStub)
  vi.stubGlobal('window', {})
  vi.stubGlobal('location', { href: 'https://sgs.bopp-obec.info/sgs/TblTranscripts/Edit-TblTranscripts-Table.aspx' })
  vi.resetModules()
  await import('../src/content-script.js')
  return harness
}

/** Lets the handler's detached async pipeline finish. It contains REAL
 * settle delays (POST_WRITE_SETTLE_MS = 250ms between write and
 * read-back), so draining microtasks alone is not enough — this waits
 * out real elapsed time as well. */
async function drain() {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 60))
}

/** Delivers an AR_KICKOFF exactly as background.js does, then lets the
 * handler's detached async pipeline settle. */
async function deliverKickoff(harness: Harness) {
  const listener = harness.listeners[0]
  expect(listener, 'content-script.js must register an onMessage listener').toBeTypeOf('function')
  const responses: unknown[] = []
  listener({ type: 'AR_KICKOFF', runId: 'run-1' }, {}, (r) => responses.push(r))
  await drain()
  return responses
}

const steps = (harness: Harness) => harness.traces.map((t) => t.step)
const traceDetail = (harness: Harness, step: string) => harness.traces.find((t) => t.step === step)?.detail ?? null

beforeEach(() => {
  resetFakeLibs()
  vi.unstubAllGlobals()
})

describe('PROCESS_CURRENT_PAGE received -> handler entered -> live scan -> PAGE_SCAN_OK -> PAGE_PLAN_READY', () => {
  it('emits the full required checkpoint sequence, in order, when a run state comes back', async () => {
    const harness = await loadContentScript()
    await deliverKickoff(harness)

    const ordered = [
      'PAYLOAD_STATE_READ_BEGIN',
      'PAYLOAD_STATE_READ_OK',
      'PROCESS_HANDLER_ENTER',
      'LIVE_SCAN_BEGIN',
      'LIVE_SCAN_RESULT',
      'PAGE_SCAN_OK',
      'VALIDATION_BEGIN',
      'VALIDATION_RESULT',
      'PAGE_PLAN_BUILD_BEGIN',
      'PAGE_PLAN_BUILD_RESULT',
      'PAGE_PLAN_READY',
    ]
    let previous = -1
    for (const step of ordered) {
      const index = steps(harness).indexOf(step)
      expect(index, `missing checkpoint ${step} (got: ${steps(harness).join(' -> ')})`).toBeGreaterThan(-1)
      expect(index, `checkpoint ${step} out of order`).toBeGreaterThan(previous)
      previous = index
    }
  })

  it('the pipeline actually runs: the live scan succeeded, a plan was built, and the run reported progress', async () => {
    const harness = await loadContentScript()
    await deliverKickoff(harness)

    expect(traceDetail(harness, 'LIVE_SCAN_RESULT')?.scanOk).toBe(true)
    expect(traceDetail(harness, 'PAGE_PLAN_BUILD_RESULT')?.planLength).toBe(1)
    expect(traceDetail(harness, 'VALIDATION_RESULT')?.gateOk).toBe(true)
    expect(harness.sent.some((m) => m.type === 'AR_PAGE_PROGRESS')).toBe(true)
    expect(harness.sent.some((m) => m.type === 'AR_PAGE_COMPLETE')).toBe(true)
    expect(fakeLibsControl.calls).toContain('fillSgsColumnValues')
  })

  it('REGRESSION — the exact live bug: a null run state no longer stops the handler silently', async () => {
    const harness = await loadContentScript({ stateReply: { state: null } })
    await deliverKickoff(harness)

    // It still declines to process (correctly — there is no run), but it
    // is now LOUD about it, which is the whole point.
    expect(steps(harness)).toContain('PAYLOAD_STATE_READ_BEGIN')
    expect(steps(harness)).toContain('PAYLOAD_STATE_READ_FAILED')
    expect(steps(harness)).not.toContain('PROCESS_HANDLER_ENTER')
    expect(String(traceDetail(harness, 'PAYLOAD_STATE_READ_FAILED')?.abortReason)).toContain('GET_STATE')
  })

  it('answers the KICKOFF message immediately rather than holding the port open for the whole pipeline', async () => {
    const harness = await loadContentScript()
    const responses = await deliverKickoff(harness)
    expect(responses[0]).toEqual({ ok: true })
  })
})

describe('an exception is surfaced as PROCESS_CURRENT_PAGE_FAILED, never a silent 0/32', () => {
  it('reports the failing STEP, errorName, errorMessage and stack when the live scan throws', async () => {
    const harness = await loadContentScript()
    fakeLibsControl.throwAt = 'collectAllTableRowFacts'
    await deliverKickoff(harness)

    expect(steps(harness)).toContain('PROCESS_CURRENT_PAGE_FAILED')
    const failure = traceDetail(harness, 'PROCESS_CURRENT_PAGE_FAILED')
    expect(failure?.step).toBe('LIVE_SCAN_BEGIN')
    expect(failure?.errorName).toBe('TypeError')
    expect(String(failure?.errorMessage)).toContain('collectAllTableRowFacts')
    expect(typeof failure?.stack).toBe('string')
    // ...and the run is aborted rather than left hanging at 0/32.
    const abort = harness.sent.find((m) => m.type === 'AR_ABORT')
    expect(abort).toBeTruthy()
    expect(String(abort?.reason)).toContain('LIVE_SCAN_BEGIN')
  })

  it('names a LATER step when the failure happens later in the pipeline — the report points at the real statement', async () => {
    const harness = await loadContentScript()
    fakeLibsControl.throwAt = 'computeWholeColumnPlan'
    await deliverKickoff(harness)

    const failure = traceDetail(harness, 'PROCESS_CURRENT_PAGE_FAILED')
    expect(failure?.step).toBe('PAGE_PLAN_BUILD_BEGIN')
    // Everything before the failure still got traced, so the boundary is
    // unambiguous.
    expect(steps(harness)).toContain('PAGE_SCAN_OK')
    expect(steps(harness)).not.toContain('PAGE_PLAN_READY')
  })

  it('a throw inside the gate evaluation is caught too — no step in the window can fail silently', async () => {
    const harness = await loadContentScript()
    fakeLibsControl.throwAt = 'evaluateSubjectClassroomMatch'
    await deliverKickoff(harness)

    const failure = traceDetail(harness, 'PROCESS_CURRENT_PAGE_FAILED')
    expect(failure?.step).toBe('VALIDATION_BEGIN')
    expect(String(failure?.abortReason)).toContain('VALIDATION_BEGIN')
  })

  it('re-entrancy declines loudly rather than returning with nothing recorded', async () => {
    const harness = await loadContentScript()
    const listener = harness.listeners[0]
    // Two kickoffs back to back: the second must not vanish.
    listener({ type: 'AR_KICKOFF', runId: 'run-1' }, {}, () => {})
    listener({ type: 'AR_KICKOFF', runId: 'run-1' }, {}, () => {})
    await drain()

    expect(steps(harness).filter((s) => s === 'PROCESS_HANDLER_ENTER' || s === 'PROCESS_HANDLER_SKIPPED_ALREADY_RUNNING').length).toBeGreaterThanOrEqual(
      1,
    )
  })
})
