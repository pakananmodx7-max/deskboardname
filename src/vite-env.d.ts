/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  /** Public, HTTP-referrer-restricted Google API key for the Drive
   * Picker widget only (Google Drive API Integration) — never a secret,
   * safe to ship in the client bundle. See google-picker.ts. */
  readonly VITE_GOOGLE_API_KEY?: string
  /** The Google Cloud project's numeric project number (NOT the project
   * ID, OAuth client ID, or API key) — required by Google Picker's
   * setAppId() since Google added this requirement for Picker sessions
   * using the drive.file scope. Not a secret; safe to ship in the
   * client bundle. See google-picker.ts. */
  readonly VITE_GOOGLE_APP_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
