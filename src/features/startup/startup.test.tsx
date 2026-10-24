import { readFileSync } from 'node:fs'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { isStartupReady, STARTUP_SLOW_AFTER_MS } from './startup-readiness'
import { StartupSplash } from './startup-splash'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf-8')

describe('isStartupReady — the splash leaves only when the first real page is ready', () => {
  const user = { id: 'u' }
  const profile = { role: 'teacher' }

  it('waits for the session check', () => {
    expect(isStartupReady({ status: 'loading', user: null, profile: null }, 0)).toBe(false)
  })

  it('signed out: ready as soon as the session check is done', () => {
    expect(isStartupReady({ status: 'ready', user: null, profile: null }, 0)).toBe(true)
  })

  it('signed in: waits for the profile (the role decides what may be shown)', () => {
    expect(isStartupReady({ status: 'ready', user, profile: null }, 0)).toBe(false)
    expect(isStartupReady({ status: 'ready', user, profile }, 0)).toBe(true)
  })

  it('waits while any route is still deciding (startup holds)', () => {
    expect(isStartupReady({ status: 'ready', user, profile }, 1)).toBe(false)
  })

  it('never waits for a fixed time; offers a way out after 12 s', () => {
    expect(STARTUP_SLOW_AFTER_MS).toBe(12_000)
    expect(read('./startup-gate.tsx')).not.toMatch(/MIN_|minimum/i)
  })
})

describe('StartupSplash markup', () => {
  const noop = vi.fn()
  const loading = renderToStaticMarkup(<StartupSplash leaving={false} problem={null} onRetry={noop} onContinue={noop} />)

  it('CLASS N, an indeterminate progress bar and the exact credit — nothing else', () => {
    expect(loading).toContain('<p class="kc-splash-title"><span>CLASS</span> <span class="kc-splash-n">N</span></p>')
    expect(loading).toMatch(/role="progressbar" aria-label="กำลังเริ่มระบบ Class N" aria-valuetext="กำลังโหลด"/)
    expect(loading).not.toContain('aria-valuenow')
    expect(loading).not.toMatch(/\d+%/)
    expect(loading).toContain('<span class="block">Developed by</span>')
    expect(loading).toContain('Pakanan Modbut</span><span class="block">© 2026 Class N</span>')
    expect(loading).not.toMatch(/<img|<svg|KrunameClass/)
  })

  it('the background is decorative and on top of the static backdrop', () => {
    expect(loading).toMatch(/^<div data-testid="startup-splash" aria-busy="true" class="kc-splash kc-splash-backdrop">/)
    expect(loading).toContain('<div class="kc-splash-canvas" aria-hidden="true">')
    expect(loading).toContain('<canvas class="absolute inset-0 block h-full w-full" aria-hidden="true">')
  })

  it('a startup problem replaces the bar with an alert, "ลองใหม่" and "เข้าใช้งานต่อ"', () => {
    for (const problem of ['error', 'slow'] as const) {
      const html = renderToStaticMarkup(<StartupSplash leaving={false} problem={problem} onRetry={noop} onContinue={noop} />)
      expect(html).toContain('role="alert"')
      expect(html).not.toContain('role="progressbar"')
      expect(html).toContain('>ลองใหม่</button>')
      expect(html).toContain('>เข้าใช้งานต่อ</button>')
    }
    expect(renderToStaticMarkup(<StartupSplash leaving={false} problem="error" onRetry={noop} onContinue={noop} />)).toContain('เริ่มระบบไม่สำเร็จ')
  })

  it('fading out: marked leaving (no pointer events, opacity 0 in CSS)', () => {
    expect(renderToStaticMarkup(<StartupSplash leaving problem={null} onRetry={noop} onContinue={noop} />)).toContain('data-leaving="true"')
  })

  it('uses the requested Iridescence settings; reduced motion turns interaction off; lower resolution on phones', () => {
    const src = read('./startup-splash.tsx')
    for (const prop of ['color="#8099cc"', 'hueShift={0}', 'saturation={1}', 'brightness={1.5}', 'contrast={1}', 'speed={0.45}', 'scale={1}', 'detail={8}', 'warp={1}', 'rotation={0}', 'amplitude={0.1}', 'stir={0.5}', 'sheen={0.3}', 'grain={0}', 'fade={0}'])
      expect(src).toContain(prop)
    expect(src).toContain('mouseReact={!reduce}')
    expect(src).toContain('clickSwirl={!reduce}')
    expect(src).toContain('resolution={constrained ? 0.6 : 0.75}')
    expect(src).toContain('onUnsupported={() => setFallback(true)}')
  })
})

describe('Iridescence port', () => {
  const src = read('./iridescence.tsx')

  it('keeps the original reduced-motion and off-screen handling and adds hidden-page pause, context-loss fallback and touch drag', () => {
    expect(src).toContain("window.matchMedia?.('(prefers-reduced-motion: reduce)')")
    expect(src).toContain('new IntersectionObserver(')
    expect(src).toContain('if (!alive || !visible || document.hidden) return')
    expect(src).toContain("canvas.addEventListener('webglcontextlost', onContextLost)")
    expect(src).toContain("if (event.pointerType !== 'mouse' && inside) {")
    expect(src).toContain("window.addEventListener('pointercancel', onPointerEnd, { passive: true })")
    expect(src).toContain("powerPreference: 'low-power'")
  })

  it('removes every listener and GL resource on unmount', () => {
    for (const type of ['pointermove', 'pointerdown', 'pointerup', 'pointercancel']) expect(src).toContain(`window.removeEventListener('${type}'`)
    for (const call of ['resizeObserver.disconnect()', 'visibility.disconnect()', "document.removeEventListener('visibilitychange'", 'gl.deleteTexture(fieldTexture)', 'gl.deleteProgram(program)'])
      expect(src).toContain(call)
  })
})

describe('startup wiring', () => {
  it('the splash wraps the router inside AuthProvider (shown once per load, not per navigation)', () => {
    expect(read('../../app/router.tsx')).toMatch(/<AuthProvider>\s*<StartupGate>\s*<RouterProvider router=\{router\} \/>\s*<\/StartupGate>\s*<\/AuthProvider>/)
    expect(read('./startup-gate.tsx')).toContain('<div className="contents" inert={phase === \'starting\'}>')
  })

  it('route guards hold the splash instead of showing their own loading text at startup', () => {
    for (const p of ['../../components/auth/protected-route.tsx', '../../components/auth/student-protected-route.tsx', '../../pages/root/root-page.tsx']) {
      const src = read(p)
      expect(src).toContain('<StartupPending />')
      expect(src).not.toContain('กำลังโหลด...')
    }
  })

  it('the auth context reports a failed startup instead of loading forever', () => {
    const src = read('../../lib/auth-context.tsx')
    expect(src).toContain("if (active) setState((prev) => ({ ...prev, startupError: 'session' }))")
    expect(src).toContain("setState((prev) => (prev.user?.id === userId ? { ...prev, startupError: 'profile' } : prev))")
  })

  it('index.html paints the pastel backdrop before the script loads; icons and manifest untouched', () => {
    const html = read('../../../index.html')
    expect(html).toContain('<div id="root"><div class="kc-splash-backdrop kc-splash-boot"></div></div>')
    expect(html).toContain('.kc-splash-backdrop {')
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />')
  })

  it('CSS: full dynamic-viewport cover, safe areas, touch-action, reduced motion', () => {
    const css = read('../../index.css')
    expect(css).toContain('height: 100dvh;')
    expect(css).toContain('padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);')
    expect(css).toContain('bottom: calc(env(safe-area-inset-bottom) + 1.25rem);')
    expect(css).toContain('touch-action: none;')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.kc-splash \{/)
  })
})
