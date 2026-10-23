/**
 * When the installed app looks for a new deploy. Browsers only check the
 * service worker on navigation (and at most every 24 h), and an installed
 * PWA on a phone may stay open for days, so we also check:
 *   - every hour while the app is open, and
 *   - when the app comes back to the foreground (at most every 5 minutes).
 * Never while offline. Checking only downloads the new service worker —
 * applying it is always the user's choice (pwa-update-prompt.tsx).
 */

export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000
export const FOREGROUND_CHECK_MIN_GAP_MS = 5 * 60 * 1000

export interface UpdateCheckEnv {
  isOnline: () => boolean
  isVisible: () => boolean
  now: () => number
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (id: unknown) => void
  onVisibilityChange: (fn: () => void) => () => void
}

export function startUpdateChecks(registration: Pick<ServiceWorkerRegistration, 'update'>, env: UpdateCheckEnv): () => void {
  let lastCheck = env.now()
  const check = () => {
    if (!env.isOnline()) return
    lastCheck = env.now()
    registration.update().catch(() => {
      // Offline or the server is briefly unreachable: try again next time.
    })
  }
  const timer = env.setInterval(check, UPDATE_CHECK_INTERVAL_MS)
  const stopVisibility = env.onVisibilityChange(() => {
    if (env.isVisible() && env.now() - lastCheck >= FOREGROUND_CHECK_MIN_GAP_MS) check()
  })
  return () => {
    env.clearInterval(timer)
    stopVisibility()
  }
}

export const browserUpdateCheckEnv: UpdateCheckEnv = {
  isOnline: () => navigator.onLine,
  isVisible: () => document.visibilityState === 'visible',
  now: () => Date.now(),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (id) => window.clearInterval(id as number),
  onVisibilityChange: (fn) => {
    document.addEventListener('visibilitychange', fn)
    return () => document.removeEventListener('visibilitychange', fn)
  },
}
