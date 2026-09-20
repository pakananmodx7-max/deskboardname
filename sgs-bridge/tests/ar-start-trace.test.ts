import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * CRITICAL REGRESSION TEST — the exact live sequence that produced the
 * reported contradiction:
 *
 *   1. the connection diagnostic verifies tab 2121095410 -> CONNECTED
 *   2. another Chrome window may be active
 *   3. the teacher clicks "เริ่มส่งครบทั้งห้อง" (Full Auto)
 *   4. that SAME tab 2121095410 still answers PING
 *
 * ...and yet AR_START came back with the generic
 * "ไม่พบตัวเชื่อมหน้า SGS กรุณารีเฟรชหน้า SGS แล้วลองใหม่", 0 students
 * processed, 0 scores written.
 *
 * Unlike this package's other suites (source-text guards over files that
 * can only run inside Chrome), these are REAL executed tests: background.js
 * and sgs-tab-connection.js are imported for real against a hand-built
 * `chrome` stub, so the assertions below are about what the code actually
 * DOES, not how it is written. That is the only way to prove the required
 * invariant — that it is structurally impossible to return the generic
 * message after the same verified tab answered PING_OK.
 */

const VERIFIED_TAB_ID = 2121095410
const VERIFIED_PAGE_URL = 'https://sgs.bopp-obec.info/sgs/TblTranscripts/Edit-TblTranscripts-Table.aspx'

interface ChromeStubOptions {
  /** tabId -> how that tab answers a PING (or an Error it throws). */
  pingResponders?: Record<number, { ok: true; pageUrl?: string } | { throws: string }>
  /** What chrome.tabs.query({url}) returns — deliberately separate from
   * pingResponders, so a test can model "the verified tab answers PING
   * but the URL query never even lists it." */
  queryResult?: { id: number; url?: string }[]
  /** How the tab answers AR_KICKOFF (defaults to a plain ack). */
  kickoffThrows?: string
}

function createChromeStub(options: ChromeStubOptions = {}) {
  const sessionStore: Record<string, unknown> = {}
  const sentMessages: { tabId: number; message: Record<string, unknown> }[] = []
  const broadcasts: Record<string, unknown>[] = []
  const messageListeners: ((
    message: Record<string, unknown>,
    sender: Record<string, unknown>,
    sendResponse: (response: unknown) => void,
  ) => boolean | undefined)[] = []

  const tabsQuery = vi.fn(async () => options.queryResult ?? [])

  const tabsSendMessage = vi.fn(async (tabId: number, message: Record<string, unknown>) => {
    sentMessages.push({ tabId, message })
    if (message.type === 'AR_KICKOFF') {
      if (options.kickoffThrows) throw new Error(options.kickoffThrows)
      return { ok: true }
    }
    if (message.type === 'AR_PING') {
      const responder = options.pingResponders?.[tabId]
      if (!responder) throw new Error('Could not establish connection. Receiving end does not exist.')
      if ('throws' in responder) throw new Error(responder.throws)
      return { ok: true, ready: true, pageUrl: responder.pageUrl ?? VERIFIED_PAGE_URL }
    }
    return undefined
  })

  return {
    stub: {
      storage: {
        session: {
          get: vi.fn(async (key: string) => (key in sessionStore ? { [key]: sessionStore[key] } : {})),
          set: vi.fn(async (entries: Record<string, unknown>) => {
            Object.assign(sessionStore, entries)
          }),
        },
      },
      tabs: {
        query: tabsQuery,
        sendMessage: tabsSendMessage,
        reload: vi.fn(async () => {}),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      scripting: { executeScript: vi.fn(async () => [{ result: null }]) },
      alarms: { create: vi.fn(async () => {}), clear: vi.fn(async () => {}), onAlarm: { addListener: vi.fn() } },
      runtime: {
        sendMessage: vi.fn(async (message: Record<string, unknown>) => {
          broadcasts.push(message)
          return undefined
        }),
        onMessage: {
          addListener: vi.fn((listener: (typeof messageListeners)[number]) => {
            messageListeners.push(listener)
          }),
        },
      },
    },
    sessionStore,
    sentMessages,
    broadcasts,
    messageListeners,
    tabsQuery,
    tabsSendMessage,
  }
}

function validStartMessage(overrides: Record<string, unknown> = {}) {
  return {
    type: 'AR_START',
    tabId: VERIFIED_TAB_ID,
    subject: 'คณิตศาสตร์',
    classroom: 'ม.5/2',
    targetColumn: { key: 'real-11-6', label: '10', maxScore: 10 },
    payload: { students: [{ studentId: 's1', studentNumber: 1, fullName: 'ทดสอบ ระบบ', score: 8 }] },
    overwriteMode: 'skip_existing',
    pagination: { currentPage: 1, totalPages: 3, totalStudentRows: 32, pageSize: 12 },
    ...overrides,
  }
}

/** Loads background.js fresh against `stub`, then drives one AR_START
 * through its real chrome.runtime.onMessage listener — exactly as the
 * popup does live — and returns whatever it responded with. */
async function runHandleStart(stub: unknown, harness: ReturnType<typeof createChromeStub>, message: Record<string, unknown>) {
  vi.stubGlobal('chrome', stub)
  vi.resetModules()
  await import('../src/background.js')

  const listener = harness.messageListeners[0]
  expect(listener, 'background.js must register a chrome.runtime.onMessage listener').toBeTypeOf('function')

  return await new Promise<Record<string, unknown>>((resolve) => {
    listener(message, { tab: undefined }, (response) => resolve(response as Record<string, unknown>))
  })
}

/** Every startup-trace step background.js recorded, in order. */
function tracedSteps(harness: ReturnType<typeof createChromeStub>): string[] {
  return harness.broadcasts.filter((m) => m.type === 'AR_STARTUP_TRACE').map((m) => String(m.step))
}

function traceDetail(harness: ReturnType<typeof createChromeStub>, step: string): Record<string, unknown> | null {
  const entry = harness.broadcasts.filter((m) => m.type === 'AR_STARTUP_TRACE').find((m) => m.step === step)
  return entry ? ((entry.detail ?? {}) as Record<string, unknown>) : null
}

const CONTENT_SCRIPT_UNAVAILABLE_MESSAGE = 'ไม่พบตัวเชื่อมหน้า SGS กรุณารีเฟรชหน้า SGS แล้วลองใหม่'

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('CRITICAL REGRESSION — the verified tab answers PING, so AR_START must succeed', () => {
  it('reproduces the exact live sequence: tab 2121095410 verified CONNECTED, another window active (chrome.tabs.query returns a DIFFERENT set), Full Auto clicked — and the run starts', async () => {
    const harness = createChromeStub({
      pingResponders: { [VERIFIED_TAB_ID]: { ok: true } },
      // "another Chrome window may be active" — the broad URL query does
      // NOT list the verified tab at all here. Before the fix this alone
      // was enough to make resolveConnectedSgsTab give up, because the
      // verified tabId was only ever REORDERED within this list, never
      // pinged directly when the list omitted it.
      queryResult: [{ id: 999, url: 'https://sgs.bopp-obec.info/sgs/SomethingElse.aspx' }],
    })

    const response = await runHandleStart(harness.stub, harness, validStartMessage())

    expect(response.ok).toBe(true)
    expect(response.reason).toBeUndefined()
    const steps = tracedSteps(harness)
    expect(steps).toContain('AR_START_ENTER')
    expect(steps).toContain('RUN_STATE_CREATED')
    expect(steps).toContain('AR_START_SUCCESS')
    expect(traceDetail(harness, 'PING_RESULT')?.pingResult).toBe('OK')
    expect(traceDetail(harness, 'PROCESS_CURRENT_PAGE_SEND_RESULT')?.pingResult).toBe('OK')
  })

  it('STRUCTURAL GUARANTEE: it is impossible to come back with "ไม่พบตัวเชื่อมหน้า SGS..." once the same verified tab answered PING_OK', async () => {
    const harness = createChromeStub({
      pingResponders: { [VERIFIED_TAB_ID]: { ok: true } },
      queryResult: [],
    })

    const response = await runHandleStart(harness.stub, harness, validStartMessage())

    expect(traceDetail(harness, 'PING_RESULT')?.pingResult).toBe('OK')
    expect(response.reason).not.toBe(CONTENT_SCRIPT_UNAVAILABLE_MESSAGE)
    expect(response.ok).toBe(true)
    expect(tracedSteps(harness)).not.toContain('AR_START_ABORTED')
  })

  it('USE THE ALREADY VERIFIED TAB: the verified tabId is PINGed directly and no competing tab lookup runs at all when it answers', async () => {
    const harness = createChromeStub({
      pingResponders: { [VERIFIED_TAB_ID]: { ok: true } },
      queryResult: [{ id: 555 }, { id: 777 }],
    })

    await runHandleStart(harness.stub, harness, validStartMessage())

    expect(harness.tabsQuery).not.toHaveBeenCalled()
    const pings = harness.tabsSendMessage.mock.calls.filter(([, message]) => message.type === 'AR_PING')
    expect(pings.length).toBe(1)
    expect(pings[0][0]).toBe(VERIFIED_TAB_ID)
  })

  it('the KICKOFF goes to that same verified tab, and the run state is persisted against it — never another tab', async () => {
    const harness = createChromeStub({
      pingResponders: { [VERIFIED_TAB_ID]: { ok: true } },
      queryResult: [{ id: 555 }],
    })

    const response = await runHandleStart(harness.stub, harness, validStartMessage())

    const kickoffs = harness.sentMessages.filter((m) => m.message.type === 'AR_KICKOFF')
    expect(kickoffs.length).toBe(1)
    expect(kickoffs[0].tabId).toBe(VERIFIED_TAB_ID)
    expect((response.state as Record<string, unknown>).tabId).toBe(VERIFIED_TAB_ID)
    expect(harness.sessionStore.sgsBridgeActiveAutoRun).toBeTruthy()
  })
})

describe('TRACE THE EXACT AR_START FAILURE — every checkpoint, in order', () => {
  it('records the full required checkpoint sequence on a successful start', async () => {
    const harness = createChromeStub({ pingResponders: { [VERIFIED_TAB_ID]: { ok: true } } })

    await runHandleStart(harness.stub, harness, validStartMessage())

    expect(tracedSteps(harness)).toEqual([
      'AR_START_ENTER',
      'AR_START_INPUT_RECEIVED',
      'PAGINATION_VALID',
      'RESOLVER_BEGIN',
      'RESOLVER_RESULT',
      'PING_BEGIN',
      'PING_RESULT',
      'RUN_STATE_CREATED',
      // STARTUP-ORDER FIX — the run state is persisted AND read back
      // (verified to be this exact run, still running) before KICKOFF is
      // ever dispatched, so a content script can never wake to find no
      // run and silently stop at 0/32.
      'RUN_STATE_PERSISTED',
      'RUN_STATE_READBACK_OK',
      'KICKOFF_BEGIN',
      'PROCESS_CURRENT_PAGE_SEND_BEGIN',
      'PROCESS_CURRENT_PAGE_SEND_RESULT',
      'AR_START_SUCCESS',
    ])
  })

  it('AR_START_ENTER carries the suppliedTabId, and every trace entry is PERSISTED (readable back via AR_GET_STARTUP_TRACE after an abort)', async () => {
    const harness = createChromeStub({ pingResponders: { [VERIFIED_TAB_ID]: { ok: true } } })

    await runHandleStart(harness.stub, harness, validStartMessage())

    expect(traceDetail(harness, 'AR_START_ENTER')?.suppliedTabId).toBe(VERIFIED_TAB_ID)
    const persisted = harness.sessionStore.sgsBridgeLastStartupTrace as Record<string, unknown>
    expect(persisted).toBeTruthy()
    expect(persisted.step).toBe('AR_START_SUCCESS')
    expect(typeof persisted.timestamp).toBe('number')

    const listener = harness.messageListeners[0]
    const traceResponse = await new Promise<Record<string, unknown>>((resolve) => {
      listener({ type: 'AR_GET_STARTUP_TRACE' }, { tab: undefined }, (response) => resolve(response as Record<string, unknown>))
    })
    expect((traceResponse.trace as Record<string, unknown>).step).toBe('AR_START_SUCCESS')
  })
})

describe('REMOVE GENERIC ERROR COLLAPSING — distinct failures no longer read identically', () => {
  it('CONTENT_RECEIVER_MISSING: a tab with no listener reports Chrome\'s own real error, not just the collapsed Thai sentence', async () => {
    const harness = createChromeStub({
      pingResponders: { [VERIFIED_TAB_ID]: { throws: 'Could not establish connection. Receiving end does not exist.' } },
      queryResult: [],
    })

    const response = await runHandleStart(harness.stub, harness, validStartMessage())

    expect(response.ok).toBe(false)
    expect(response.errorCode).toBe('CONTENT_RECEIVER_MISSING')
    expect(response.reason).toBe(CONTENT_SCRIPT_UNAVAILABLE_MESSAGE)
    const abort = traceDetail(harness, 'AR_START_ABORTED')
    expect(String(abort?.abortReason)).toContain('CONTENT_RECEIVER_MISSING')
    expect(String(abort?.error)).toContain('Receiving end does not exist')
  })

  it('MESSAGE_PORT_CLOSED is reported distinctly from CONTENT_RECEIVER_MISSING, even though the teacher-facing sentence is the same', async () => {
    const harness = createChromeStub({
      pingResponders: { [VERIFIED_TAB_ID]: { throws: 'The message port closed before a response was received.' } },
      queryResult: [],
    })

    const response = await runHandleStart(harness.stub, harness, validStartMessage())

    expect(response.errorCode).toBe('MESSAGE_PORT_CLOSED')
    expect(String(traceDetail(harness, 'AR_START_ABORTED')?.error)).toContain('message port closed')
  })

  it('SGS_TAB_NOT_FOUND: no preferred tab and no matching tab anywhere is its OWN code, never conflated with a ping failure', async () => {
    const harness = createChromeStub({ queryResult: [] })

    const response = await runHandleStart(harness.stub, harness, validStartMessage({ tabId: null }))

    expect(response.ok).toBe(false)
    expect(response.errorCode).toBe('SGS_TAB_NOT_FOUND')
  })

  it('PAGINATION_INVALID keeps its own distinct message AND code — never the content-script sentence', async () => {
    const harness = createChromeStub({ pingResponders: { [VERIFIED_TAB_ID]: { ok: true } } })

    const response = await runHandleStart(harness.stub, harness, validStartMessage({ pagination: { currentPage: null, totalPages: null } }))

    expect(response.ok).toBe(false)
    expect(response.errorCode).toBe('PAGINATION_INVALID')
    expect(response.reason).not.toBe(CONTENT_SCRIPT_UNAVAILABLE_MESSAGE)
    // The abort happened BEFORE any tab work — so no resolver/ping
    // checkpoints were ever reached, which is itself diagnostic.
    expect(tracedSteps(harness)).toEqual(['AR_START_ENTER', 'AR_START_INPUT_RECEIVED', 'PAGINATION_VALID'])
  })

  it('KICKOFF_SEND_FAILED is traced but never aborts an already-created run — the run still starts, and content-script.js can pick it up later', async () => {
    const harness = createChromeStub({
      pingResponders: { [VERIFIED_TAB_ID]: { ok: true } },
      kickoffThrows: 'Could not establish connection. Receiving end does not exist.',
    })

    const response = await runHandleStart(harness.stub, harness, validStartMessage())

    expect(response.ok).toBe(true)
    const sendResult = traceDetail(harness, 'PROCESS_CURRENT_PAGE_SEND_RESULT')
    expect(sendResult?.pingResult).toBe('FAILED')
    expect(String(sendResult?.abortReason)).toContain('KICKOFF_SEND_FAILED')
    expect(tracedSteps(harness)).toContain('AR_START_SUCCESS')
  })
})

describe('ROOT CAUSE — AR_GET_STATE from a CONTENT SCRIPT must resolve by the sender\'s own tab', () => {
  it('REGRESSION (the live 0/32 bug): a content-script GET_STATE carries NO tabId, and must still get the run state back — it used to come back null, which is what silently skipped processCurrentPage', async () => {
    const harness = createChromeStub({ pingResponders: { [VERIFIED_TAB_ID]: { ok: true } } })
    await runHandleStart(harness.stub, harness, validStartMessage())

    const listener = harness.messageListeners[0]
    // Exactly what content-script.js sends: no tabId anywhere in the
    // message, and the sender's own tab supplied by Chrome.
    const response = await new Promise<Record<string, unknown>>((resolve) => {
      listener({ type: 'AR_GET_STATE' }, { tab: { id: VERIFIED_TAB_ID } }, (r) => resolve(r as Record<string, unknown>))
    })

    expect(response.state, 'a content script must be able to read its own tab\'s run state').not.toBeNull()
    expect((response.state as Record<string, unknown>).tabId).toBe(VERIFIED_TAB_ID)
  })

  it('still refuses to hand a content script ANOTHER tab\'s run — the sender tab is the authority, not a wildcard', async () => {
    const harness = createChromeStub({ pingResponders: { [VERIFIED_TAB_ID]: { ok: true } } })
    await runHandleStart(harness.stub, harness, validStartMessage())

    const listener = harness.messageListeners[0]
    const response = await new Promise<Record<string, unknown>>((resolve) => {
      listener({ type: 'AR_GET_STATE' }, { tab: { id: 999999 } }, (r) => resolve(r as Record<string, unknown>))
    })

    expect(response.state).toBeNull()
  })

  it('the POPUP path is unchanged — no sender.tab, so message.tabId still decides', async () => {
    const harness = createChromeStub({ pingResponders: { [VERIFIED_TAB_ID]: { ok: true } } })
    await runHandleStart(harness.stub, harness, validStartMessage())

    const listener = harness.messageListeners[0]
    const matching = await new Promise<Record<string, unknown>>((resolve) => {
      listener({ type: 'AR_GET_STATE', tabId: VERIFIED_TAB_ID }, { tab: undefined }, (r) => resolve(r as Record<string, unknown>))
    })
    const mismatched = await new Promise<Record<string, unknown>>((resolve) => {
      listener({ type: 'AR_GET_STATE', tabId: 424242 }, { tab: undefined }, (r) => resolve(r as Record<string, unknown>))
    })

    expect(matching.state).not.toBeNull()
    expect(mismatched.state).toBeNull()
  })
})

describe('content-script PROCESS_CURRENT_PAGE checkpoints reach Section 7', () => {
  it('AR_PROCESS_TRACE is persisted into the same startup-trace slot the popup renders, with errorMessage surfaced as the panel\'s "ข้อผิดพลาดจริง"', async () => {
    const harness = createChromeStub({ pingResponders: { [VERIFIED_TAB_ID]: { ok: true } } })
    await runHandleStart(harness.stub, harness, validStartMessage())
    const listener = harness.messageListeners[0]

    await new Promise((resolve) => {
      listener(
        {
          type: 'AR_PROCESS_TRACE',
          step: 'PROCESS_CURRENT_PAGE_FAILED',
          detail: { step: 'LIVE_SCAN_BEGIN', errorName: 'TypeError', errorMessage: 'x is not a function', stack: 'TypeError: x is not a function\n  at ...' },
        },
        { tab: { id: VERIFIED_TAB_ID } },
        resolve,
      )
    })

    const persisted = harness.sessionStore.sgsBridgeLastStartupTrace as Record<string, unknown>
    expect(persisted.step).toBe('PROCESS_CURRENT_PAGE_FAILED')
    const detail = persisted.detail as Record<string, unknown>
    expect(detail.step).toBe('LIVE_SCAN_BEGIN')
    expect(detail.errorName).toBe('TypeError')
    expect(detail.error).toBe('x is not a function')
    expect(detail.stack).toContain('TypeError')
    expect(detail.resolvedTabId).toBe(VERIFIED_TAB_ID)
  })

  it('STARTUP-ORDER FIX (sequence A): handleContentReady with no run yet records CONTENT_READY_IDLE — still never silent, but informational (a `note`, never an `abortReason`), dispatching no KICKOFF and reporting no failure', async () => {
    const harness = createChromeStub({ pingResponders: { [VERIFIED_TAB_ID]: { ok: true } } })
    vi.stubGlobal('chrome', harness.stub)
    vi.resetModules()
    await import('../src/background.js')
    const listener = harness.messageListeners[0]

    // No run has been created, so classifyContentReady is IDLE.
    const response = await new Promise((resolve) => {
      listener({ type: 'AR_SGS_CONTENT_READY', pageUrl: VERIFIED_PAGE_URL }, { tab: { id: VERIFIED_TAB_ID } }, resolve)
    })

    expect(tracedSteps(harness)).toContain('CONTENT_SCRIPT_RECEIVED')
    expect(tracedSteps(harness)).toContain('CONTENT_READY_IDLE')
    expect(tracedSteps(harness)).not.toContain('CONTENT_READY_NO_ACTIVE_RUN')

    // An idle content script is NOT a failure: no abortReason, no
    // kickoff, and an ok response.
    const detail = traceDetail(harness, 'CONTENT_READY_IDLE')
    expect(detail?.abortReason).toBeUndefined()
    expect(String(detail?.note)).toContain('ยังไม่มีการสั่งเริ่มรัน')
    expect(response).toEqual({ ok: true, idle: true })
    expect(tracedSteps(harness)).not.toContain('KICKOFF_BEGIN')
  })

  it('STARTUP-ORDER FIX (sequence A, the live race): an idle CONTENT_READY first does NOT stop the AR_START that follows it from starting page 1', async () => {
    const harness = createChromeStub({ pingResponders: { [VERIFIED_TAB_ID]: { ok: true } } })
    vi.stubGlobal('chrome', harness.stub)
    vi.resetModules()
    await import('../src/background.js')
    const listener = harness.messageListeners[0]

    // 1. CONTENT_READY arrives FIRST, with no run — idle, no error.
    await new Promise((resolve) => {
      listener({ type: 'AR_SGS_CONTENT_READY', pageUrl: VERIFIED_PAGE_URL }, { tab: { id: VERIFIED_TAB_ID } }, resolve)
    })
    expect(tracedSteps(harness)).toContain('CONTENT_READY_IDLE')

    // 2. The teacher then clicks Full Auto — which must still succeed
    //    all the way through to a dispatched page-1 kickoff.
    const response = await runHandleStart(harness.stub, harness, validStartMessage())

    expect(response.ok).toBe(true)
    const steps = tracedSteps(harness)
    expect(steps).toContain('RUN_STATE_PERSISTED')
    expect(steps).toContain('RUN_STATE_READBACK_OK')
    expect(steps).toContain('KICKOFF_BEGIN')
    expect(traceDetail(harness, 'PROCESS_CURRENT_PAGE_SEND_RESULT')?.pingResult).toBe('OK')
    expect(steps).toContain('AR_START_SUCCESS')
  })

  it('STARTUP-ORDER FIX (sequence B): once a run IS active for the tab, a later CONTENT_READY (an SGS reload/postback) resumes it by dispatching KICKOFF', async () => {
    const harness = createChromeStub({ pingResponders: { [VERIFIED_TAB_ID]: { ok: true } } })
    vi.stubGlobal('chrome', harness.stub)
    vi.resetModules()
    await import('../src/background.js')
    const listener = harness.messageListeners[0]

    await runHandleStart(harness.stub, harness, validStartMessage())
    harness.broadcasts.length = 0

    const response = await new Promise((resolve) => {
      listener({ type: 'AR_SGS_CONTENT_READY', pageUrl: VERIFIED_PAGE_URL }, { tab: { id: VERIFIED_TAB_ID } }, resolve)
    })

    const steps = tracedSteps(harness)
    expect(steps).toContain('CONTENT_SCRIPT_RECEIVED')
    expect(steps).toContain('KICKOFF_BEGIN')
    expect(steps).not.toContain('CONTENT_READY_IDLE')
    expect(response).toEqual({ ok: true, idle: false })
  })

  it('STARTUP-ORDER FIX (sequence C): when the persisted run cannot be read back, NO kickoff is dispatched and the refusal names the exact readback detail', async () => {
    const harness = createChromeStub({ pingResponders: { [VERIFIED_TAB_ID]: { ok: true } } })
    vi.stubGlobal('chrome', harness.stub)
    vi.resetModules()
    await import('../src/background.js')

    // Model a storage layer that accepts the write but hands back
    // nothing for the run key — the readback gate must catch it.
    const realGet = harness.stub.storage.session.get
    harness.stub.storage.session.get = vi.fn(async (key) => {
      if (key === 'sgsBridgeActiveAutoRun') return {}
      return realGet(key)
    })

    const response = await runHandleStart(harness.stub, harness, validStartMessage())

    expect(response.ok).toBe(false)
    expect(response.errorCode).toBe('RUN_STATE_PERSIST_FAILED')
    expect(String(response.reason)).toContain('บันทึกสถานะการรันไม่สำเร็จ')
    expect(String(response.reason)).toContain('readback runId=null')
    const steps = tracedSteps(harness)
    expect(steps).toContain('RUN_STATE_PERSISTED')
    expect(steps).not.toContain('RUN_STATE_READBACK_OK')
    expect(steps).not.toContain('KICKOFF_BEGIN')
    expect(steps).not.toContain('AR_START_SUCCESS')
  })
})

describe('the healing fallback still runs — but only when the direct PING genuinely failed', () => {
  it('falls back to inject/reload healing when the verified tab does not answer, and succeeds if the tab answers after injection', async () => {
    const harness = createChromeStub({ queryResult: [] })
    // First PING (direct) fails; after the "injection" the SAME tab
    // starts answering — modelled by swapping the responder mid-flight.
    let injected = false
    harness.stub.scripting.executeScript = vi.fn(async () => {
      injected = true
      return [{ result: null }]
    })
    harness.stub.tabs.sendMessage = vi.fn(async (tabId: number, message: Record<string, unknown>) => {
      if (message.type === 'AR_PING') {
        if (injected && tabId === VERIFIED_TAB_ID) return { ok: true, ready: true, pageUrl: VERIFIED_PAGE_URL }
        throw new Error('Could not establish connection. Receiving end does not exist.')
      }
      harness.sentMessages.push({ tabId, message })
      return { ok: true }
    })

    const response = await runHandleStart(harness.stub, harness, validStartMessage())

    expect(harness.stub.scripting.executeScript).toHaveBeenCalled()
    expect(response.ok).toBe(true)
    expect(tracedSteps(harness)).toContain('PING_RETRY_OK')
  })
})
