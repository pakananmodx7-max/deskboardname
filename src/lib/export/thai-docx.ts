import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TextRun,
  WidthType,
  type IParagraphOptions,
} from 'docx'

/**
 * Shared building blocks for the editable Word reports — real text and
 * real Word tables, never images. A4 (11906 × 16838 twips), 20 mm margins
 * (1134 twips), TH Sarabun New 16 pt (the standard Thai school-document
 * font; Word substitutes another Thai font if it is not installed — the
 * text is plain Unicode, never lossy), page numbers in the footer.
 */

export const DOCX_FONT = 'TH Sarabun New'
export const DOCX_SIZE = 32 // half-points → 16 pt
const MM_20 = 1134
const FONT = { ascii: DOCX_FONT, hAnsi: DOCX_FONT, cs: DOCX_FONT, eastAsia: DOCX_FONT }

export type DocxAlign = (typeof AlignmentType)[keyof typeof AlignmentType]
export { AlignmentType }

export function run(text: string, opts: { bold?: boolean; size?: number } = {}): TextRun {
  return new TextRun({ text, bold: opts.bold, boldComplexScript: opts.bold, font: FONT, size: opts.size ?? DOCX_SIZE, sizeComplexScript: opts.size ?? DOCX_SIZE })
}

export function para(text: string, opts: Omit<IParagraphOptions, 'children' | 'text'> & { bold?: boolean; size?: number } = {}): Paragraph {
  const { bold, size, ...rest } = opts
  return new Paragraph({ spacing: { after: 0 }, ...rest, children: [run(text, { bold, size })] })
}

const THIN = { style: BorderStyle.SINGLE, size: 4, color: '000000' }
const BORDERS = { top: THIN, bottom: THIN, left: THIN, right: THIN }

export function cell(
  text: string,
  opts: { bold?: boolean; header?: boolean; align?: DocxAlign; width?: number; span?: number; size?: number; shade?: boolean } = {},
): TableCell {
  return new TableCell({
    borders: BORDERS,
    columnSpan: opts.span,
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.header || opts.shade ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.header ? 'E7E7E7' : 'F5F5F5' } : undefined,
    margins: { left: 80, right: 80, top: 20, bottom: 20 },
    children: [para(text, { bold: opts.bold || opts.header, alignment: opts.align ?? AlignmentType.LEFT, size: opts.size })],
  })
}

/** "ลงชื่อ … ผู้รายงาน / (name) / ตำแหน่ง ครูผู้สอน" — the profile name
 * when known, otherwise a blank line (never invented). */
export function signatureParagraphs(teacherName: string | null): Paragraph[] {
  return [
    para('', {}),
    para('', {}),
    para('ลงชื่อ ................................................ ผู้รายงาน', { alignment: AlignmentType.RIGHT, keepNext: true, keepLines: true }),
    para(teacherName ? `(${teacherName})` : '(................................................)', { alignment: AlignmentType.RIGHT, keepNext: true, keepLines: true }),
    para('ตำแหน่ง ครูผู้สอน', { alignment: AlignmentType.RIGHT }),
  ]
}

export function a4WordDocument(input: { title: string; orientation?: 'portrait' | 'landscape'; children: (Paragraph | Table)[] }): Document {
  const landscape = input.orientation === 'landscape'
  return new Document({
    creator: 'KrunameClass',
    title: input.title,
    styles: { default: { document: { run: { font: FONT, size: DOCX_SIZE, sizeComplexScript: DOCX_SIZE } } } },
    sections: [
      {
        properties: {
          page: {
            // docx swaps width/height itself for landscape.
            size: { width: 11906, height: 16838, orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
            margin: { top: MM_20, bottom: MM_20, left: MM_20, right: MM_20, footer: 567 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ font: FONT, size: 28, sizeComplexScript: 28, children: ['หน้า ', PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES] })],
              }),
            ],
          }),
        },
        children: input.children,
      },
    ],
  })
}
