import { useStartupHold } from './startup-holds'

/**
 * The route guards' "กำลังโหลด..." placeholder. While the app is starting
 * it sits under the splash and keeps it up (see startup-holds.ts); after
 * startup it shows exactly as before.
 */
export function StartupPending() {
  useStartupHold()
  return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">กำลังโหลด...</div>
}
