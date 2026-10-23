import { readFileSync } from 'node:fs'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { AuthShell } from '@/components/auth/auth-shell'
import { DeveloperCredit } from '@/components/layout/developer-credit'

import { LoginBackground, LoginCredit } from './login-decoration'
import { LoginShapes } from './login-shapes'
import { LoginWaves } from './login-waves'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf-8')

describe('LoginWaves', () => {
  const html = renderToStaticMarkup(createElement(LoginWaves))

  it('is decorative only: hidden from assistive tech, never takes clicks, behind the content', () => {
    expect(html).toMatch(/^<div aria-hidden="true" data-testid="login-waves" class="kc-login-waves pointer-events-none absolute inset-x-0 bottom-0 -z-10/)
    expect(html).toContain('<canvas class="absolute inset-0 block h-full w-full" aria-hidden="true">')
  })

  it('uses the requested SlicedWaves settings (no mouse interaction, light mode, slow)', () => {
    const src = read('./login-waves.tsx')
    for (const prop of ['color1="#457d74"', 'color2="#06b6d4"', 'color3="#5b8cff"', 'ribbons={3}', 'perspective={0.45}', 'blur={0.6}', 'glow={1}', 'mouseInteraction={false}', 'speed={0.35}', 'lightMode'])
      expect(src).toContain(prop)
    expect(src).toContain('maxFps={constrained ? 30 : 60}')
    expect(src).toContain('onUnsupported={() => setFallback(true)}')
  })

  it('the port keeps the hidden-page pause, reduced-motion still frame and adds a context-loss fallback', () => {
    const src = read('./sliced-waves.tsx')
    expect(src).toContain("if (!alive || !visible || document.hidden) return")
    expect(src).toContain("matchMedia?.('(prefers-reduced-motion: reduce)')")
    expect(src).toContain("canvas.addEventListener('webglcontextlost', onContextLost)")
    expect(src).toContain('if (listenPointer) {')
  })
})

describe('AuthShell background slot', () => {
  const render = (background?: React.ReactNode) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <AuthShell title="เข้าสู่ระบบ" background={background}>
          <form />
        </AuthShell>
      </MemoryRouter>,
    )

  it('without a background the shell is exactly as before (signup, reset password)', () => {
    expect(render()).toMatch(/^<div class="flex min-h-screen items-center justify-center bg-background p-4"><div class="w-full max-w-sm space-y-6">/)
  })

  it('with a background: decoration first, space reserved below the content, safe areas respected', () => {
    const html = render(createElement(LoginWaves))
    expect(html).toContain('data-testid="login-waves"')
    expect(html).toContain('relative isolate overflow-x-clip pb-[clamp(112px,24vh,272px)]')
    expect(html).toContain('pt-[max(1rem,env(safe-area-inset-top))]')
    expect(html).toContain('supports-[height:1svh]:min-h-[100svh]')
  })

  it('only the teacher and student login pages use it, with one credit each', () => {
    for (const p of ['../../pages/auth/login-page.tsx', '../../pages/student/login-page.tsx']) {
      const page = read(p)
      expect(page).toContain('background={<LoginBackground />}')
      expect(page.match(/<LoginCredit \/>/g)).toHaveLength(1)
    }
    for (const p of ['../../pages/auth/signup-page.tsx', '../../pages/auth/forgot-password-page.tsx', '../../pages/auth/reset-password-page.tsx', '../../pages/student/signup-page.tsx'])
      expect(read(p)).not.toContain('background=')
  })
})

describe('Login decoration and credit', () => {
  it('upper shapes are static CSS, decorative only and clipped to the page', () => {
    const html = renderToStaticMarkup(createElement(LoginShapes))
    expect(html).toBe(
      '<div aria-hidden="true" data-testid="login-shapes" class="pointer-events-none absolute inset-0 -z-10 select-none overflow-hidden"><div class="kc-login-shape-top"></div><div class="kc-login-shape-right"></div></div>',
    )
    const css = read('../../index.css')
    expect(css).toContain('.kc-login-shape-top {')
    expect(css).toContain('.kc-login-shape-right {')
  })

  it('background = shapes then waves; credit is the shared one, bottom-right, clear of the safe areas', () => {
    const bg = renderToStaticMarkup(createElement(LoginBackground))
    expect(bg.indexOf('data-testid="login-shapes"')).toBeLessThan(bg.indexOf('data-testid="login-waves"'))
    const credit = renderToStaticMarkup(createElement(LoginCredit))
    expect(credit).toContain('bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-[max(1.25rem,env(safe-area-inset-right))]')
    expect(credit).toBe(renderToStaticMarkup(<DeveloperCredit className="absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-[max(1.25rem,env(safe-area-inset-right))] z-10 text-right" />))
    expect(credit).toContain('Developed by')
    expect(credit).toContain('Pakanan Modbut')
    expect(credit).toContain('© 2026 Class N')
  })
})
