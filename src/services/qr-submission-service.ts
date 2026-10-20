import { canonicalQrPayload } from '@/features/qr-submissions/qr-payload'
import { parseScanResult, type ScanResult } from '@/features/qr-submissions/scan-model'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { getSupabaseClient } from '@/lib/supabase'
import type { LatePolicy, SubmissionStatus } from '@/types/assignment'

/**
 * Student QR identities and QR-scanned submissions — every call goes
 * through the SECURITY DEFINER RPCs of migration 0030, which check the
 * signed-in teacher's ownership on the server. The browser never sends a
 * timestamp or a status for a scan, and never reads the QR table directly.
 */

/** Migration 0030 is not on this database yet. */
export class QrFeatureUnavailableError extends Error {
  constructor() {
    super('ระบบ QR ยังไม่พร้อมใช้งาน — ผู้ดูแลระบบต้องติดตั้งฐานข้อมูลส่วน QR (migration 0030) ก่อน')
    this.name = 'QrFeatureUnavailableError'
  }
}

/** A request that failed — the message is safe to show as-is. */
export class QrRequestError extends Error {
  readonly kind: 'session' | 'permission' | 'network' | 'invalid' | 'other'
  constructor(message: string, kind: QrRequestError['kind']) {
    super(message)
    this.name = 'QrRequestError'
    this.kind = kind
  }
}

const MISSING_FUNCTION_CODES = new Set(['42883', 'PGRST202'])
const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST204'])

/** Exported for tests: maps a Supabase/PostgREST/network error. */
export function toQrError(error: unknown): Error {
  const e = error as { code?: string; message?: string; status?: number } | null
  const code = e?.code ?? ''
  if (MISSING_FUNCTION_CODES.has(code) || MISSING_COLUMN_CODES.has(code)) return new QrFeatureUnavailableError()
  if (code === 'PGRST301' || code === '28000' || /jwt expired|invalid jwt|refresh token/i.test(e?.message ?? '')) {
    return new QrRequestError('เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่ แล้วสแกนอีกครั้ง', 'session')
  }
  if (code === '42501') return new QrRequestError(toFriendlyErrorMessage(error, 'คุณไม่มีสิทธิ์ดำเนินการนี้'), 'permission')
  if (code === '22023' || code === '23514') return new QrRequestError(toFriendlyErrorMessage(error, 'ข้อมูลไม่ถูกต้อง'), 'invalid')
  // supabase-js reports a failed fetch as an error object whose message
  // carries the browser's text ("TypeError: Failed to fetch", …).
  if (/failed to fetch|networkerror|load failed|fetch failed|network request failed/i.test(e?.message ?? '') || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return new QrRequestError('ไม่สามารถเชื่อมต่ออินเทอร์เน็ตได้ — ตรวจสอบการเชื่อมต่อแล้วสแกนอีกครั้ง', 'network')
  }
  return new QrRequestError(toFriendlyErrorMessage(error, 'กรุณาลองใหม่อีกครั้ง'), 'other')
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  let response
  try {
    response = await getSupabaseClient().rpc(fn, args)
  } catch (err) {
    throw toQrError(err)
  }
  if (response.error) throw toQrError(response.error)
  return response.data as T
}

// ==================================================
// QR identities
// ==================================================

export interface StudentQrCode {
  studentId: string
  token: string
  createdAt: string
}

interface QrRow {
  student_id: string
  token: string
  created_at: string
}

/** Active QR for every student currently in the classroom (issued on the
 * server if one is missing; idempotent). */
export async function getClassroomQrCodes(classroomId: string): Promise<Map<string, StudentQrCode>> {
  const rows = await rpc<QrRow[] | null>('get_classroom_student_qr_codes', { p_classroom_id: classroomId })
  return new Map((rows ?? []).map((r) => [r.student_id, { studentId: r.student_id, token: r.token, createdAt: r.created_at }]))
}

/** Revoke the student's current QR and issue a new one (old cards stop
 * working immediately). */
export async function regenerateQrCode(classroomId: string, studentId: string): Promise<StudentQrCode> {
  const rows = await rpc<QrRow[] | null>('regenerate_student_qr_code', { p_classroom_id: classroomId, p_student_id: studentId })
  const row = rows?.[0]
  if (!row) throw new QrRequestError('สร้าง QR ใหม่ไม่สำเร็จ', 'other')
  return { studentId: row.student_id, token: row.token, createdAt: row.created_at }
}

// ==================================================
// Recording submissions
// ==================================================

/** Returns null when the scanned text is not a KrunameClass QR at all
 * (nothing is sent to the server for it). */
export async function recordSubmissionScan(assignmentId: string, scannedText: string): Promise<ScanResult | null> {
  const payload = canonicalQrPayload(scannedText)
  if (!payload) return null
  return parseScanResult(await rpc<unknown>('record_submission_scan', { p_assignment_id: assignmentId, p_qr_payload: payload }))
}

/** Manual fallback (no QR): the same server rules, by student id. */
export async function recordSubmissionManual(assignmentId: string, studentId: string): Promise<ScanResult> {
  return parseScanResult(await rpc<unknown>('record_submission_manual', { p_assignment_id: assignmentId, p_student_id: studentId }))
}

export interface CorrectionResult {
  outcome: 'corrected' | 'unchanged'
  status: SubmissionStatus
  submittedAt: string | null
}

/** Audited status correction (reason required). Never changes the score. */
export async function correctSubmissionStatus(assignmentId: string, studentId: string, status: SubmissionStatus, reason: string): Promise<CorrectionResult> {
  const raw = await rpc<Record<string, unknown>>('correct_submission_status', {
    p_assignment_id: assignmentId,
    p_student_id: studentId,
    p_status: status,
    p_reason: reason,
  })
  const outcome = raw?.outcome === 'unchanged' ? 'unchanged' : 'corrected'
  const sub = (raw?.submission ?? {}) as { status?: SubmissionStatus; submitted_at?: string | null }
  return { outcome, status: sub.status ?? status, submittedAt: sub.submitted_at ?? null }
}

// ==================================================
// Assignment submission settings
// ==================================================

export interface SubmissionSettingsInput {
  submissionDeadline: string | null
  latePolicy: LatePolicy
  acceptingSubmissions: boolean
}

/** Owner-only through the existing assignments_update_own RLS policy. */
export async function updateSubmissionSettings(assignmentId: string, input: SubmissionSettingsInput): Promise<void> {
  let response
  try {
    response = await getSupabaseClient()
      .from('assignments')
      .update({ submission_deadline: input.submissionDeadline, late_policy: input.latePolicy, accepting_submissions: input.acceptingSubmissions })
      .eq('id', assignmentId)
      .select('id')
  } catch (err) {
    throw toQrError(err)
  }
  if (response.error) throw toQrError(response.error)
  if (!response.data || response.data.length === 0) throw new QrRequestError('ไม่พบงานนี้ หรือคุณไม่มีสิทธิ์แก้ไข', 'permission')
}
