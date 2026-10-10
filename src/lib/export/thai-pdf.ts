import type { Content, ContextPageSize, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces'

import sarabunBoldUrl from '@/assets/fonts/sarabun/Sarabun-Bold.ttf?url'
import sarabunRegularUrl from '@/assets/fonts/sarabun/Sarabun-Regular.ttf?url'

/**
 * Shared building blocks for the school-report PDFs (missing assignments,
 * attendance…): a real PDF, not a screenshot — selectable/searchable text,
 * the Thai font embedded, A4 with 20 mm margins, numbered pages.
 *
 * Font: Sarabun (SIL Open Font License, see src/assets/fonts/sarabun/
 * OFL.txt) — the open release of the TH Sarabun design, freely
 * embeddable. Sarabun is drawn larger than TH Sarabun New, so 12 pt here
 * reads like TH Sarabun New 16 pt (the Word exports use TH Sarabun New
 * 16 pt itself).
 *
 * Thai has no spaces between words, so text is split into words with
 * Intl.Segmenter and handed to pdfmake as separate pieces — that is what
 * lets long Thai lines wrap at word boundaries instead of overflowing.
 */

export const PDF_FONT = 'Sarabun'
export const PDF_BODY_SIZE = 12
/** 20 mm in PDF points. */
export const PDF_MARGIN = (20 / 25.4) * 72

const wordSegmenter: Intl.Segmenter | null = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('th', { granularity: 'word' }) : null

/** Splits text into word pieces (keeps every character, in order). */
export function segmentWords(text: string): string[] {
  if (!wordSegmenter || !/[฀-๿]/.test(text)) return [text]
  const parts: string[] = []
  for (const { segment, isWordLike } of wordSegmenter.segment(text)) {
    const prev = parts[parts.length - 1]
    // Spaces/punctuation stay attached to the word before them (no line
    // may start with "." or a space), and nothing breaks after a
    // non-breaking space — so "13 ก.ย. 2569" stays whole.
    if (prev !== undefined && (!isWordLike || prev.endsWith(' '))) parts[parts.length - 1] = prev + segment
    else parts.push(segment)
  }
  return parts
}

/** Non-breaking spaces so a date ("13 ก.ย. 2569") never wraps mid-way. */
export function keepTogether(text: string): string {
  return text.replace(/ /g, ' ')
}

/** A text node whose Thai words can wrap. */
export function th(text: string, style: Record<string, unknown> = {}): Content {
  const parts = segmentWords(text)
  return parts.length === 1 ? { text, ...style } : { text: parts.map((p) => ({ text: p })), ...style }
}

export function headerCell(text: string, alignment: 'left' | 'center' = 'center'): TableCell {
  return { ...(th(text) as object), bold: true, fillColor: '#E7E7E7', alignment } as TableCell
}

export function bodyCell(text: string, opts: { alignment?: 'left' | 'center' | 'right'; bold?: boolean; colSpan?: number } = {}): TableCell {
  return { ...(th(text) as object), alignment: opts.alignment ?? 'left', bold: opts.bold, colSpan: opts.colSpan } as TableCell
}

/** Black-and-white friendly grid. */
export const GRID_LAYOUT = {
  hLineWidth: () => 0.6,
  vLineWidth: () => 0.6,
  hLineColor: () => '#000000',
  vLineColor: () => '#000000',
  paddingLeft: () => 4,
  paddingRight: () => 4,
  paddingTop: () => 2,
  paddingBottom: () => 2,
}

/** "ลงชื่อ … ผู้รายงาน / (name) / ตำแหน่ง ครูผู้สอน" — the teacher's
 * profile name when known, otherwise a blank line (never invented). */
export function signatureBlock(teacherName: string | null): Content {
  return {
    unbreakable: true,
    margin: [0, 36, 0, 0],
    columns: [
      { width: '*', text: '' },
      {
        width: 'auto',
        alignment: 'center',
        stack: [
          th('ลงชื่อ ................................................ ผู้รายงาน'),
          th(teacherName ? `(${teacherName})` : '(................................................)', { margin: [0, 6, 0, 0] }),
          th('ตำแหน่ง ครูผู้สอน', { margin: [0, 6, 0, 0] }),
        ],
      },
    ],
  }
}

/** Page setup shared by every report: A4, 20 mm margins, page numbers. */
export function a4Document(input: { title: string; orientation?: 'portrait' | 'landscape'; fontSize?: number; content: Content[] }): TDocumentDefinitions {
  return {
    pageSize: 'A4',
    pageOrientation: input.orientation ?? 'portrait',
    pageMargins: [PDF_MARGIN, PDF_MARGIN, PDF_MARGIN, PDF_MARGIN],
    info: { title: input.title, creator: 'KrunameClass', producer: 'KrunameClass' },
    defaultStyle: { font: PDF_FONT, fontSize: input.fontSize ?? PDF_BODY_SIZE, lineHeight: 1.15 },
    footer: (currentPage: number, pageCount: number) => ({ text: `หน้า ${currentPage} / ${pageCount}`, alignment: 'center', fontSize: 10, margin: [0, 24, 0, 0] }),
    content: input.content,
  }
}

/** Horizontal rule across the printable width. */
export function ruleLine(pageSize: ContextPageSize | 'portrait' | 'landscape' = 'portrait'): Content {
  const width = (pageSize === 'landscape' ? 841.89 : 595.28) - PDF_MARGIN * 2
  return { canvas: [{ type: 'line', x1: 0, y1: 6, x2: width, y2: 6, lineWidth: 0.6 }], margin: [0, 0, 0, 10] }
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

async function fetchFont(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('โหลดฟอนต์สำหรับ PDF ไม่สำเร็จ')
  return toBase64(await response.arrayBuffer())
}

interface PdfMakeApi {
  addVirtualFileSystem: (vfs: Record<string, string>) => void
  addFonts: (fonts: Record<string, Record<string, string>>) => void
  setUrlAccessPolicy: (callback: (url: string) => boolean) => void
  createPdf: (definition: TDocumentDefinitions) => { getBlob: () => Promise<Blob> }
}

let pdfMakeReady: Promise<PdfMakeApi> | null = null

/** pdfmake + the embedded Sarabun font, loaded once on first use. */
async function loadPdfMake(): Promise<PdfMakeApi> {
  pdfMakeReady ??= (async () => {
    const mod = (await import('pdfmake/build/pdfmake')) as unknown as { default?: { default?: PdfMakeApi } & PdfMakeApi } & PdfMakeApi
    const pdfMake = (mod.default?.default ?? mod.default ?? mod) as PdfMakeApi
    const [regular, bold] = await Promise.all([fetchFont(sarabunRegularUrl), fetchFont(sarabunBoldUrl)])
    pdfMake.addVirtualFileSystem({ 'Sarabun-Regular.ttf': regular, 'Sarabun-Bold.ttf': bold })
    pdfMake.addFonts({ [PDF_FONT]: { normal: 'Sarabun-Regular.ttf', bold: 'Sarabun-Bold.ttf', italics: 'Sarabun-Regular.ttf', bolditalics: 'Sarabun-Bold.ttf' } })
    // Reports never load remote resources (no images/URLs).
    pdfMake.setUrlAccessPolicy(() => false)
    return pdfMake
  })().catch((err: unknown) => {
    pdfMakeReady = null
    throw err
  })
  return pdfMakeReady
}

export async function createPdfBlob(definition: TDocumentDefinitions): Promise<Blob> {
  const pdfMake = await loadPdfMake()
  return pdfMake.createPdf(definition).getBlob()
}
