/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  /** Public, HTTP-referrer-restricted Google API key for the Drive
   * Picker widget only (Google Drive API Integration) — never a secret,
   * safe to ship in the client bundle. See google-picker.ts. */
  readonly VITE_GOOGLE_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
