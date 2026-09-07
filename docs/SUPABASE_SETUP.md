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

## 3. Copy the Publishable key

Same page: **Project Settings → API → Project API keys → `Publishable
key`** (this is the public, client-safe key — the newer Supabase
dashboards call it "Publishable key" where older projects call the
equivalent key "anon public").

⚠️ Only ever use the **Publishable** key in this app. Never copy the
`Secret key` (a.k.a. `service_role`) into the client — it bypasses Row
Level Security entirely.

## 4. Create `.env.local`

Copy the example file and fill in the two values from steps 2–3:

```bash
cp .env.example .env.local
```

```bash
# .env.local
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key-here
```

`.env.local` is already git-ignored (see `.gitignore`'s `*.local`
pattern) — it will not be committed.

Restart `npm run dev` after creating or changing this file (Vite only
reads env files at server start).

## 5. Run the SQL migrations

In the Supabase dashboard: **SQL Editor → New query**, paste the full
contents of `supabase/migrations/0001_init.sql`, and run it. This
creates the `profiles`, `classrooms`, `students`, and
`classroom_students` tables with RLS enabled and the policies described
in `docs/DATABASE.md`.

Then, in a new query, paste and run
`supabase/migrations/0002_subjects_topics.sql` (must run **after**
0001 — it references `profiles` and `classrooms`). This adds `subjects`,
`subject_classrooms`, and `topics`, again with RLS enabled — see the
"Phase 3" section of `docs/DATABASE.md`.

Finally, in a new query, paste and run
`supabase/migrations/0003_auth_profile.sql` (must run **after** 0001 —
it alters `public.profiles`). This adds the `handle_new_user` trigger
that automatically creates a `role='teacher'` profile for every new
signup, and removes the client's ability to insert its own profile row —
see the "Phase 4" section of `docs/DATABASE.md`.

(If you use the Supabase CLI locally instead, `supabase db push` or
`supabase migration up` runs every file in `supabase/migrations/` in
order the same way.)

## 6. Sign up a teacher account

With all three migrations applied, real auth is fully wired up — no
manual profile-row workaround needed anymore:

1. Run `npm run dev` and open the app. Since Supabase is now configured,
   visiting any `/teacher/*` route redirects to `/login`.
2. Click **สมัครใช้งาน** (sign up), fill in display name / email /
   password / confirm password, and submit.
3. `handle_new_user` (0003) creates the matching `profiles` row
   automatically with `role='teacher'` — there is nothing to do by hand.
4. Depending on your project's **Authentication → Providers → Email →
   Confirm email** setting, you'll either land straight in
   `/teacher/dashboard` or see a "check your email" message and need to
   click the confirmation link first.

If your project has email confirmation ON but no custom SMTP configured,
Supabase's default email sender has a low rate limit — for fast local
iteration you may want to temporarily turn confirmation off in
**Authentication → Providers → Email**.

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
