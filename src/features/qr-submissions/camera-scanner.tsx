import { Camera, CameraOff, Loader2, SwitchCamera } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { cameraErrorMessage, createDecoder } from './camera-support'

type CameraStatus =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'running' }
  | { kind: 'error'; message: string }

const SCAN_INTERVAL_MS = 140
const MAX_FRAME_WIDTH = 720

/**
 * Smartphone/webcam QR scanning. The camera is requested only when the
 * teacher taps "เปิดกล้อง" (never on load), prefers the rear camera, and
 * every track is stopped when the scanner closes, unmounts or the page
 * is hidden. While `paused` (a scan is being saved) frames are not
 * decoded, so one QR held in view is never submitted twice.
 */
export function CameraScanner({ paused, onDetected }: { paused: boolean; onDetected: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const pausedRef = useRef(paused)
  const onDetectedRef = useRef(onDetected)
  const [status, setStatus] = useState<CameraStatus>({ kind: 'idle' })
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceIndex, setDeviceIndex] = useState(-1)

  useEffect(() => {
    pausedRef.current = paused
    onDetectedRef.current = onDetected
  }, [paused, onDetected])

  const stop = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  // Release the camera on unmount and whenever the page is hidden.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && streamRef.current) {
        stop()
        setStatus({ kind: 'idle' })
      }
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      stop()
    }
  }, [stop])

  const start = useCallback(
    async (deviceId?: string) => {
      stop()
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus({ kind: 'error', message: cameraErrorMessage({ name: 'unsupported' }) })
        return
      }
      setStatus({ kind: 'starting' })
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        streamRef.current = stream
        const video = videoRef.current
        if (!video) {
          stop()
          return
        }
        video.srcObject = stream
        await video.play().catch(() => undefined)
        const all = (await navigator.mediaDevices.enumerateDevices?.()) ?? []
        const cams = all.filter((d) => d.kind === 'videoinput')
        setDevices(cams)
        const activeId = stream.getVideoTracks()[0]?.getSettings().deviceId
        setDeviceIndex(Math.max(0, cams.findIndex((d) => d.deviceId === activeId)))
        setStatus({ kind: 'running' })

        const decode = await createDecoder()
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        const tick = async () => {
          if (!streamRef.current || !ctx) return
          if (!pausedRef.current && video.readyState >= 2 && video.videoWidth > 0) {
            const scale = Math.min(1, MAX_FRAME_WIDTH / video.videoWidth)
            canvas.width = Math.round(video.videoWidth * scale)
            canvas.height = Math.round(video.videoHeight * scale)
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
            try {
              const text = await decode(canvas, ctx)
              if (text && !pausedRef.current) onDetectedRef.current(text)
            } catch {
              // A frame that fails to decode is simply skipped.
            }
          }
          if (streamRef.current) timerRef.current = window.setTimeout(tick, SCAN_INTERVAL_MS)
        }
        void tick()
      } catch (err) {
        stop()
        setStatus({ kind: 'error', message: cameraErrorMessage(err) })
      }
    },
    [stop],
  )

  const running = status.kind === 'running'
  const canSwitch = running && devices.length > 1

  return (
    <div className="space-y-3">
      <div className="relative mx-auto aspect-[4/3] w-full max-w-md overflow-hidden rounded-2xl bg-slate-900">
        <video ref={videoRef} playsInline muted className={cn('size-full object-cover', !running && 'invisible')} />
        {running && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className={cn('relative size-[62%] max-w-64 rounded-2xl border-2 transition-colors', paused ? 'border-amber-300/90' : 'border-white/90')}>
              <span className="absolute -left-0.5 -top-0.5 size-6 rounded-tl-2xl border-l-4 border-t-4 border-primary" />
              <span className="absolute -right-0.5 -top-0.5 size-6 rounded-tr-2xl border-r-4 border-t-4 border-primary" />
              <span className="absolute -bottom-0.5 -left-0.5 size-6 rounded-bl-2xl border-b-4 border-l-4 border-primary" />
              <span className="absolute -bottom-0.5 -right-0.5 size-6 rounded-br-2xl border-b-4 border-r-4 border-primary" />
            </div>
          </div>
        )}
        {!running && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-slate-100">
            {status.kind === 'starting' ? (
              <>
                <Loader2 className="size-7 animate-spin" />
                <p className="text-sm">กำลังเปิดกล้อง... (อนุญาตการใช้กล้องเมื่อเบราว์เซอร์ถาม)</p>
              </>
            ) : status.kind === 'error' ? (
              <>
                <CameraOff className="size-7 text-amber-300" />
                <p role="alert" className="text-sm">{status.message}</p>
                <Button type="button" size="sm" variant="secondary" onClick={() => void start()}>
                  ลองอีกครั้ง
                </Button>
              </>
            ) : (
              <>
                <Camera className="size-8" />
                <p className="text-sm">ใช้กล้องหลังของโทรศัพท์สแกน QR ประจำตัวนักเรียน</p>
                <Button type="button" onClick={() => void start()}>
                  <Camera className="size-4" />
                  เปิดกล้อง
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {running && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {paused ? 'กำลังบันทึก... หยุดอ่าน QR ชั่วคราว' : 'จ่อ QR ให้อยู่ในกรอบ — สแกนต่อเนื่องได้ทันที'}
          </p>
          {canSwitch && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                const next = (deviceIndex + 1) % devices.length
                void start(devices[next].deviceId)
              }}
            >
              <SwitchCamera className="size-4" />
              สลับกล้อง
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              stop()
              setStatus({ kind: 'idle' })
            }}
          >
            ปิดกล้อง
          </Button>
        </div>
      )}
    </div>
  )
}
