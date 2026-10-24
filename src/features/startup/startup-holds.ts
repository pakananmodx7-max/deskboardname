import { useEffect, useSyncExternalStore } from 'react'

/**
 * "This route is still working out what to show" — counted while the app
 * starts so the splash stays up until the first real page is ready (e.g.
 * a route guard waiting for the profile, "/" deciding where a student
 * lands). After startup the count is simply ignored.
 */

let holds = 0
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function startupHoldCount(): number {
  return holds
}

/** Holds startup for as long as the calling component is mounted. */
export function useStartupHold() {
  useEffect(() => {
    holds += 1
    emit()
    return () => {
      holds -= 1
      emit()
    }
  }, [])
}

export function useStartupHoldCount(): number {
  return useSyncExternalStore(subscribe, startupHoldCount, startupHoldCount)
}
