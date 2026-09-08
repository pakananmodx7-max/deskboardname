import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { applyTheme, getStoredTheme } from '@/lib/theme'

/**
 * theme.ts is a thin wrapper around window.localStorage/document — no
 * jsdom is installed in this project (vitest runs with environment:
 * 'node'), so a minimal in-memory localStorage + documentElement stub is
 * enough to exercise the real branches instead of always hitting the
 * `typeof window === 'undefined'` early-return.
 */
function createMockWindow() {
  const store = new Map<string, string>()
  return {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
    },
  }
}

function createMockDocument() {
  return { documentElement: { dataset: {} as Record<string, string> } }
}

describe('getStoredTheme', () => {
  let mockWindow: ReturnType<typeof createMockWindow>

  beforeEach(() => {
    mockWindow = createMockWindow()
    vi.stubGlobal('window', mockWindow)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults a first-time visitor (nothing stored) to light — never the system preference', () => {
    expect(getStoredTheme()).toBe('light')
  })

  it('restores a previously-selected dark theme', () => {
    mockWindow.localStorage.setItem('ai-classroom-theme', 'dark')
    expect(getStoredTheme()).toBe('dark')
  })

  it('restores a previously-selected light theme', () => {
    mockWindow.localStorage.setItem('ai-classroom-theme', 'light')
    expect(getStoredTheme()).toBe('light')
  })

  it('falls back to light for a corrupt/unexpected stored value', () => {
    mockWindow.localStorage.setItem('ai-classroom-theme', 'blue')
    expect(getStoredTheme()).toBe('light')
  })

  it('returns light when window is unavailable (SSR-style guard)', () => {
    vi.unstubAllGlobals()
    expect(getStoredTheme()).toBe('light')
  })
})

describe('applyTheme + getStoredTheme — persistence across "refresh"', () => {
  let mockWindow: ReturnType<typeof createMockWindow>
  let mockDocument: ReturnType<typeof createMockDocument>

  beforeEach(() => {
    mockWindow = createMockWindow()
    mockDocument = createMockDocument()
    vi.stubGlobal('window', mockWindow)
    vi.stubGlobal('document', mockDocument)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('persists dark so a later getStoredTheme call (simulating a refresh) still returns dark', () => {
    applyTheme('dark')
    expect(mockDocument.documentElement.dataset.theme).toBe('dark')
    expect(getStoredTheme()).toBe('dark')
  })

  it('switching back to light persists and is restored the same way', () => {
    applyTheme('dark')
    applyTheme('light')
    expect(mockDocument.documentElement.dataset.theme).toBe('light')
    expect(getStoredTheme()).toBe('light')
  })
})
