import { readFileSync } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: { fn: string; args: Record<string, unknown> }[] = []
const updates: { table: string; values: Record<string, unknown>; id: unknown }[] = []
let rpcResponse: { data: unknown; error: unknown } = { data: null, error: null }
let rpcThrows: unknown = null

const row = (over: Record<string, unknown> = {}) => ({
  id: 'c1', teacher_id: 't1', name: 'ม.5/1', grade_level: 'ม.5', section: null, academic_year: '2569', semester: '2',
  is_active: false, archived_at: '2026-10-23T00:00:00Z', created_at: '2026-01-01', updated_at: '2026-10-23', ...over,
})

const client = {
  rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args })
    if (rpcThrows) throw rpcThrows
    return rpcResponse
  }),
  from: (table: string) => ({
    update: (values: Record<string, unknown>) => ({
      eq: (_col: string, id: unknown) => ({
        select: () => ({
          single: async () => {
            updates.push({ table, values, id })
            return { data: row({ is_active: values.is_active }), error: null }
          },
        }),
      }),
    }),
  }),
}

vi.mock('@/lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase')>()),
  supabase: null,
  getSupabaseClient: () => client,
}))

const service = await import('./classroom-lifecycle-service')
const { toClassroomLifecycleError, ClassroomLifecycleError } = await import('./classroom-lifecycle-errors')

const COUNTS = {
  enrollments: 2, subject_links: 1, assignments: 1, assignment_resources: 2, submissions: 2, graded_submissions: 1,
  submission_resources: 1, submission_events: 1, attendance_sessions: 2, attendance_records: 3, lessons: 1, lesson_resources: 2,
  sgs_columns: 1, sgs_scores: 1, followup_notes: 1, notifications: 0, storage_files: 3, drive_files: 2, files_referenced_elsewhere: 1,
  students: 2, students_only_in_this_classroom: 1, students_in_other_classrooms: 1, linked_student_accounts: 1, qr_identities: 2,
  subjects_linked: 1, other_classroom_submissions: 1, other_classroom_attendance_records: 1, foreign_subject_records: 0,
}
const PREVIEW = { classroom: row(), counts: COUNTS, blockers: [], fingerprint: 'abc123' }

beforeEach(() => {
  calls.length = 0
  updates.length = 0
  rpcResponse = { data: null, error: null }
  rpcThrows = null
})

describe('archive / restore', () => {
  it('archive goes through the server-checked RPC, not a client-side update', async () => {
    rpcResponse = { data: row({ is_active: false }), error: null }
    const result = await service.archiveClassroom('c1')
    expect(calls).toEqual([{ fn: 'set_classroom_archived', args: { p_classroom_id: 'c1', p_archived: true } }])
    expect(updates).toHaveLength(0)
    expect(result.isActive).toBe(false)
    expect(result.archivedAt).toBe('2026-10-23T00:00:00Z')
  })

  it('restore sends p_archived=false', async () => {
    rpcResponse = { data: row({ is_active: true, archived_at: null }), error: null }
    const result = await service.reactivateClassroom('c1')
    expect(calls[0]).toEqual({ fn: 'set_classroom_archived', args: { p_classroom_id: 'c1', p_archived: false } })
    expect(result.isActive).toBe(true)
  })

  it('duplicate archive / restore are reported, not silently accepted', async () => {
    rpcResponse = { data: null, error: { code: 'KC005', message: 'ห้องเรียนนี้ถูกเก็บถาวรอยู่แล้ว' } }
    await expect(service.archiveClassroom('c1')).rejects.toMatchObject({ kind: 'already_archived', message: 'ห้องเรียนนี้ถูกเก็บถาวรอยู่แล้ว' })
    rpcResponse = { data: null, error: { code: 'KC006', message: 'ห้องเรียนนี้ใช้งานอยู่แล้ว' } }
    await expect(service.reactivateClassroom('c1')).rejects.toMatchObject({ kind: 'already_active' })
    expect(updates).toHaveLength(0)
  })

  it('before 0032 is installed, archiving still works through the previous update', async () => {
    rpcResponse = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
    const result = await service.archiveClassroom('c1')
    expect(updates).toEqual([{ table: 'classrooms', values: { is_active: false }, id: 'c1' }])
    expect(result.isActive).toBe(false)
  })

  it('a permission error is never turned into the fallback update', async () => {
    rpcResponse = { data: null, error: { code: '42501', message: 'ไม่พบห้องเรียนนี้ หรือคุณไม่มีสิทธิ์จัดการห้องเรียนนี้' } }
    await expect(service.archiveClassroom('c1')).rejects.toMatchObject({ kind: 'permission' })
    expect(updates).toHaveLength(0)
  })
})

describe('deletion preview', () => {
  it('reads the preview from the server and validates it', async () => {
    rpcResponse = { data: PREVIEW, error: null }
    const preview = await service.getClassroomDeletionPreview('c1')
    expect(calls).toEqual([{ fn: 'get_classroom_deletion_preview', args: { p_classroom_id: 'c1' } }])
    expect(preview.fingerprint).toBe('abc123')
    expect(preview.counts.attendance_records).toBe(3)
    expect(preview.classroom.name).toBe('ม.5/1')
  })

  it('a malformed preview is an error, never a dialog full of zeros', async () => {
    rpcResponse = { data: { ...PREVIEW, counts: { ...COUNTS, attendance_records: undefined } }, error: null }
    await expect(service.getClassroomDeletionPreview('c1')).rejects.toThrow('ข้อมูลตัวอย่างการลบไม่สมบูรณ์')
    rpcResponse = { data: { ...PREVIEW, fingerprint: '' }, error: null }
    await expect(service.getClassroomDeletionPreview('c1')).rejects.toThrow()
  })

  it('0032 not installed: a clear "unavailable" message', async () => {
    rpcResponse = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
    await expect(service.getClassroomDeletionPreview('c1')).rejects.toMatchObject({ kind: 'unavailable' })
  })
})

describe('permanent delete', () => {
  it('sends the typed name and the confirmed fingerprint, exactly as given', async () => {
    rpcResponse = { data: { event_id: 'e1', counts: COUNTS, queued_files: 5 }, error: null }
    const result = await service.deleteClassroomPermanently('c1', 'ม.5/1', 'abc123')
    expect(calls).toEqual([{ fn: 'delete_classroom_permanently', args: { p_classroom_id: 'c1', p_confirmation_name: 'ม.5/1', p_expected_fingerprint: 'abc123' } }])
    expect(result).toEqual({ eventId: 'e1', queuedFiles: 5 })
  })

  it('no server confirmation (no event id) is never reported as success', async () => {
    rpcResponse = { data: null, error: null }
    await expect(service.deleteClassroomPermanently('c1', 'ม.5/1', 'abc123')).rejects.toBeInstanceOf(ClassroomLifecycleError)
  })

  it.each([
    ['KC001', 'not_archived'],
    ['KC002', 'name_mismatch'],
    ['KC003', 'stale'],
    ['KC004', 'blocked'],
    ['42501', 'permission'],
    ['28000', 'session'],
    ['PGRST301', 'session'],
  ])('server refusal %s maps to %s', async (code, kind) => {
    rpcResponse = { data: null, error: { code, message: 'x' } }
    await expect(service.deleteClassroomPermanently('c1', 'ม.5/1', 'abc123')).rejects.toMatchObject({ kind })
  })

  it('a network failure says nothing changed', async () => {
    rpcThrows = new TypeError('Failed to fetch')
    await expect(service.deleteClassroomPermanently('c1', 'ม.5/1', 'abc123')).rejects.toMatchObject({ kind: 'network', message: expect.stringContaining('ยังไม่มีการเปลี่ยนแปลง') })
  })
})

describe('error mapping', () => {
  it('keeps the Thai message raised by the database', () => {
    expect(toClassroomLifecycleError({ code: 'KC004', message: 'ห้องเรียนนี้มีข้อมูล 1 รายการที่อยู่ในรายวิชาของครูคนอื่น' }).message).toContain('รายวิชาของครูคนอื่น')
  })
  it('falls back to a Thai message when Postgres sent English', () => {
    expect(toClassroomLifecycleError({ code: 'KC003', message: 'stale' }).message).toContain('ข้อมูลของห้องเรียนนี้เปลี่ยนไป')
    expect(toClassroomLifecycleError({ code: '42501', message: 'permission denied' }).message).toBe('คุณไม่มีสิทธิ์จัดการห้องเรียนนี้')
  })
  it('an expired JWT is a session error', () => {
    expect(toClassroomLifecycleError({ message: 'JWT expired' }).kind).toBe('session')
  })
})

describe('the client can only delete through the guarded RPC', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf-8')
  it('no client code deletes classrooms rows directly', () => {
    for (const p of ['./classroom-service.ts', './classroom-lifecycle-service.ts', '../features/classroom-management/delete-classroom-dialog.tsx', '../features/classroom-analytics/components/classroom-section.tsx', '../pages/teacher/classrooms/classroom-detail-page-real.tsx']) {
      expect(read(p)).not.toMatch(/from\('classrooms'\)\s*\.delete|\.delete\(\)\.eq\('id', classroomId\)/)
    }
  })
  it('the migration drops the raw delete policy and never adds a cascade', () => {
    const sql = read('../../supabase/migrations/0032_classroom_archive_and_delete.sql')
    expect(sql).toContain('drop policy if exists classrooms_delete_own on public.classrooms;')
    expect(sql.replace(/--.*$/gm, '')).not.toMatch(/on delete cascade/i)
    expect(sql).toContain("revoke all on function public.classroom_deletion_counts(uuid) from public, anon, authenticated;")
  })
})
