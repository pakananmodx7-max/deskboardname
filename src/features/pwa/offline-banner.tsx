import { WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * Shown only while the device is offline. The app shell still opens from
 * the service worker, but nothing is stored for offline use — signing in,
 * saving attendance or scores, submitting work and QR scanning all need
 * the internet, so we say so instead of letting those fail silently.
 * It never takes taps (pointer-events-none), so it cannot block a button.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine)

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  if (!offline) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-[105] mx-auto flex max-w-md items-start gap-2.5 rounded-2xl border border-warning/40 bg-card/95 p-3 text-sm text-card-foreground shadow-elevated backdrop-blur-sm"
    >
      <WifiOff className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <p>
        <span className="font-semibold">ไม่มีการเชื่อมต่ออินเทอร์เน็ต</span>
        <span className="block text-xs text-muted-foreground">
          การเข้าสู่ระบบ การบันทึกคะแนน การส่งงาน และการสแกน QR ต้องใช้อินเทอร์เน็ต — ข้อมูลยังไม่ถูกบันทึกจนกว่าจะเชื่อมต่อได้
        </span>
      </p>
    </div>
  )
}
