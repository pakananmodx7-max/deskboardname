export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'ai-classroom-theme'

/**
 * First-time visitors (nothing in localStorage yet) always default to
 * light, regardless of the OS/browser's prefers-color-scheme — the app
 * must never silently open in dark mode just because the visitor's
 * system is set to dark. Once a user has actually toggled the theme
 * (applyTheme below), that explicit choice is what's restored on every
 * later visit/refresh, forever — system preference is never consulted
 * again after that point either.
 */
export function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === 'dark' ? 'dark' : 'light'
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  window.localStorage.setItem(STORAGE_KEY, theme)
}
