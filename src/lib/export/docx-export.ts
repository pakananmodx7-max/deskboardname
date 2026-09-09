import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'

import type { ExportTable } from '@/lib/export/export-table'

function headerCell(text: string): TableCell {
  return new TableCell({
    width: { size: 100, type: WidthType.AUTO },
    children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })],
  })
}

function dataCell(value: string | number): TableCell {
  return new TableCell({ children: [new Paragraph(String(value))] })
}

/**
 * Word/LibreOffice both perform automatic font substitution for glyphs
 * missing from whatever font a run specifies (Thai text included) — this
 * deliberately does NOT pin a specific font, since doing so risks
 * pinning one that DOESN'T cover Thai on some systems and defeats that
 * substitution. Raw Unicode text is stored either way, so the document
 * itself is never lossy regardless of which font eventually renders it.
 */
export async function downloadDocx(table: ExportTable, filename: string): Promise<void> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: table.title, heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: table.subtitle }),
          new Paragraph({ text: '' }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ children: table.headers.map(headerCell) }),
              ...table.rows.map((row) => new TableRow({ children: row.map(dataCell) })),
            ],
          }),
        ],
      },
    ],
  })

  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.docx') ? filename : `${filename}.docx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
