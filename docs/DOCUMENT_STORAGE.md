# Document storage on Google Drive (ระบบเอกสาร — Phase 2)

KrunameClass stores the teacher's documents in a dedicated **“KrunameClass”**
folder on the teacher's own Google Drive. The teacher uploads, browses,
previews, downloads, renames, deletes and creates folders entirely inside
the Document Center (`/teacher/documents` → tab **ใน Google Drive**); they
never need to open Google Drive.

Nothing in this document has been run against production. Every step below
is a manual step for the project owner.

## How it works

```
Browser (Document Center)
  │  supabase.functions.invoke('google-drive-files', …)   ← Supabase session JWT
  ▼
Edge Function google-drive-files
  1. verifies the Supabase session (auth.getUser) — never a client-sent id
  2. requires profiles.role = teacher/admin
  3. reads the teacher's Google tokens from google_oauth_connections
     (service role; table has no client policies — migration 0018),
     refreshing the access token server-side when needed
  4. calls the Google Drive v3 API
  ▼
Google Drive: My Drive / KrunameClass / …
```

- **Tokens never reach the browser.** The new function returns file data
  and metadata only. (The existing `google-drive-access-token` function,
  used by the Google Picker, is unchanged.)
- **Least privilege — no new scope.** Everything uses the
  `https://www.googleapis.com/auth/drive.file` scope the integration already
  requests. With it the app can only see files it created (or that the
  teacher picked with the Picker) — never the rest of the teacher's Drive.
  The function checks the stored scope on every call and asks the teacher
  to reconnect if Drive access was not granted.
- **Ownership markers.** Every folder/file the app creates carries private
  `appProperties` (`kc_app`, `kc_teacher`, `kc_role`) visible only to this
  OAuth client. Every rename/delete/download re-reads the item and refuses
  anything that is not this teacher's KrunameClass item — files attached
  with the Picker can never be renamed or deleted from the Document Center.
- **Delete = move to Google Drive trash** (recoverable there for 30 days).
  Nothing is permanently deleted.
- **No new database objects.** Google Drive is the source of truth; the
  KrunameClass folder is found through its markers. No table, column or
  migration was added.
- **The folder is created lazily** — on the first upload or folder
  creation, never just by opening the page.
- **Limits:** 10 MB per upload (the file passes through the Edge Function);
  allowed types: PDF, Word, Excel, PowerPoint, OpenDocument, RTF, TXT, CSV,
  PNG/JPG/GIF/WebP, MP3/M4A, MP4, ZIP. The stored MIME type comes from the
  extension allowlist, not from the browser.
- **Files put into the KrunameClass folder from the Google Drive website do
  not appear** in KrunameClass (that is what `drive.file` means). Upload
  through KrunameClass instead.

## 1. Prerequisites (from the existing Google Drive integration)

These are the steps in `docs/GOOGLE_DRIVE_SETUP.md`; if the Google Picker
already works in production they are done.

1. Migration `supabase/migrations/0018_google_drive_integration.sql` is
   applied (`google_oauth_connections`, `google_oauth_states`).
2. The OAuth client exists and the existing functions are deployed:
   `google-oauth-start`, `google-oauth-callback`, `google-oauth-status`,
   `google-oauth-disconnect`, `google-drive-access-token`.
3. The teacher has connected Google on **การเชื่อมต่อระบบ**
   (`/teacher/integrations`).

## 2. Google Cloud Console (manual)

1. **APIs & Services → Library → Google Drive API → Enable** (already
   needed for the Picker — confirm it is enabled).
2. **OAuth consent screen → Scopes**: confirm
   `.../auth/drive.file`, `openid`, `.../auth/userinfo.email` are listed.
   **Do not add** `drive`, `drive.readonly` or `drive.metadata*` — they are
   not needed.
3. **Publishing status — important for a personal Gmail account.** While
   the app is in **Testing**, Google expires refresh tokens after 7 days,
   so the teacher would have to reconnect every week. Either:
   - keep **Testing**, add the teacher's Gmail under **Test users**, and
     accept reconnecting weekly; or
   - **Publish app** (In production). `drive.file` is one of Google's
     non-sensitive scopes; check the console's current requirements for
     verification/branding before publishing.
4. No new OAuth client, API key or redirect URI is needed.

## 3. Supabase (manual)

1. Deploy the new function (review the code first):
   ```
   supabase functions deploy google-drive-files
   ```
   Keep JWT verification on (the default); the function also verifies the
   session itself.
2. Secrets — **no new secrets**. The function uses the ones the existing
   integration already requires:

   | Name | Purpose |
   |---|---|
   | `GOOGLE_CLIENT_ID` | OAuth client (refreshing access tokens) |
   | `GOOGLE_CLIENT_SECRET` | OAuth client secret — server only |
   | `GOOGLE_OAUTH_REDIRECT_URI` | Required by the shared Google helper |
   | `ALLOWED_ORIGIN` | CORS origin of the app |
   | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Injected automatically by Supabase — do not set |

3. Frontend — **no new environment variables** (the existing
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
   `VITE_GOOGLE_API_KEY`, `VITE_GOOGLE_APP_ID` are unchanged).
4. Migrations — **none required** for this phase.

## 4. Verify before relying on it

1. Sign in as the teacher → **ระบบเอกสาร** → tab **ใน Google Drive**.
   Expected: “ยังไม่มีโฟลเดอร์ KrunameClass ใน Google Drive”.
2. **โฟลเดอร์ใหม่** → “งานวิชาการ”. In Google Drive, a `KrunameClass`
   folder with `งานวิชาการ` inside should now exist.
3. Open the folder → **อัปโหลดไฟล์** → a small PDF. It appears in the list
   and in Google Drive.
4. Preview (eye icon) shows the PDF inside KrunameClass; download saves it.
5. Rename it, then delete it → it moves to Google Drive's trash.
6. The **พื้นที่จัดเก็บ** card shows the account's real usage.
7. Disconnect Google on `/teacher/integrations` → the tab shows
   “ยังไม่ได้เชื่อมต่อ Google Drive”; reconnect → files are back.

If the tab says **“ระบบจัดเก็บบน Google Drive ยังไม่พร้อม”**, the function is
not deployed or a secret is missing. **“สิทธิ์ Google Drive ไม่ครบ”** means
the teacher unticked Drive access on Google's consent screen — reconnect and
allow it.

## Before production deployment — checklist

- [ ] Review `supabase/functions/google-drive-files/index.ts`,
      `supabase/functions/_shared/drive-storage.ts`,
      `supabase/functions/_shared/google-token.ts`.
- [ ] Prerequisites in section 1 are in place (0018 applied, OAuth working).
- [ ] Drive API enabled; scopes unchanged; publishing status decided (§2.3).
- [ ] `supabase functions deploy google-drive-files`.
- [ ] `ALLOWED_ORIGIN` set to the production origin.
- [ ] Run the verification in section 4 with the teacher's real account.
- [ ] Deploy the frontend build as usual (no new env vars).

Code: `src/features/document-center/` (UI), `src/services/drive-storage-service.ts`
(browser), `supabase/functions/google-drive-files/` + `_shared/drive-storage.ts`
(server). Tests: `src/services/drive-storage-core.test.ts`,
`src/features/document-center/drive-storage-ui.test.ts`.
