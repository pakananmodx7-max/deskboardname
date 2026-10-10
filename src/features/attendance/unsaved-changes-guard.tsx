import { useEffect } from 'react'
import { useBlocker } from 'react-router-dom'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'

export const UNSAVED_ATTENDANCE_MESSAGE = 'การเช็คชื่อที่แก้ไขยังไม่ได้บันทึก หากออกจากหน้านี้ การเปลี่ยนแปลงจะหายไป'

/**
 * Warns before leaving with unsaved attendance edits:
 *   - another page or another classroom (pathname change): in-app
 *     confirm via useBlocker;
 *   - refresh / closing the tab: the browser's own beforeunload prompt.
 * Switching subject tabs or the date/คาบ is guarded by the callers
 * themselves (those don't change the pathname).
 */
export function UnsavedChangesGuard({ when }: { when: boolean }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => when && currentLocation.pathname !== nextLocation.pathname)

  useEffect(() => {
    if (!when) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Legacy browsers need returnValue set for the prompt to appear.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [when])

  return (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => {
        if (!open && blocker.state === 'blocked') blocker.reset()
      }}
      title="ออกโดยไม่บันทึก?"
      description={UNSAVED_ATTENDANCE_MESSAGE}
      confirmLabel="ออกโดยไม่บันทึก"
      onConfirm={() => {
        if (blocker.state === 'blocked') blocker.proceed()
      }}
    />
  )
}
