import JSZip from 'jszip'

/** One file to place at the root of a downloadable ZIP archive. */
export interface ZipFileEntry {
  filename: string
  content: string
}

/** Bundles flat files into a ZIP Blob — no folders, matching BackupCsvFile's
 * "filename never contains a path separator" guarantee. */
export async function buildZip(files: ZipFileEntry[]): Promise<Blob> {
  const zip = new JSZip()
  for (const file of files) {
    zip.file(file.filename, file.content)
  }
  return zip.generateAsync({ type: 'blob' })
}

/** Triggers a browser download of an already-built Blob. Mirrors
 * downloadCsv()'s Blob/URL.createObjectURL pattern in csv-export.ts. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
