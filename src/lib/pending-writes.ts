/**
 * Counts in-flight write requests (anything but GET/HEAD/OPTIONS) made
 * through the Supabase client — saves, score edits, QR scans, RPCs,
 * Storage uploads, Edge Function calls. The PWA update prompt waits for
 * this to reach zero before reloading into a new version, so an update
 * never cuts off a save or an upload half-way. It only counts: every
 * request and response passes through unchanged.
 */

type Listener = (pending: number) => void

let pending = 0
const listeners = new Set<Listener>()

function notify() {
  for (const listener of listeners) listener(pending)
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase()
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase()
  return 'GET'
}

export function isWriteMethod(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
}

/** Wraps a fetch implementation so write requests are counted. */
export function trackPendingWrites(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    if (!isWriteMethod(requestMethod(input, init))) return fetchImpl(input, init)
    pending += 1
    notify()
    try {
      return await fetchImpl(input, init)
    } finally {
      pending -= 1
      notify()
    }
  }
}

export function pendingWriteCount(): number {
  return pending
}

export function subscribePendingWrites(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Resolves once no write is in flight (immediately if none is). */
export function waitForNoPendingWrites(): Promise<void> {
  if (pending === 0) return Promise.resolve()
  return new Promise((resolve) => {
    const unsubscribe = subscribePendingWrites((count) => {
      if (count === 0) {
        unsubscribe()
        resolve()
      }
    })
  })
}
