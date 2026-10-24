/** No progress after this long → "taking longer than usual" with a way out. */
export const STARTUP_SLOW_AFTER_MS = 12_000

/**
 * Startup is done once the session check has finished, a signed-in user's
 * profile is known (the route guards wait for it — no protected page is
 * shown before that), and no route is still deciding what to show.
 */
export function isStartupReady(auth: { status: 'loading' | 'ready'; user: unknown; profile: unknown }, holds: number): boolean {
  return auth.status === 'ready' && (!auth.user || auth.profile !== null) && holds === 0
}
