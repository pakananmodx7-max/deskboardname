/**
 * Downloads any JSON-serializable value as a local file — used only for
 * the SGS Bridge payload (see sgs-export-dialog.tsx). This never sends
 * anything over the network; the file is handed to the SGS Bridge
 * Chrome extension by the teacher manually loading it in the
 * extension's own popup, which is the deliberate "safe" hand-off this
 * prototype phase uses instead of any direct page-to-extension
 * messaging channel.
 */
export function downloadJson(value: unknown, filename: string): void {
  const content = JSON.stringify(value, null, 2)
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.json') ? filename : `${filename}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
