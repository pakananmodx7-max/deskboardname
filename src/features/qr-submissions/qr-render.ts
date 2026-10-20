import { buildQrPayload } from './qr-payload'
import { buildQrPrintDocument, qrPngFileName, type QrCard, type QrPrintLayout } from './qr-print-model'

/**
 * Browser-side QR rendering, PNG export and printing. The `qrcode`
 * library is loaded on demand so it never weighs on pages that don't
 * show a QR.
 */

/** QR image (data: URL) for a student's token. Error correction 'M' is
 * enough for a printed card and keeps the code small (version 5). */
export async function qrDataUrl(token: string, size = 512): Promise<string> {
  const QRCode = await import('qrcode')
  return QRCode.toDataURL(buildQrPayload(token), { errorCorrectionLevel: 'M', margin: 2, width: size, color: { dark: '#000000', light: '#ffffff' } })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('โหลดภาพ QR ไม่สำเร็จ'))
    img.src = src
  })
}

/** A PNG card: QR + name + classroom/number, white background (prints
 * and shares well even from dark mode). */
export async function downloadQrPng(card: QrCard): Promise<void> {
  const width = 640
  const height = 800
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('เบราว์เซอร์นี้สร้างไฟล์ภาพไม่ได้')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  const img = await loadImage(card.qrDataUrl)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, 60, 40, 520, 520)
  try {
    await document.fonts?.ready
  } catch {
    // Font loading API unavailable — the fallback font still renders Thai.
  }
  ctx.fillStyle = '#111111'
  ctx.textAlign = 'center'
  ctx.font = '700 38px "Noto Sans Thai", Tahoma, sans-serif'
  ctx.fillText(card.studentName, width / 2, 630, width - 40)
  ctx.fillStyle = '#374151'
  ctx.font = '400 28px "Noto Sans Thai", Tahoma, sans-serif'
  const meta = [card.classroomName, card.number !== null ? `เลขที่ ${card.number}` : null, card.studentCode ? `รหัส ${card.studentCode}` : null].filter(Boolean).join(' · ')
  ctx.fillText(meta, width / 2, 690, width - 40)
  ctx.fillStyle = '#6b7280'
  ctx.font = '400 20px "Noto Sans Thai", Tahoma, sans-serif'
  ctx.fillText('QR ประจำตัวนักเรียน · KrunameClass', width / 2, 750, width - 40)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('สร้างไฟล์ภาพไม่สำเร็จ')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = qrPngFileName(card)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Prints cards from a hidden iframe (no pop-up window needed). */
export async function printQrCards(cards: QrCard[], layout: QrPrintLayout, title: string): Promise<void> {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument
  const win = iframe.contentWindow
  if (!doc || !win) {
    iframe.remove()
    throw new Error('เบราว์เซอร์นี้พิมพ์ไม่ได้')
  }
  doc.open()
  doc.write(buildQrPrintDocument(cards, layout, title))
  doc.close()
  const images = [...doc.images]
  await Promise.all(images.map((img) => (img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r }))))
  try {
    await Promise.race([doc.fonts?.ready, new Promise((r) => setTimeout(r, 2500))])
  } catch {
    // Printing with the fallback font is fine.
  }
  win.focus()
  win.print()
  // Remove after the print dialog closes (afterprint is not universal).
  const cleanup = () => iframe.remove()
  win.addEventListener('afterprint', cleanup, { once: true })
  setTimeout(cleanup, 60_000)
}

export type { QrCard, QrPrintLayout }
