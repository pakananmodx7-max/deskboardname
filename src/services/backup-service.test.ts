import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { buildManifestTable } from '@/services/backup-service'

describe('buildManifestTable — pure backup manifest', () => {
  it('includes generated_at, teacher_email, schema version, and every row count given', () => {
    const table = buildManifestTable('2026-09-10T12:00:00.000Z', 'teacher@example.com', {
      classrooms: 3,
      students: 42,
    })
    expect(table.rows).toContainEqual(['generated_at', '2026-09-10T12:00:00.000Z'])
    expect(table.rows).toContainEqual(['teacher_email', 'teacher@example.com'])
    expect(table.rows).toContainEqual(['rows_classrooms', 3])
    expect(table.rows).toContainEqual(['rows_students', 42])
    expect(table.rows.some((r) => r[0] === 'backup_schema_version')).toBe(true)
    expect(table.rows.some((r) => r[0] === 'latest_accounted_migration')).toBe(true)
  })

  it('writes an empty string (never null/undefined) when the teacher has no email on file', () => {
    const table = buildManifestTable('2026-09-10T12:00:00.000Z', null, {})
    expect(table.rows).toContainEqual(['teacher_email', ''])
  })
})

describe('backup-service.ts — source-level safety guards', () => {
  const source = readFileSync(new URL('./backup-service.ts', import.meta.url), 'utf-8')

  it('never imports a signed-URL function — a signed URL is a short-lived credential, never a valid backup identifier', () => {
    const importLines = source.split('\n').filter((line) => line.trim().startsWith('import '))
    for (const line of importLines) {
      expect(line).not.toMatch(/getResourceSignedUrl|getLessonResourceSignedUrl|getSubmissionResourceSignedUrl/)
    }
  })

  it('builds every CSV through the shared buildCsvContent helper — formula-injection escaping and the UTF-8 BOM are inherited, never reimplemented', () => {
    expect(source).toContain("buildCsvContent, type ExportTable } from '@/lib/export/export-table'")
    expect(source).toMatch(/function csvFile[\s\S]*?buildCsvContent\(table\)/)
  })

  it('requires the caller\'s own authenticated identity before reading anything — cross-teacher isolation starts here', () => {
    expect(source).toContain('supabase.auth.getUser()')
    expect(source).toMatch(/async function buildTeacherBackup[\s\S]*?requireTeacherIdentity\(\)/)
  })

  it('never applies an active/archived filter before mapping classrooms, subjects, assignments, or lessons into rows — archived academic history must stay in the export', () => {
    expect(source).not.toContain('.filter(')
  })

  it('reuses only existing, already-RLS-scoped service functions — no raw supabase.from(...) query of its own (getSupabaseClient is used only for auth.getUser())', () => {
    expect(source).not.toMatch(/supabase\s*\.\s*from\(/)
  })
})
