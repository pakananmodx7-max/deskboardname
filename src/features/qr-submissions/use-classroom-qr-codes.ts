import { useCallback, useRef, useState } from 'react'

import { toFriendlyErrorMessage } from '@/lib/errors'
import { getClassroomQrCodes, regenerateQrCode, type StudentQrCode } from '@/services/qr-submission-service'

export type QrCodesState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; codes: Map<string, StudentQrCode> }
  | { status: 'error'; message: string }

/**
 * A classroom's student QR codes, loaded on first use only (opening a QR
 * or printing) — never just by visiting the roster. `load` is stable and
 * de-duplicates concurrent calls.
 */
export function useClassroomQrCodes(classroomId: string) {
  const [state, setState] = useState<QrCodesState>({ status: 'idle' })
  const cache = useRef<{ classroomId: string; codes: Map<string, StudentQrCode> } | null>(null)
  const inflight = useRef<{ classroomId: string; promise: Promise<Map<string, StudentQrCode>> } | null>(null)

  const load = useCallback(
    async (force = false): Promise<Map<string, StudentQrCode>> => {
      if (!force && cache.current?.classroomId === classroomId) return cache.current.codes
      if (!force && inflight.current?.classroomId === classroomId) return inflight.current.promise
      setState({ status: 'loading' })
      const promise = getClassroomQrCodes(classroomId)
      inflight.current = { classroomId, promise }
      try {
        const codes = await promise
        cache.current = { classroomId, codes }
        setState({ status: 'ready', codes })
        return codes
      } catch (err) {
        setState({ status: 'error', message: toFriendlyErrorMessage(err, 'โหลด QR ไม่สำเร็จ') })
        throw err
      } finally {
        if (inflight.current?.promise === promise) inflight.current = null
      }
    },
    [classroomId],
  )

  const loadCode = useCallback(async (studentId: string) => (await load()).get(studentId) ?? null, [load])

  const regenerate = useCallback(
    async (studentId: string): Promise<StudentQrCode> => {
      const fresh = await regenerateQrCode(classroomId, studentId)
      const codes = new Map(cache.current?.classroomId === classroomId ? cache.current.codes : [])
      codes.set(studentId, fresh)
      cache.current = { classroomId, codes }
      setState({ status: 'ready', codes })
      return fresh
    },
    [classroomId],
  )

  return { state, load, loadCode, regenerate }
}
