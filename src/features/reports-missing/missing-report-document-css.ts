import sarabunBoldUrl from '@/assets/fonts/sarabun/Sarabun-Bold.ttf?url'
import sarabunRegularUrl from '@/assets/fonts/sarabun/Sarabun-Regular.ttf?url'

/**
 * The formal A4 document (print preview + browser printing). Same report
 * object as the screen and the PDF/Word exports. Paper is always white
 * with black text (black-and-white printing), whatever the app theme.
 *
 * Printing: A4 portrait, 20 mm margins (@page), page numbers in the page
 * footer, table headers repeat on every page (thead), rows and student
 * blocks avoid splitting across pages. Font: the bundled Sarabun (OFL),
 * the same face embedded in the PDF.
 */
export const MISSING_REPORT_DOCUMENT_CSS = `
@font-face { font-family: 'KC Sarabun'; src: url('${sarabunRegularUrl}') format('truetype'); font-weight: 400; font-display: swap; }
@font-face { font-family: 'KC Sarabun'; src: url('${sarabunBoldUrl}') format('truetype'); font-weight: 700; font-display: swap; }
@page { size: A4 portrait; margin: 20mm; @bottom-center { content: 'หน้า ' counter(page) ' / ' counter(pages); font-family: 'KC Sarabun', sans-serif; font-size: 10pt; } }
.kc-doc { font-family: 'KC Sarabun', 'TH Sarabun New', sans-serif; font-size: 12pt; line-height: 1.45; color: #000; background: #fff; }
.kc-doc h1 { font-size: 16pt; font-weight: 700; text-align: center; margin: 0; }
.kc-doc .kc-center { text-align: center; }
.kc-doc .kc-meta p { margin: 0; text-align: center; }
.kc-doc hr { border: 0; border-top: 0.6pt solid #000; margin: 8pt 0 10pt; }
.kc-doc h2 { font-size: 12pt; font-weight: 700; margin: 10pt 0 4pt; break-after: avoid; }
.kc-doc table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.kc-doc th, .kc-doc td { border: 0.6pt solid #000; padding: 2pt 4pt; vertical-align: top; overflow-wrap: anywhere; }
.kc-doc thead th { background: #e7e7e7; font-weight: 700; }
.kc-doc thead { display: table-header-group; }
.kc-doc tr { break-inside: avoid; page-break-inside: avoid; }
.kc-doc .kc-num { text-align: center; }
.kc-doc .kc-strong td { font-weight: 700; }
.kc-doc .kc-note { font-size: 10pt; margin: 2pt 0 0; }
.kc-doc .kc-student { break-inside: avoid; page-break-inside: avoid; margin-top: 6pt; }
.kc-doc .kc-student ol { margin: 0; padding-left: 22pt; }
.kc-doc .kc-signature { break-inside: avoid; page-break-inside: avoid; margin: 36pt 0 0 auto; width: fit-content; text-align: center; }
.kc-doc .kc-signature p { margin: 0 0 6pt; }
@media screen {
  .kc-sheet { width: 210mm; min-height: 297mm; padding: 20mm; box-sizing: border-box; margin: 0 auto; box-shadow: 0 2px 12px rgb(0 0 0 / 0.15); }
}
@media print {
  html, body { background: #fff !important; }
  .kc-sheet { width: auto; min-height: 0; padding: 0; box-shadow: none; }
  .kc-no-print { display: none !important; }
}
`

