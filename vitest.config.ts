import path from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    // mcp-bridge/ is a separate, standalone Node package (its own
    // package.json/tsconfig/vitest.config.ts, run via `npm test` from
    // inside that directory) — it is not part of this Vite app and its
    // dependencies (e.g. @modelcontextprotocol/sdk) are not installed
    // at the repo root, so its own test files must never be picked up
    // by this root suite. Spreading configDefaults.exclude keeps
    // Vitest's own default ignores (node_modules, dist, etc.) — setting
    // `exclude` replaces rather than merges with them.
    exclude: [...configDefaults.exclude, 'mcp-bridge/**'],
  },
})
