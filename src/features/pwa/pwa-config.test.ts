import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf-8')

/** Source guards for the PWA set-up (the built sw.js/manifest are checked
 * separately after `npm run build`, see docs/PWA.md). */
describe('PWA configuration', () => {
  const config = read('../../../vite.config.ts')

  it('installable manifest: name, standalone, scope, icons incl. maskable', () => {
    expect(config).toContain("name: 'KrunameClass'")
    expect(config).toContain("short_name: 'KrunameClass'")
    expect(config).toContain("display: 'standalone'")
    expect(config).toContain("start_url: '/'")
    expect(config).toContain("scope: '/'")
    expect(config).toContain("theme_color: '#237fc8'")
    for (const icon of ['/pwa-192x192.png', '/pwa-512x512.png', '/pwa-maskable-512x512.png']) expect(config).toContain(icon)
    expect(config).toContain("purpose: 'maskable'")
  })

  it('updates wait for the user; no silent skipWaiting', () => {
    expect(config).toContain("registerType: 'prompt'")
    expect(config).toContain('skipWaiting: false')
    expect(config).toContain('clientsClaim: false')
    expect(config).toContain('cleanupOutdatedCaches: true')
  })

  it('no runtime caching of Supabase, Google APIs/Drive or any API — Google Fonts only', () => {
    expect(config).not.toMatch(/supabase\.co|googleapis\.com\/(drive|upload)|\/rest\/v1|\/auth\/v1|\/storage\/v1|\/functions\/v1/)
    const origins = [...config.matchAll(/url\.origin === '([^']+)'/g)].map((m) => m[1])
    expect(origins).toEqual(['https://fonts.googleapis.com', 'https://fonts.gstatic.com'])
    expect(config).toContain('devOptions: { enabled: false }')
  })

  it('iOS home-screen metadata and safe-area viewport', () => {
    const html = read('../../../index.html')
    expect(html).toContain('viewport-fit=cover')
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />')
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="KrunameClass" />')
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="default" />')
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />')
    expect(html).toContain('<meta name="theme-color" content="#237fc8" />')
  })

  it('Vercel never caches the service worker script', () => {
    const vercel = JSON.parse(read('../../../vercel.json'))
    const sw = vercel.headers.find((h: { source: string }) => h.source === '/sw.js')
    expect(sw.headers[0].value).toContain('no-cache')
    expect(vercel.rewrites).toEqual([{ source: '/(.*)', destination: '/index.html' }])
  })

  it('the update prompt waits for in-flight saves and never reloads on its own', () => {
    const prompt = read('./pwa-update-prompt.tsx')
    expect(prompt).toContain('await waitForNoPendingWrites()')
    expect(prompt).toContain('updateServiceWorker(true)')
    expect(prompt.match(/updateServiceWorker\(/g)).toHaveLength(1)
    expect(prompt).toContain('อัปเดตตอนนี้')
    // Unsaved edits (iOS shows no beforeunload prompt): never reload over them.
    expect(prompt.indexOf('if (hasUnsavedWork())')).toBeLessThan(prompt.indexOf('updateServiceWorker(true)'))
    expect(read('../attendance/unsaved-changes-guard.tsx')).toContain('markUnsavedWork()')
    const supabase = read('../../lib/supabase.ts')
    expect(supabase).toContain('global: { fetch: trackPendingWrites(')
  })
})
