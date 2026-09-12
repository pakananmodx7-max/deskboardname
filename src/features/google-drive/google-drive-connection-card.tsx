import { CheckCircle2, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { toFriendlyErrorMessage } from '@/lib/errors'
import {
  disconnectGoogleAccount,
  getGoogleConnectionStatus,
  startGoogleConnect,
  type GoogleConnectionStatus,
} from '@/services/google-drive-service'

type LoadState = 'loading' | 'ready' | 'error'

function formatThaiDate(iso: string): string {
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
}

export interface GoogleDriveConnectionCardProps {
  /** Bump this (e.g. after completing the OAuth redirect callback
   * elsewhere on the page) to force a fresh status re-fetch — this
   * component otherwise only checks status once, on mount. */
  refreshSignal?: number
  className?: string
}

/**
 * Google Drive API Integration, Section 13's connect/reconnect/disconnect
 * controls, extracted out of the standalone Integrations page so the
 * SAME status/connect/disconnect logic (getGoogleConnectionStatus,
 * startGoogleConnect, disconnectGoogleAccount — never re-implemented)
 * can also render on the Subject detail page's "การเชื่อมต่อและสื่อการสอน"
 * section (see subjects-real/tabs/overview-tab.tsx). The OAuth
 * redirect-callback handling itself (`?code=&state=` → completeGoogleConnect)
 * stays only in integrations-page.tsx, since `/teacher/integrations` is
 * the fixed, Google-Cloud-Console-registered redirect_uri — this
 * component only ever reads the CURRENT connection status, it never
 * inspects the URL.
 */
export function GoogleDriveConnectionCard({ refreshSignal, className }: GoogleDriveConnectionCardProps = {}) {
  const { toast } = useToast()

  const [state, setState] = useState<LoadState>('loading')
  const [status, setStatus] = useState<GoogleConnectionStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [disconnectOpen, setDisconnectOpen] = useState(false)

  useEffect(() => {
    let active = true
    setState('loading')
    getGoogleConnectionStatus()
      .then((result) => {
        if (!active) return
        setStatus(result)
        setState('ready')
      })
      .catch((err: unknown) => {
        if (!active) return
        setError(toFriendlyErrorMessage(err, 'ไม่สามารถโหลดสถานะการเชื่อมต่อ Google ได้'))
        setState('error')
      })
    return () => {
      active = false
    }
  }, [refreshSignal])

  async function handleConnect() {
    setConnecting(true)
    setError(null)
    try {
      await startGoogleConnect()
      // startGoogleConnect navigates the whole page away to Google — no
      // further state update happens here on success.
    } catch (err) {
      setConnecting(false)
      setError(toFriendlyErrorMessage(err, 'ไม่สามารถเริ่มเชื่อมต่อ Google ได้'))
    }
  }

  async function handleDisconnect() {
    try {
      await disconnectGoogleAccount()
      setStatus({ connected: false, email: null, scope: null, connectedAt: null })
      setDisconnectOpen(false)
      toast('ตัดการเชื่อมต่อบัญชี Google แล้ว')
    } catch (err) {
      toast(toFriendlyErrorMessage(err, 'ไม่สามารถตัดการเชื่อมต่อ Google ได้'))
    }
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Google Drive</CardTitle>
        <CardDescription>
          เชื่อมต่อบัญชี Google ของคุณเพื่อเลือกไฟล์ (PDF, Google เอกสาร, Google สไลด์, รูปภาพ ฯลฯ) จาก Google Drive
          เมื่อเพิ่มสื่อการสอนหรือใบงาน — แอปนี้จะเข้าถึงเฉพาะไฟล์ที่คุณเลือกด้วยตนเองเท่านั้น ไม่สามารถดูหรือแก้ไขไฟล์อื่นใน Drive ของคุณได้
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {state === 'loading' && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            กำลังตรวจสอบสถานะการเชื่อมต่อ...
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {state !== 'loading' && status?.connected && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-md border bg-success/5 px-3 py-2.5 text-sm">
              <CheckCircle2 className="size-4 shrink-0 text-success" />
              <div>
                <p className="font-medium">เชื่อมต่อแล้ว</p>
                <p className="text-muted-foreground">
                  บัญชี: {status.email ?? 'ไม่ทราบอีเมล'}
                  {status.connectedAt && ` · เชื่อมต่อเมื่อ ${formatThaiDate(status.connectedAt)}`}
                </p>
              </div>
            </div>
            <Button type="button" variant="outline" onClick={() => setDisconnectOpen(true)}>
              ตัดการเชื่อมต่อ
            </Button>
          </div>
        )}

        {state !== 'loading' && status && !status.connected && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">ยังไม่ได้เชื่อมต่อบัญชี Google</p>
            <Button type="button" onClick={handleConnect} disabled={connecting}>
              {connecting ? 'กำลังเชื่อมต่อ...' : 'เชื่อมต่อ Google Drive'}
            </Button>
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title="ตัดการเชื่อมต่อ Google Drive?"
        description="คุณจะไม่สามารถเลือกไฟล์จาก Google Drive ได้จนกว่าจะเชื่อมต่อใหม่อีกครั้ง สื่อการสอน/ใบงานที่เพิ่มไปแล้วจะยังคงอยู่ตามปกติ"
        confirmLabel="ตัดการเชื่อมต่อ"
        destructive
        onConfirm={handleDisconnect}
      />
    </Card>
  )
}
