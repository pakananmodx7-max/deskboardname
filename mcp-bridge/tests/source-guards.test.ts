import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const srcDir = fileURLToPath(new URL('../src', import.meta.url))

function stripComments(content: string): string {
  return content
    .split('\n')
    .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//') && !line.trim().startsWith('/**'))
    .join('\n')
}

const sourceFiles = readdirSync(srcDir)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => {
    const content = readFileSync(`${srcDir}/${name}`, 'utf-8')
    return { name, content, code: stripComments(content) }
  })

describe('stdio protocol safety — nothing may ever write to stdout except the MCP transport itself', () => {
  it('no source file calls console.log/console.info/console.warn/process.stdout.write', () => {
    for (const file of sourceFiles) {
      expect(file.content, `${file.name} must not write to stdout`).not.toMatch(
        /console\.(log|info|warn)\(|process\.stdout\.write\(/,
      )
    }
  })

  it('all diagnostic output goes through logger.ts\'s stderr-only helpers', () => {
    const nonLoggerFiles = sourceFiles.filter((f) => f.name !== 'logger.ts')
    const filesThatLog = nonLoggerFiles.filter((f) => /\blogInfo\(|\blogError\(/.test(f.content))
    for (const file of filesThatLog) {
      expect(file.content).toMatch(/from '\.\/logger\.js'/)
    }
  })
})

describe('credential safety — the service-role key is structurally unreachable', () => {
  it('SUPABASE_SERVICE_ROLE_KEY is read as an env var ONLY inside config.ts\'s Boolean(...) presence check — nowhere else, and never assigned to a variable', () => {
    for (const file of sourceFiles) {
      const envReads = file.code.match(/(process\.)?env(\.|\[)SUPABASE_SERVICE_ROLE_KEY/g) ?? []
      if (envReads.length === 0) continue
      expect(file.name).toBe('config.ts')
      expect(envReads).toEqual(['env.SUPABASE_SERVICE_ROLE_KEY'])
      expect(file.code).toContain('Boolean(env.SUPABASE_SERVICE_ROLE_KEY)')
    }
  })

  it('no source file imports or instantiates a service-role/admin Supabase client', () => {
    for (const file of sourceFiles) {
      expect(file.code).not.toMatch(/createAdminClient|service[_-]?role[_-]?key\s*[:=]/i)
    }
  })

  it('no source file ever logs an access_token, refresh_token, or password value directly (only via the scrubbing logger)', () => {
    for (const file of sourceFiles) {
      if (file.name === 'logger.ts' || file.name === 'teacher-session.ts') continue
      expect(file.code).not.toMatch(/console\.\w+\([^)]*(accessToken|access_token|refreshToken|refresh_token|password)/i)
    }
  })
})

describe('write tools are structurally absent, not just unregistered', () => {
  it('the write tool names appear ONLY inside tool-schemas.ts\'s own EXCLUDED_WRITE_TOOL_NAMES reference list (and its doc comment) — never in server.ts, index.ts, or anywhere a tool actually gets registered or called', () => {
    for (const file of sourceFiles) {
      if (!file.content.match(/create_assignment|copy_assignment_to_classrooms|mark_attendance_bulk/)) continue
      expect(file.name).toBe('tool-schemas.ts')
    }
    const toolSchemasCode = sourceFiles.find((f) => f.name === 'tool-schemas.ts')!.code
    const codeOutsideExclusionList = toolSchemasCode.replace(
      /export const EXCLUDED_WRITE_TOOL_NAMES = \[[\s\S]*?\] as const/,
      '',
    )
    expect(codeOutsideExclusionList).not.toMatch(/create_assignment|copy_assignment_to_classrooms|mark_attendance_bulk/)
  })
})

describe('index.ts — fails fast and clearly on startup problems', () => {
  const index = sourceFiles.find((f) => f.name === 'index.ts')!

  it('loads config and establishes a session BEFORE connecting the stdio transport', () => {
    const configIndex = index.content.indexOf('loadConfig(process.env)')
    const sessionIndex = index.content.indexOf('ensureValidSession()')
    const connectIndex = index.content.indexOf('server.connect(transport)')
    expect(configIndex).toBeGreaterThan(-1)
    expect(configIndex).toBeLessThan(sessionIndex)
    expect(sessionIndex).toBeLessThan(connectIndex)
  })

  it('exits with a non-zero code on ConfigError or TeacherAuthError', () => {
    expect(index.content).toContain('process.exit(1)')
    expect(index.content).toContain('ConfigError')
    expect(index.content).toContain('TeacherAuthError')
  })
})
