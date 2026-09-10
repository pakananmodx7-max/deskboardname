/**
 * Google Drive API Integration — thin wrapper around Google's Picker JS
 * library (https://developers.google.com/drive/picker/guides/overview).
 * The Picker itself runs entirely client-side; it never touches
 * Supabase. It needs two things, both already least-privilege by
 * construction: a short-lived Drive-scoped OAuth access_token (minted
 * server-side by the google-drive-access-token Edge Function — see
 * google-drive-service.ts — NEVER the refresh token or client secret),
 * and a public, HTTP-referrer-restricted Google API key
 * (VITE_GOOGLE_API_KEY) — the same kind of "safe to ship in a browser
 * bundle" key Google's own Picker quickstart uses, restricted in Google
 * Cloud Console to this app's origin(s) only.
 *
 * SECURITY NOTE on the `drive.file` scope (see
 * supabase/functions/_shared/google.ts's GOOGLE_SCOPES comment): Google
 * grants access to a file the moment the teacher picks it through this
 * exact Picker widget, even though the app's OAuth scope never included
 * broader Drive read access — this is Google's own documented behavior,
 * not something this app enforces itself. Nothing here ever bypasses or
 * changes the teacher's Drive sharing permissions; opening a picked
 * file later is still subject to Google's own permission model for
 * whoever opens it (see the Google Drive Permissions UX built in the
 * URL-paste-only Google Drive Integration Phase 1).
 */

const PICKER_API_SCRIPT_SRC = 'https://apis.google.com/js/api.js'

/**
 * The file types this app's teaching-resource picker allows selecting —
 * PDFs, Google Docs/Slides, images, and common office document formats.
 * Deliberately excludes Google Sheets (out of scope — "No Google Sheets
 * API in this phase") and folders (`setIncludeFolders` is never enabled
 * below) — a teacher picks individual files, never a whole folder tree.
 */
export const PICKER_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg',
  'image/png',
  'image/webp',
].join(',')

export interface PickedDriveFile {
  driveFileId: string
  name: string
  mimeType: string
  /** The file's Drive "open" URL — the same kind of URL a teacher would
   * otherwise copy/paste by hand (Phase 1's manual-link flow), so every
   * existing provider-detection/display code path (detectResourceProvider
   * et al.) handles a Picker-added resource identically to a pasted one. */
  url: string
}

// Minimal ambient shape for the pieces of the `gapi`/`google.picker`
// globals this module actually touches — avoids pulling in a full
// @types/gapi.* dependency for three method calls.
interface GapiGlobal {
  load: (api: string, callback: () => void) => void
}
interface PickerBuilder {
  addView: (view: unknown) => PickerBuilder
  setOAuthToken: (token: string) => PickerBuilder
  setDeveloperKey: (key: string) => PickerBuilder
  setAppId: (appId: string) => PickerBuilder
  setCallback: (callback: (data: PickerResponse) => void) => PickerBuilder
  build: () => { setVisible: (visible: boolean) => void }
}
interface DocsView {
  setMimeTypes: (mimeTypes: string) => DocsView
  setIncludeFolders: (include: boolean) => DocsView
  setSelectFolderEnabled: (enabled: boolean) => DocsView
}
interface PickerDoc {
  id: string
  name: string
  mimeType: string
  url?: string
}
interface PickerResponse {
  action: string
  docs?: PickerDoc[]
}
interface GooglePickerGlobal {
  picker: {
    PickerBuilder: new () => PickerBuilder
    DocsView: new () => DocsView
    Action: { PICKED: string; CANCEL: string }
  }
}

declare global {
  interface Window {
    gapi?: GapiGlobal
    google?: GooglePickerGlobal
  }
}

let loadPromise: Promise<void> | null = null

/** Loads Google's api.js script (once — cached across calls) and the
 * `picker` module it exposes. Safe to call every time a teacher opens
 * the picker; only the very first call actually hits the network. */
export function loadGooglePickerApi(): Promise<void> {
  if (window.google?.picker) return Promise.resolve()
  if (loadPromise) return loadPromise

  loadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PICKER_API_SCRIPT_SRC}"]`)
    const onScriptReady = () => {
      if (!window.gapi) {
        reject(new Error('ไม่สามารถโหลด Google API ได้'))
        return
      }
      window.gapi.load('picker', () => resolve())
    }

    if (existing) {
      onScriptReady()
      return
    }

    const script = document.createElement('script')
    script.src = PICKER_API_SCRIPT_SRC
    script.async = true
    script.onload = onScriptReady
    script.onerror = () => reject(new Error('ไม่สามารถโหลด Google API ได้'))
    document.head.appendChild(script)
  })

  return loadPromise
}

/**
 * Opens the Picker and resolves with the single file the teacher chose,
 * or null if they closed/canceled it — never throws for a cancel, only
 * for a genuine setup failure (missing API key/app id, script load
 * failure). `appId` is the Google Cloud project's NUMERIC project
 * number (not the project id, OAuth client id, or API key) — Google
 * requires it via setAppId() for a Picker session using the drive.file
 * scope; omitting it produces a generic 403 "you do not have access to
 * this page" response from Google when the picker opens, with every
 * other part of the flow (OAuth token, API key, scope) otherwise
 * correct. See google-drive-service.ts for where this value comes from.
 */
export function openGoogleDrivePicker(accessToken: string, apiKey: string, appId: string): Promise<PickedDriveFile | null> {
  return new Promise((resolve, reject) => {
    if (!window.google?.picker) {
      reject(new Error('Google Picker ยังไม่พร้อมใช้งาน'))
      return
    }

    const view = new window.google.picker.DocsView()
      .setMimeTypes(PICKER_ALLOWED_MIME_TYPES)
      .setIncludeFolders(false)
      .setSelectFolderEnabled(false)

    const picker = new window.google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(apiKey)
      .setAppId(appId)
      .setCallback((data: PickerResponse) => {
        if (data.action === window.google!.picker.Action.PICKED) {
          const doc = data.docs?.[0]
          if (!doc) {
            resolve(null)
            return
          }
          resolve({ driveFileId: doc.id, name: doc.name, mimeType: doc.mimeType, url: doc.url ?? '' })
        } else if (data.action === window.google!.picker.Action.CANCEL) {
          resolve(null)
        }
      })
      .build()

    picker.setVisible(true)
  })
}
