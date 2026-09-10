import { CheckCircle2, Loader2, Plug } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { toFriendlyErrorMessage } from '@/lib/errors'
import {
  completeGoogleConnect,
  disconnectGoogleAccount,
  getGoogleConnectionStatus,
  startGoogleConnect,
  type GoogleConnectionStatus,
} from '@/services/google-drive-service'

type LoadState = 'loading' | 'ready' | 'error'

function formatThaiDate(iso: string): string {
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Google Drive API Integration, Section 13: connect/reconnect/disconnect
 * controls for the teacher's own Google account. This page IS the OAuth
 * redirect_uri Google sends the browser back to (registered exactly as
 * `<origin>/teacher/integrations` in Google Cloud Console — see
 * docs/GOOGLE_DRIVE_SETUP.md) — on mount it checks its own URL for
 * `?code=&state=` left there by that redirect, completes the connect
 * flow if present, then strips those params from the URL so a page
 * refresh never re-submits the same one-time code.
 */
export function IntegrationsPage() {
  const { toast } = useToast()
  const navigate = useNavigate()

  const [state, setState] = useState<LoadState>('loading')
  const [status, setStatus] = useState<GoogleConnectionStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [disconnectOpen, setDisconnectOpen] = useState(false)

  useEffect(() => {
    let active = true

    async function run() {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      const oauthState = params.get('state')

      try {
        if (code && oauthState) {
          await completeGoogleConnect(code, oauthState)
          navigate('/teacher/integrations', { replace: true })
          if (active) toast('เชื่อมต่อบัญชี Google สำเร็จแล้ว')
        }
        const result = await getGoogleConnectionStatus()
        if (active) {
          setStatus(result)
          setState('ready')
        }
      } catch (err) {
        if (active) {
          setError(toFriendlyErrorMessage(err, 'ไม่สามารถโหลดสถานะการเชื่อมต่อ Google ได้'))
          setState('error')
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

      <Card>
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
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>เร็ว ๆ นี้</CardTitle>
          <CardDescription>Google Sheets API, LINE และ Hermes Agent จะพร้อมใช้งานในเฟสถัดไป</CardDescription>
        </CardHeader>
      </Card>

      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title="ตัดการเชื่อมต่อ Google Drive?"
        description="คุณจะไม่สามารถเลือกไฟล์จาก Google Drive ได้จนกว่าจะเชื่อมต่อใหม่อีกครั้ง สื่อการสอน/ใบงานที่เพิ่มไปแล้วจะยังคงอยู่ตามปกติ"
        confirmLabel="ตัดการเชื่อมต่อ"
        destructive
        onConfirm={handleDisconnect}
      />
    </div>
  )
}
