import type { ExportTable } from '@/lib/export/export-table'

function escapeHtml(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * PDF export is implemented as "open a printable HTML view, then invoke
 * the browser's own print dialog" rather than generating a PDF binary
 * client-side (e.g. via jsPDF). Every client-side PDF library's built-in
 * fonts are Latin-only — rendering Thai text would require embedding a
 * Thai-capable font file (several hundred KB, non-trivial conversion
 * step) just to avoid blank boxes where every Thai character should be.
 * The browser's native "Print > Save as PDF" instead renders this HTML
 * with the browser's OWN font stack, which already handles Thai
 * correctly with zero embedding — the teacher picks "Save as PDF" (or
 * an actual printer) from the standard print dialog that opens.
 */
export function openPrintablePdf(table: ExportTable): void {
  const printWindow = window.open('', '_blank')
  if (!printWindow) {
    throw new Error('เบราว์เซอร์บล็อกหน้าต่างสำหรับพิมพ์ PDF กรุณาอนุญาตป๊อปอัปแล้วลองอีกครั้ง')
  }

  const headerCells = table.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')
  const bodyRows = table.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('')

  printWindow.document.write(`<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(table.title)}</title>
<style>
  body { font-family: "Noto Sans Thai", "Leelawadee UI", Tahoma, sans-serif; margin: 32px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.subtitle { font-size: 12px; color: #555; margin: 0 0 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
  th { background: #f2f2f2; }
  @media print {
    body { margin: 12mm; }
  }
</style>
</head>
<body>
  <h1>${escapeHtml(table.title)}</h1>
  <p class="subtitle">${escapeHtml(table.subtitle)}</p>
  <table>
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
</body>
</html>`)
  printWindow.document.close()
  printWindow.focus()
  printWindow.onload = () => printWindow.print()
  // Some browsers never fire a reliable load event for a document.write'd
  // window — fall back to printing shortly after write regardless.
  setTimeout(() => printWindow.print(), 300)
}
