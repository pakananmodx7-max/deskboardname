import { useState } from 'react'

import { SlicedWaves } from './sliced-waves'

/** Phones/tablets: 30 fps, a smaller backing store and tighter bars. */
function isConstrainedDevice(): boolean {
  if (typeof window === 'undefined') return true
  return window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 768
}

/**
 * Decorative SlicedWaves band along the bottom of the login pages.
 * Purely visual: aria-hidden, pointer-events none, behind the form
 * (AuthShell reserves space below the content so the form and links never
 * sit on top of the waves). Falls back to a static CSS version when WebGL2
 * is missing or the context is lost; prefers-reduced-motion renders a
 * still frame (handled inside SlicedWaves).
 */
export function LoginWaves() {
  const [fallback, setFallback] = useState(false)
  const [constrained] = useState(isConstrainedDevice)
  const dpr = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 1.5)

  return (
    <div aria-hidden="true" data-testid="login-waves" className="kc-login-waves pointer-events-none absolute inset-x-0 bottom-0 -z-10 select-none">
      {fallback ? (
        <div className="kc-login-waves-fallback h-full w-full" />
      ) : (
        <SlicedWaves
          color1="#457d74"
          color2="#06b6d4"
          color3="#5b8cff"
          ribbons={3}
          spacing={constrained ? 20 : 24}
          barWidth={0.38}
          perspective={0.45}
          blur={0.6}
          glow={1}
          position={0.6}
          mouseInteraction={false}
          speed={0.35}
          lightMode
          opacity={0.85}
          brightness={1.1}
          grain={0.04}
          dpr={dpr}
          maxFps={constrained ? 30 : 60}
          maxRenderDim={constrained ? 1024 : 1800}
          onUnsupported={() => setFallback(true)}
        />
      )}
    </div>
  )
}
