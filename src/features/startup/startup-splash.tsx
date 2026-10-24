import { memo, useState } from 'react'

import { DeveloperCredit } from '@/components/layout/developer-credit'

import { Iridescence } from './iridescence'

export type StartupProblem = 'error' | 'slow' | null

interface StartupSplashProps {
  /** Fading out: the app underneath is already usable. */
  leaving: boolean
  problem: StartupProblem
  onRetry: () => void
  onContinue: () => void
}

function readDevice() {
  if (typeof window === 'undefined') return { reduce: false, constrained: true }
  return {
    reduce: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    constrained: (window.matchMedia?.('(pointer: coarse)').matches ?? false) || window.innerWidth < 768,
  }
}

const PROBLEM_TEXT = {
  error: { title: 'เริ่มระบบไม่สำเร็จ', detail: 'ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต แล้วลองใหม่อีกครั้ง' },
  slow: { title: 'ใช้เวลานานกว่าปกติ', detail: 'การเชื่อมต่ออาจช้า ลองใหม่อีกครั้ง หรือเข้าใช้งานต่อได้เลย' },
}

/**
 * Full-screen "CLASS N" splash over the starting app: React Bits
 * Iridescence behind a still title, an indeterminate loading bar (startup
 * has no measurable progress, so no percentage is ever shown) and the
 * developer credit. The static .kc-splash-backdrop (index.html) is what
 * shows before the script loads and whenever WebGL2 is unavailable.
 * Reduced motion: still background, no swirls, a gentle bar pulse.
 */
export const StartupSplash = memo(function StartupSplash({ leaving, problem, onRetry, onContinue }: StartupSplashProps) {
  const [fallback, setFallback] = useState(false)
  const [{ reduce, constrained }] = useState(readDevice)

  return (
    <div data-testid="startup-splash" data-leaving={leaving ? 'true' : undefined} aria-busy={problem ? undefined : true} className="kc-splash kc-splash-backdrop">
      {!fallback && (
        <div className="kc-splash-canvas" aria-hidden="true">
          <Iridescence
            color="#8099cc"
            hueShift={0}
            saturation={1}
            brightness={1.5}
            contrast={1}
            speed={0.45}
            scale={1}
            detail={8}
            warp={1}
            rotation={0}
            mouseReact={!reduce}
            amplitude={0.1}
            stir={0.5}
            sheen={0.3}
            clickSwirl={!reduce}
            grain={0}
            fade={0}
            resolution={constrained ? 0.6 : 0.75}
            onUnsupported={() => setFallback(true)}
          />
        </div>
      )}

      <div className="kc-splash-center">
        <p className="kc-splash-title">
          <span>CLASS</span> <span className="kc-splash-n">N</span>
        </p>
        {problem ? (
          <div role="alert" className="flex max-w-[20rem] flex-col items-center gap-3 text-center text-[#14245c]">
            <div>
              <p className="text-base font-semibold">{PROBLEM_TEXT[problem].title}</p>
              <p className="mt-1 text-sm text-[#2b3d78]">{PROBLEM_TEXT[problem].detail}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onRetry} className="rounded-full bg-[#1d4ed8] px-5 py-2 text-sm font-semibold text-white shadow-md transition-colors hover:bg-[#1e40af] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d4ed8]">
                ลองใหม่
              </button>
              <button type="button" onClick={onContinue} className="rounded-full border border-white/70 bg-white/55 px-5 py-2 text-sm font-semibold text-[#14245c] backdrop-blur-sm transition-colors hover:bg-white/75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d4ed8]">
                เข้าใช้งานต่อ
              </button>
            </div>
          </div>
        ) : (
          <div role="progressbar" aria-label="กำลังเริ่มระบบ Class N" aria-valuetext="กำลังโหลด" className="kc-splash-bar">
            <span className="kc-splash-bar-fill" />
          </div>
        )}
      </div>

      <DeveloperCredit tone="navy" className="kc-splash-credit" />
    </div>
  )
})
