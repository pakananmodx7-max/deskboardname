import { describe, expect, it } from 'vitest'

import { FOREGROUND_CHECK_MIN_GAP_MS, startUpdateChecks, UPDATE_CHECK_INTERVAL_MS, type UpdateCheckEnv } from './update-checks'

function harness() {
  const state = { now: 0, online: true, visible: true, intervals: [] as { fn: () => void; ms: number }[], visibility: [] as (() => void)[], cleared: 0, updates: 0 }
  const env: UpdateCheckEnv = {
    isOnline: () => state.online,
    isVisible: () => state.visible,
    now: () => state.now,
    setInterval: (fn, ms) => state.intervals.push({ fn, ms }),
    clearInterval: () => (state.cleared += 1),
    onVisibilityChange: (fn) => {
      state.visibility.push(fn)
      return () => (state.visibility = state.visibility.filter((f) => f !== fn))
    },
  }
  const registration = { update: () => ((state.updates += 1), Promise.resolve()) }
  return { state, env, registration: registration as unknown as ServiceWorkerRegistration }
}

describe('PWA update checks', () => {
  it('checks hourly while online, never while offline', () => {
    const { state, env, registration } = harness()
    startUpdateChecks(registration, env)
    expect(state.intervals).toHaveLength(1)
    expect(state.intervals[0].ms).toBe(UPDATE_CHECK_INTERVAL_MS)
    state.intervals[0].fn()
    expect(state.updates).toBe(1)
    state.online = false
    state.intervals[0].fn()
    expect(state.updates).toBe(1)
  })

  it('checks when the app returns to the foreground, at most every 5 minutes', () => {
    const { state, env, registration } = harness()
    startUpdateChecks(registration, env)
    state.now = FOREGROUND_CHECK_MIN_GAP_MS - 1
    state.visibility[0]()
    expect(state.updates).toBe(0)
    state.now = FOREGROUND_CHECK_MIN_GAP_MS
    state.visibility[0]()
    expect(state.updates).toBe(1)
    state.now += 1000
    state.visibility[0]()
    expect(state.updates).toBe(1)
    state.visible = false
    state.now += FOREGROUND_CHECK_MIN_GAP_MS
    state.visibility[0]()
    expect(state.updates).toBe(1)
  })

  it('stops cleanly', () => {
    const { state, env, registration } = harness()
    const stop = startUpdateChecks(registration, env)
    stop()
    expect(state.cleared).toBe(1)
    expect(state.visibility).toHaveLength(0)
  })

  it('a failed check (offline/server down) is swallowed', async () => {
    const { env } = harness()
    const registration = { update: () => Promise.reject(new Error('network')) } as unknown as ServiceWorkerRegistration
    startUpdateChecks(registration, { ...env, setInterval: (fn) => (fn(), 1) })
    await new Promise((r) => setTimeout(r, 0))
  })
})
