import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Installable app (Android Chrome / iOS Safari "Add to Home Screen").
    // Caching is deliberately conservative — see docs/PWA.md:
    //   - precache: the versioned build only (hashed JS/CSS, fonts, icons,
    //     the static index.html shell). Each deploy is one consistent set,
    //     so an open tab never mixes old and new chunks.
    //   - runtime: Google Fonts only.
    //   - never: Supabase (REST/RPC/Auth/Storage/Edge Functions), Google
    //     APIs/Drive — all cross-origin, so the service worker does not
    //     even see them; they always go to the network.
    // registerType 'prompt': a new version waits until the user taps
    // "อัปเดตตอนนี้" (src/features/pwa/pwa-update-prompt.tsx).
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      // Icons are already precached by globPatterns below.
      includeManifestIcons: false,
      manifest: {
        id: '/',
        name: 'KrunameClass',
        short_name: 'KrunameClass',
        description: 'ระบบจัดการชั้นเรียน — เช็คชื่อ งาน คะแนน และสแกน QR ส่งงาน',
        lang: 'th',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#237fc8',
        background_color: '#f0f4f8',
        categories: ['education', 'productivity'],
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,ttf,woff2}'],
        // The main bundle is ~2.3 MB; precache it like every other chunk.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // SPA routes (incl. /reset-password#… and OAuth return URLs) get
        // the precached shell; real files never do.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/\/[^/?]+\.[^/?]+$/],
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      // No service worker in `npm run dev` — it would cache dev modules.
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
