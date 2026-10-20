/** Camera scanning helpers (no React). */

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}

export type Decoder = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => Promise<string | null>

/** Thai message for a getUserMedia failure. */
export function cameraErrorMessage(error: unknown): string {
  const name = (error as { name?: string } | null)?.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'ไม่ได้รับอนุญาตให้ใช้กล้อง — อนุญาตการใช้กล้องในการตั้งค่าเบราว์เซอร์ หรือใช้เครื่องสแกน/บันทึกจากรายชื่อแทน'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'ไม่พบกล้องบนอุปกรณ์นี้ — ใช้เครื่องสแกน Bluetooth/USB หรือบันทึกจากรายชื่อแทน'
  if (name === 'NotReadableError' || name === 'AbortError') return 'เปิดกล้องไม่ได้ — กล้องอาจถูกใช้งานโดยแอปอื่นอยู่'
  if (name === 'unsupported') return 'เบราว์เซอร์นี้ไม่รองรับการใช้กล้อง (ต้องเปิดผ่าน HTTPS) — ใช้เครื่องสแกนหรือบันทึกจากรายชื่อแทน'
  return 'เปิดกล้องไม่สำเร็จ — ลองใหม่อีกครั้ง หรือใช้วิธีอื่น'
}

/** Native BarcodeDetector when it supports QR (fast on Android Chrome),
 * otherwise jsQR (loaded on demand). */
export async function createDecoder(): Promise<Decoder> {
  const Native = (window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): BarcodeDetectorLike; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector
  if (Native) {
    try {
      const formats = (await Native.getSupportedFormats?.()) ?? []
      if (formats.includes('qr_code')) {
        const detector = new Native({ formats: ['qr_code'] })
        return async (canvas) => (await detector.detect(canvas))[0]?.rawValue ?? null
      }
    } catch {
      // Fall through to jsQR.
    }
  }
  const { default: jsQR } = await import('jsqr')
  return async (canvas, ctx) => {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
    return jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })?.data ?? null
  }
}

