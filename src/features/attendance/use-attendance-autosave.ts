import { useCallback, useEffect, useRef, useState } from 'react'

import type { AttendanceRecord } from '@/types/attendance'

import { AttendanceAutoSaver, type AutoSaveSnapshot } from './attendance-autosave'
import type { BoardEntries } from './attendance-board-model'

const EMPTY_SNAPSHOT: AutoSaveSnapshot = {
  desired: {},
  confirmed: {},
  status: 'idle',
  pendingIds: new Set(),
  failedIds: new Set(),
  error: null,
  hasUnsaved: false,
}

export interface UseAttendanceAutoSave extends AutoSaveSnapshot {
  /** Load the session's saved entries (call after every load). */
  reset: (studentIds: string[], confirmed: BoardEntries) => void
  update: (next: BoardEntries) => void
  retry: () => void
  /** Drops unsaved changes (the teacher confirmed). */
  discard: () => void
  /** Saves everything now; false if a save failed. */
  flushNow: () => Promise<boolean>
}

/**
 * One AttendanceAutoSaver per session (`sessionKey` = classroom + date +
 * subject + คาบ). `save` is captured when the session starts, so writes
 * always go to the session they were made in; switching session disposes
 * the old saver, which still sends anything left unsaved (best effort).
 * Retries automatically when the browser comes back online.
 */
export function useAttendanceAutoSave(
  sessionKey: string,
  save: (records: AttendanceRecord[]) => Promise<void>,
  options: { onSaved?: (records: AttendanceRecord[]) => void; errorMessage?: (error: unknown) => string } = {},
): UseAttendanceAutoSave {
  const [snapshot, setSnapshot] = useState<AutoSaveSnapshot>(EMPTY_SNAPSHOT)
  const saverRef = useRef<AttendanceAutoSaver | null>(null)

  useEffect(() => {
    const saver = new AttendanceAutoSaver({
      save,
      onSaved: options.onSaved,
      errorMessage: options.errorMessage,
      onChange: setSnapshot,
    })
    saverRef.current = saver
    return () => {
      saver.dispose()
      if (saverRef.current === saver) saverRef.current = null
    }
    // A new saver per session only: save/options are captured for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey])

  useEffect(() => {
    const onOnline = () => {
      if (saverRef.current?.snapshot().status === 'error') saverRef.current.retry()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  const reset = useCallback((ids: string[], confirmed: BoardEntries) => saverRef.current?.reset(ids, confirmed), [])
  const update = useCallback((next: BoardEntries) => saverRef.current?.update(next), [])
  const retry = useCallback(() => saverRef.current?.retry(), [])
  const discard = useCallback(() => saverRef.current?.discard(), [])
  const flushNow = useCallback(() => saverRef.current?.flushNow() ?? Promise.resolve(true), [])

  return { ...snapshot, reset, update, retry, discard, flushNow }
}
