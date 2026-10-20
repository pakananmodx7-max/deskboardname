/**
 * Printable student QR cards — pure HTML builders (tested without a
 * browser). Sizes are in millimetres so the printed QR is reliably
 * scannable: the payload is a version-5 QR (37 modules), so a 42 mm
 * code prints at ~1.1 mm per module.
 */

export interface QrCard {
  studentName: string
  classroomName: string
  number: number | null
  studentCode: string | null
  /** data: URL of the QR image. */
  qrDataUrl: string
}

export type QrPrintLayout = 'single' | 'sheet'

/** A4 sheet: 3 × 4 cards per page. */
export const CARDS_PER_SHEET = 12

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
}

function cardMeta(card: QrCard): string {
  const parts = [card.classroomName, card.number !== null ? `เลขที่ ${card.number}` : null, card.studentCode ? `รหัส ${card.studentCode}` : null].filter(Boolean)
  return parts.join(' · ')
}

function cardHtml(card: QrCard): string {
  return `<figure class="card">
  <img class="qr" src="${escapeHtml(card.qrDataUrl)}" alt="QR ${escapeHtml(card.studentName)}" />
  <figcaption>
    <strong>${escapeHtml(card.studentName)}</strong>
    <span>${escapeHtml(cardMeta(card))}</span>
  </figcaption>
</figure>`
}

const FONT_LINK = '<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;600;700&display=swap" />'

const STYLE = `
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: #111; }
  body { font-family: "Noto Sans Thai", "Sarabun", Tahoma, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { display: grid; grid-template-columns: repeat(3, 60mm); grid-auto-rows: 66mm; gap: 4mm 5mm; justify-content: center; }
  .card { margin: 0; border: 0.3mm dashed #9ca3af; border-radius: 3mm; padding: 4mm 3mm 3mm; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; break-inside: avoid; page-break-inside: avoid; }
  .sheet .qr { width: 42mm; height: 42mm; image-rendering: pixelated; }
  figcaption { margin-top: 2mm; text-align: center; line-height: 1.3; width: 100%; }
  figcaption strong { display: block; font-size: 11pt; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  figcaption span { display: block; font-size: 8.5pt; color: #374151; }
  .page-break { break-after: page; page-break-after: always; }
  .single { display: flex; justify-content: center; padding-top: 20mm; }
  .single .card { width: 90mm; padding: 8mm 6mm 6mm; border-style: solid; }
  .single .qr { width: 64mm; height: 64mm; image-rendering: pixelated; }
  .single figcaption strong { font-size: 15pt; }
  .single figcaption span { font-size: 11pt; }
  .footer { margin-top: 2mm; font-size: 7pt; color: #6b7280; text-align: center; }
`

/** A complete HTML document ready to print. */
export function buildQrPrintDocument(cards: QrCard[], layout: QrPrintLayout, title: string): string {
  let body: string
  if (layout === 'single') {
    body = `<main class="single">${cards.slice(0, 1).map(cardHtml).join('')}</main>`
  } else {
    const pages: string[] = []
    for (let i = 0; i < cards.length; i += CARDS_PER_SHEET) {
      const last = i + CARDS_PER_SHEET >= cards.length
      pages.push(`<section class="sheet${last ? '' : ' page-break'}">${cards.slice(i, i + CARDS_PER_SHEET).map(cardHtml).join('')}</section>`)
    }
    body = `<main>${pages.join('')}</main>`
  }
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
${FONT_LINK}
<style>${STYLE}</style>
</head>
<body>
${body}
<p class="footer">QR ประจำตัวนักเรียน — ใช้ได้ทุกภาคเรียน · หากบัตรหาย ให้ครูสร้าง QR ใหม่ (QR เดิมจะใช้ไม่ได้ทันที)</p>
</body>
</html>`
}

/** File name for a downloaded QR PNG (no characters a filesystem dislikes). */
export function qrPngFileName(card: Pick<QrCard, 'studentName' | 'classroomName' | 'number'>): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_').trim()
  return `QR_${safe(card.classroomName)}_${card.number ?? 'x'}_${safe(card.studentName)}.png`
}
