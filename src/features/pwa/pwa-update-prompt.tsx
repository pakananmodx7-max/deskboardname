import { Loader2, RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

import { Button } from '@/components/ui/button'
import { pendingWriteCount, waitForNoPendingWrites } from '@/lib/pending-writes'
import { hasUnsavedWork } from '@/lib/unsaved-work'

import { browserUpdateCheckEnv, startUpdateChecks } from './update-checks'

/**
 * "มีเวอร์ชันใหม่" — shown only when a new deploy has been downloaded and
 * is waiting. Nothing reloads by itself: the user taps "อัปเดตตอนนี้".
 * If a save/upload is still in flight the update waits for it to finish
 * (pending-writes.ts); with unsaved edits open (e.g. attendance not yet
 * saved — unsaved-work.ts) it does not reload at all and asks the user to
 * save first. The session lives in localStorage, so the reload keeps the
 * user signed in.
 */
export function PwaUpdatePrompt() {
  const [stopChecks, setStopChecks] = useState<(() => void) | null>(null)
  const [waitingForSave, setWaitingForSave] = useState(false)
  const [unsavedNotice, setUnsavedNotice] = useState(false)
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (registration) setStopChecks(() => startUpdateChecks(registration, browserUpdateCheckEnv))
    },
  })

  useEffect(() => () => stopChecks?.(), [stopChecks])

  if (!needRefresh) return null

  async function handleUpdate() {
    if (hasUnsavedWork()) {
      setUnsavedNotice(true)
      return
    }
    setUnsavedNotice(false)
    if (pendingWriteCount() > 0) {
      setWaitingForSave(true)
      await waitForNoPendingWrites()
    }
    await updateServiceWorker(true)
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-[110] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-border bg-card p-3 text-sm text-card-foreground shadow-elevated sm:inset-x-auto sm:right-4"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <RefreshCw className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">มีเวอร์ชันใหม่ของ KrunameClass</p>
        <p className="text-xs text-muted-foreground">
          {waitingForSave
            ? 'กำลังบันทึกข้อมูล — จะอัปเดตทันทีที่บันทึกเสร็จ'
            : unsavedNotice
              ? 'มีข้อมูลที่ยังไม่ได้บันทึก — กดบันทึกก่อน แล้วแตะอัปเดตอีกครั้ง'
              : 'อัปเดตเพื่อใช้เวอร์ชันล่าสุด ข้อมูลที่บันทึกแล้วจะไม่หาย'}
        </p>
      </div>
      <Button type="button" size="sm" className="shrink-0 rounded-full" onClick={() => void handleUpdate()} disabled={waitingForSave}>
        {waitingForSave && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
        อัปเดตตอนนี้
      </Button>
      {!waitingForSave && (
        <button
          type="button"
          onClick={() => setNeedRefresh(false)}
          className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label="ภายหลัง"
          title="ภายหลัง"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}
