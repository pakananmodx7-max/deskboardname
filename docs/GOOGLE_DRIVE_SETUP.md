# Google Drive API Integration — Setup

This app lets a teacher connect their own Google account and pick a file
directly from Google Drive when adding a lesson/assignment resource. This
document is the manual, one-time setup a project owner performs in Google
Cloud Console and in the Supabase project — none of it is done
automatically by the application code, and none of these steps have been
run yet.

Supabase remains the primary database for everything academic. Google
Drive is only ever an external file provider: the file's bytes never
leave Google, this app stores only `provider`, `drive_file_id`, `title`,
`mime_type`, and the file's own `url` (see
`supabase/migrations/0018_google_drive_integration.sql`).

## 1. Apply the database migration

`supabase/migrations/0018_google_drive_integration.sql` has **not** been
applied to any live database yet. Review it, then apply it the same way
every prior migration in this project has been applied (e.g. via the
Supabase SQL editor or your usual migration tool). It adds two columns
(`lesson_resources.drive_file_id`, `assignment_resources.drive_file_id`)
and two new tables (`google_oauth_connections`, `google_oauth_states`),
both with Row Level Security enabled and zero policies for `anon`/
`authenticated` — see the migration's own SECURITY MODEL comment for why.

## 2. Create the Google Cloud OAuth client

1. In [Google Cloud Console](https://console.cloud.google.com/), create
   (or reuse) a project for this app.
2. **APIs & Services → Library** — enable the **Google Drive API** and
   the **Google Picker API**.
3. **APIs & Services → OAuth consent screen** — configure it (External
   user type unless every teacher is in your own Google Workspace
   organization). Add the scopes this app requests:
   - `.../auth/drive.file` (least-privilege — access only to files a
     teacher explicitly picks through this app, never their whole
     Drive)
   - `openid`
   - `.../auth/userinfo.email`
4. **APIs & Services → Credentials → Create Credentials → OAuth client
   ID**, type **Web application**.
   - **Authorized redirect URIs**: add
     `https://<your-app-domain>/teacher/integrations` — this must be
     **byte-for-byte identical** to the value you set as
     `GOOGLE_OAUTH_REDIRECT_URI` below (OAuth spec requirement). Add one
     entry per environment you run (e.g. also
     `http://localhost:5173/teacher/integrations` for local dev).
   - Save the generated **Client ID** and **Client secret**.
5. **APIs & Services → Credentials → Create Credentials → API key** —
   this is a *different* kind of credential, used only by the Picker
   widget in the browser (never for the OAuth flow itself). Restrict it:
   **Application restrictions → HTTP referrers**, and list your app's
   exact origin(s) (e.g. `https://your-app.vercel.app/*`). Restrict
   **API restrictions** to just the Google Picker API.

## 3. Configure Supabase Edge Function secrets

Deploy the five functions under `supabase/functions/` (`google-oauth-
start`, `google-oauth-callback`, `google-drive-access-token`,
`google-oauth-disconnect`, `google-oauth-status`) with your usual
Supabase CLI/deploy workflow — they have not been deployed yet. Then set
these secrets on the Supabase project (Project Settings → Edge Functions
→ Secrets, or `supabase secrets set`):

| Secret | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | The OAuth client ID from step 2 |
| `GOOGLE_CLIENT_SECRET` | The OAuth client secret from step 2 — never shared with the browser |
| `GOOGLE_OAUTH_REDIRECT_URI` | Byte-identical to the redirect URI registered in step 2, e.g. `https://your-app.vercel.app/teacher/integrations` |
| `ALLOWED_ORIGIN` | Your app's exact origin, e.g. `https://your-app.vercel.app` (used only for the functions' CORS headers) |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are already injected
automatically into every Edge Function's runtime — do not set them
yourself.

## 4. Configure the frontend build

Add to your `.env` (or your host's environment variables — see
`.env.example`):

```
VITE_GOOGLE_API_KEY=<the API key from step 2>
```

This key is public by design (restricted by HTTP referrer, not secret) —
it is the only Google-related value that reaches the browser. The OAuth
client ID/secret and every Drive access/refresh token stay server-side in
the Edge Functions and the `google_oauth_connections` table.

## 5. Verify

1. As a teacher, open **การเชื่อมต่อระบบ** (Integrations,
   `/teacher/integrations`) and click **เชื่อมต่อ Google Drive** — you
   should land on Google's consent screen, then be redirected back with
   "เชื่อมต่อบัญชี Google สำเร็จแล้ว".
2. Open a lesson or assignment's resource section and click **เลือกจาก
   Google Drive** — the Picker should open and let you choose a file.
3. Click **ตัดการเชื่อมต่อ** on the Integrations page — the stored
   connection should be removed and picking a file should once again
   require reconnecting.

If step 1 fails with a Google error about a redirect URI mismatch, the
`GOOGLE_OAUTH_REDIRECT_URI` secret does not exactly match what's
registered in Google Cloud Console (including scheme, trailing slash,
and path) — fix one to match the other.
