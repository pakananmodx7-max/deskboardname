import { beforeEach, describe, expect, it, vi } from 'vitest'

const TOKEN = '1e4604a5b4dc428c93760ca1de282f5793fb89f5c5d44bf5b4f1bcf8407a74e1'

const calls: { fn: string; args: Record<string, unknown> }[] = []
let nextResponse: { data: unknown; error: unknown } = { data: null, error: null }
let updateResponse: { data: unknown; error: unknown } = { data: [{ id: 'a1' }], error: null }
const updates: { table: string; values: Record<string, unknown>; id: unknown }[] = []

const client = {
  rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args })
    return nextResponse
  }),
  from: (table: string) => ({
    update: (values: Record<string, unknown>) => ({
      eq: (_col: string, id: unknown) => ({
        select: async () => {
          updates.push({ table, values, id })
          return updateResponse
        },
      }),
    }),
  }),
}

vi.mock('@/lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase')>()),
  supabase: null,
  getSupabaseClient: () => client,
}))

const service = await import('./qr-submission-service')

beforeEach(() => {
  calls.length = 0
  updates.length = 0
  nextResponse = { data: null, error: null }
  updateResponse = { data: [{ id: 'a1' }], error: null }
})

describe('recording scans', () => {
  it('invalid text never reaches the server', async () => {
    expect(await service.recordSubmissionScan('a1', 'https://example.com')).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('sends only the assignment id + canonical payload (Thai-layout input normalised)', async () => {
    nextResponse = { data: { outcome: 'recorded', student: { id: 's1', first_name: 'อนันต์', last_name: 'ใจดี' }, submission: { id: 'x', status: 'late', submitted_at: '2026-10-20T13:00:00Z', score: null } }, error: null }
    const thai = 'าแๆพๅ' + TOKEN.replace(/./g, (c) => ({ 1: 'ๅ', 2: '/', 3: '-', 4: 'ภ', 5: 'ถ', 6: 'ุ', 7: 'ึ', 8: 'ค', 9: 'ต', 0: 'จ', a: 'ฟ', b: 'ิ', c: 'แ', d: 'ก', e: 'ำ', f: 'ด' })[c] ?? c)
    const result = await service.recordSubmissionScan('a1', thai)
    expect(calls).toEqual([{ fn: 'record_submission_scan', args: { p_assignment_id: 'a1', p_qr_payload: `kcqr1${TOKEN}` } }])
    expect(result?.outcome).toBe('recorded')
    expect(result?.submission?.status).toBe('late')
  })

  it('manual fallback and correction call their own RPCs', async () => {
    nextResponse = { data: { outcome: 'recorded' }, error: null }
    await service.recordSubmissionManual('a1', 's1')
    nextResponse = { data: { outcome: 'corrected', submission: { status: 'excused', submitted_at: null } }, error: null }
    const corrected = await service.correctSubmissionStatus('a1', 's1', 'excused', 'ป่วย')
    expect(calls.map((c) => c.fn)).toEqual(['record_submission_manual', 'correct_submission_status'])
    expect(calls[1].args).toEqual({ p_assignment_id: 'a1', p_student_id: 's1', p_status: 'excused', p_reason: 'ป่วย' })
    expect(corrected).toEqual({ outcome: 'corrected', status: 'excused', submittedAt: null })
  })

  it('classroom QR codes and regeneration', async () => {
    nextResponse = { data: [{ student_id: 's1', token: TOKEN, created_at: 't' }], error: null }
    const codes = await service.getClassroomQrCodes('c1')
    expect(codes.get('s1')?.token).toBe(TOKEN)
    nextResponse = { data: [], error: null }
    await expect(service.regenerateQrCode('c1', 's1')).rejects.toThrow('สร้าง QR ใหม่ไม่สำเร็จ')
    expect(calls.map((c) => c.fn)).toEqual(['get_classroom_student_qr_codes', 'regenerate_student_qr_code'])
  })
})

describe('error mapping (never a false success)', () => {
  it('migration 0030 missing → QrFeatureUnavailableError', async () => {
    nextResponse = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
    await expect(service.recordSubmissionScan('a1', `kcqr1${TOKEN}`)).rejects.toBeInstanceOf(service.QrFeatureUnavailableError)
    expect(service.toQrError({ code: '42703' })).toBeInstanceOf(service.QrFeatureUnavailableError)
  })

  it('expired session, permission, network', () => {
    expect(service.toQrError({ code: 'PGRST301', message: 'JWT expired' })).toMatchObject({ kind: 'session' })
    expect(service.toQrError({ message: 'JWT expired' })).toMatchObject({ kind: 'session' })
    expect(service.toQrError({ code: '42501', message: 'ไม่พบงานนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' })).toMatchObject({ kind: 'permission', message: 'ไม่พบงานนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' })
    expect(service.toQrError({ message: 'TypeError: Failed to fetch' })).toMatchObject({ kind: 'network' })
    expect(service.toQrError(new TypeError('Failed to fetch'))).toMatchObject({ kind: 'network' })
  })

  it('a thrown client error is mapped too', async () => {
    client.rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(service.recordSubmissionManual('a1', 's1')).rejects.toMatchObject({ kind: 'network' })
  })

  it('an unexpected RPC payload is an error, not a success', async () => {
    nextResponse = { data: { outcome: 'saved' }, error: null }
    await expect(service.recordSubmissionScan('a1', `kcqr1${TOKEN}`)).rejects.toThrow('ผลลัพธ์จากเซิร์ฟเวอร์ไม่ถูกต้อง')
  })
})

describe('submission settings', () => {
  it('writes the three 0030 columns through RLS; zero rows = not allowed', async () => {
    await service.updateSubmissionSettings('a1', { submissionDeadline: '2026-10-25T01:30:00.000Z', latePolicy: 'reject_late', acceptingSubmissions: false })
    expect(updates).toEqual([{ table: 'assignments', id: 'a1', values: { submission_deadline: '2026-10-25T01:30:00.000Z', late_policy: 'reject_late', accepting_submissions: false } }])
    updateResponse = { data: [], error: null }
    await expect(service.updateSubmissionSettings('a1', { submissionDeadline: null, latePolicy: 'accept_late', acceptingSubmissions: true })).rejects.toMatchObject({ kind: 'permission' })
  })
})
