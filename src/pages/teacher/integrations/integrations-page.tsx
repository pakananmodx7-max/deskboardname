import { Plug } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { GoogleDriveConnectionCard } from '@/features/google-drive/google-drive-connection-card'
import { toFriendlyErrorMessage } from '@/lib/errors'
import { useToast } from '@/components/ui/toast'
import { completeGoogleConnect } from '@/services/google-drive-service'

/**
 * Google Drive API Integration, Section 13: this page IS the OAuth
 * redirect_uri Google sends the browser back to (registered exactly as
 * `<origin>/teacher/integrations` in Google Cloud Console — see
 * docs/GOOGLE_DRIVE_SETUP.md) — on mount it checks its own URL for
 * `?code=&state=` left there by that redirect, completes the connect
 * flow if present, then strips those params from the URL so a page
 * refresh never re-submits the same one-time code.
 *
 * No longer linked from the sidebar (see nav-items.ts) — Google Drive's
 * connection status/connect/disconnect controls now also render inline
 * on the Subject detail page (see subjects-real/tabs/overview-tab.tsx),
 * via the SAME GoogleDriveConnectionCard used below, so a teacher rarely
 * needs to visit this URL directly. It stays reachable (and this exact
 * route is untouched) purely because Google's own redirect_uri is fixed
 * at this path.
 */
export function IntegrationsPage() {
  const { toast } = useToast()
  const navigate = useNavigate()

  const [callbackError, setCallbackError] = useState<string | null>(null)
  const [refreshSignal, setRefreshSignal] = useState(0)

  useEffect(() => {
    let active = true

    async function run() {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      const oauthState = params.get('state')
      if (!code || !oauthState) return

      try {
        await completeGoogleConnect(code, oauthState)
        navigate('/teacher/integrations', { replace: true })
        if (active) {
          toast('เชื่อมต่อบัญชี Google สำเร็จแล้ว')
          setRefreshSignal((n) => n + 1)
        }
      } catch (err) {
        if (active) {
          setCallbackError(toFriendlyErrorMessage(err, 'ไม่สามารถโหลดสถานะการเชื่อมต่อ Google ได้'))
        }
      }
    }

    run()
    return () => {
      active = false
    }
    // Deliberately runs once on mount only — re-checking on every
    // navigate() would re-read the (already-stripped) URL forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Plug className="size-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">การเชื่อมต่อระบบ</h1>
          <p className="text-sm text-muted-foreground">เชื่อมต่อบัญชี Google เพื่อเลือกไฟล์จาก Google Drive ได้โดยตรง</p>
        </div>
      </div>

      {callbackError && <p className="text-sm text-destructive">{callbackError}</p>}

      <GoogleDriveConnectionCard refreshSignal={refreshSignal} />
    </div>
  )
}
