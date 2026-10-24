import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { useAuth } from '@/lib/auth-context'

import { useStartupHoldCount } from './startup-holds'
import { isStartupReady, STARTUP_SLOW_AFTER_MS } from './startup-readiness'
import { StartupSplash, type StartupProblem } from './startup-splash'

/** Matches the .kc-splash opacity transition. */
const FADE_OUT_MS = 450

type Phase = 'starting' | 'leaving' | 'done'

/**
 * Shows the splash over the app during genuine startup only: the app
 * renders (inert) underneath from the first frame, so there is no added
 * delay — the splash fades out as soon as the first real page is ready
 * and never comes back for in-app navigation (this component stays
 * mounted for the session). A startup error, or no progress for
 * STARTUP_SLOW_AFTER_MS, shows "ลองใหม่" (reload) and "เข้าใช้งานต่อ".
 */
export function StartupGate({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const holds = useStartupHoldCount()
  const ready = isStartupReady(auth, holds)
  const [phase, setPhase] = useState<Phase>('starting')
  const [slow, setSlow] = useState(false)

  // Leave on the next frame, and only if still ready then — a route that
  // swaps one placeholder for another must not let the splash slip away.
  useEffect(() => {
    if (phase !== 'starting' || !ready) return
    const frame = requestAnimationFrame(() => setPhase('leaving'))
    return () => cancelAnimationFrame(frame)
  }, [phase, ready])

  useEffect(() => {
    if (phase !== 'starting') return
    const timer = setTimeout(() => setSlow(true), STARTUP_SLOW_AFTER_MS)
    return () => clearTimeout(timer)
  }, [phase])

  useEffect(() => {
    if (phase !== 'leaving') return
    const timer = setTimeout(() => setPhase('done'), FADE_OUT_MS)
    return () => clearTimeout(timer)
  }, [phase])

  const retry = useCallback(() => window.location.reload(), [])
  const continueAnyway = useCallback(() => setPhase('leaving'), [])
  const problem: StartupProblem = auth.startupError ? 'error' : slow ? 'slow' : null

  return (
    <>
      {/* display: contents — no layout change; inert only while covered. */}
      <div className="contents" inert={phase === 'starting'}>
        {children}
      </div>
      {phase !== 'done' && <StartupSplash leaving={phase === 'leaving'} problem={problem} onRetry={retry} onContinue={continueAnyway} />}
    </>
  )
}
