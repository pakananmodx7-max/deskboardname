# Supabase setup

This project talks to Supabase for classroom/student data. Nothing in
the app will work end-to-end until you complete these steps — but the
app itself will still load and show a clear "not configured" message if
you skip this.

No real credentials are included anywhere in this repo. You must
provide your own.

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in.
2. Click **New project**.
3. Pick an organization, name, database password, and region.
4. Wait for provisioning to finish (a couple of minutes).

## 2. Copy the project URL

In your project dashboard: **Project Settings → API → Project URL**.
It looks like `https://xxxxxxxxxxxx.supabase.co`.

## 3. Copy the anon (public) key

Same page: **Project Settings → API → Project API keys → `anon`
`public`**.

⚠️ Only ever use the **anon** key in this app. Never copy the
`service_role` key into the client — it bypasses Row Level Security
entirely.

## 4. Create `.env.local`

Copy the example file and fill in the two values from steps 2–3:

```bash
cp .env.example .env.local
```

```bash
# .env.local
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

`.env.local` is already git-ignored (see `.gitignore`'s `*.local`
pattern) — it will not be committed.

Restart `npm run dev` after creating or changing this file (Vite only
reads env files at server start).

## 5. Run the SQL migration

In the Supabase dashboard: **SQL Editor → New query**, paste the full
contents of `supabase/migrations/0001_init.sql`, and run it. This
creates the `profiles`, `classrooms`, `students`, and
`classroom_students` tables with RLS enabled and the policies described
in `docs/DATABASE.md`.

(If you use the Supabase CLI locally instead, `supabase db push` or
`supabase migration up` against this file works the same way.)

## 6. Create a teacher user to test with

There is no login page in this phase of the app yet, but the schema's
RLS policies require an authenticated user (`auth.uid()`) for every
classroom/student operation. To test manually before auth is wired up:

1. **Authentication → Users → Add user** in the Supabase dashboard,
   create a test user (email + password).
2. In **SQL Editor**, insert a matching profile row so the RLS insert
   policies on `classrooms`/`students` recognize this user as a
   teacher:

   ```sql
   insert into public.profiles (id, display_name, email, role)
   values ('<the-user-id-from-step-1>', 'ครูทดสอบ', 'teacher@example.com', 'teacher');
   ```
3. Use the Supabase JS client to sign in as that user (e.g. temporarily
   call `supabase.auth.signInWithPassword(...)` from the browser
   console on the running app) before exercising the Students/Classrooms
   UI.

A real login page is the natural next step — see the final report's
recommended next step.

## Testing the connection

With `.env.local` set and the migration applied:

1. Run `npm run dev`.
2. Open the app and go to **Students**.
3. If Supabase isn't configured, you'll see a "ยังไม่ได้ตั้งค่าการเชื่อมต่อ
   Supabase" notice instead of a crash — that confirms the app degrades
   gracefully.
4. Once configured (and signed in as a teacher per step 6 above), the
   page will either show "ยังไม่มีห้องเรียน" (no classrooms yet) or your
   real classroom list — confirming the connection works.
