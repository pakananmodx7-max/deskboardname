import { describe, expect, it } from 'vitest'

import { isWriteMethod, pendingWriteCount, subscribePendingWrites, trackPendingWrites, waitForNoPendingWrites } from './pending-writes'

function deferred() {
  let resolve!: (r: Response) => void
  const promise = new Promise<Response>((r) => (resolve = r))
  return { promise, resolve }
}

describe('pending writes (PWA update waits for these)', () => {
  it('only non-read methods are writes', () => {
    expect(['GET', 'HEAD', 'OPTIONS', 'get'].map(isWriteMethod)).toEqual([false, false, false, false])
    expect(['POST', 'PATCH', 'PUT', 'DELETE', 'post'].map(isWriteMethod)).toEqual([true, true, true, true, true])
  })

  it('counts writes while they are in flight and passes requests and responses through unchanged', async () => {
    const calls: [RequestInfo | URL, RequestInit | undefined][] = []
    const pending = deferred()
    const fake = ((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init])
      return init?.method === 'POST' ? pending.promise : Promise.resolve(new Response('read'))
    }) as typeof fetch
    const tracked = trackPendingWrites(fake)
    const seen: number[] = []
    const unsubscribe = subscribePendingWrites((n) => seen.push(n))

    const read = await tracked('https://example.test/rest/v1/students')
    expect(await read.text()).toBe('read')
    expect(pendingWriteCount()).toBe(0)

    const body = JSON.stringify({ score: 5 })
    const write = tracked('https://example.test/rest/v1/rpc/record_submission_scan', { method: 'POST', body })
    expect(pendingWriteCount()).toBe(1)
    let settled = false
    const waited = waitForNoPendingWrites().then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)

    pending.resolve(new Response('ok', { status: 201 }))
    expect((await write).status).toBe(201)
    await waited
    expect(settled).toBe(true)
    expect(pendingWriteCount()).toBe(0)
    expect(seen).toEqual([1, 0])
    expect(calls[1]).toEqual(['https://example.test/rest/v1/rpc/record_submission_scan', { method: 'POST', body }])
    unsubscribe()
  })

  it('a failed write is no longer pending', async () => {
    const tracked = trackPendingWrites((() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch)
    await expect(tracked('https://example.test/storage/v1/object/x', { method: 'PUT' })).rejects.toThrow('Failed to fetch')
    expect(pendingWriteCount()).toBe(0)
  })

  it('waits resolve at once when nothing is in flight', async () => {
    await expect(waitForNoPendingWrites()).resolves.toBeUndefined()
  })
})

describe('unsaved work (PWA update never reloads over it)', () => {
  it('is tracked until every holder releases it; double release is harmless', async () => {
    const { hasUnsavedWork, markUnsavedWork } = await import('./unsaved-work')
    expect(hasUnsavedWork()).toBe(false)
    const a = markUnsavedWork()
    const b = markUnsavedWork()
    expect(hasUnsavedWork()).toBe(true)
    a()
    a()
    expect(hasUnsavedWork()).toBe(true)
    b()
    expect(hasUnsavedWork()).toBe(false)
  })
})
