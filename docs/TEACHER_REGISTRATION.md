# Teacher registration (temporarily disabled)

Public teacher self-registration is **off**. Existing teachers sign in as
usual, password reset/recovery is unchanged, and **student registration
(`/student/signup`) is not affected**.

The setting is enforced in two places. Both must be turned on for teachers
to self-register again.

| Layer | Setting | Default | What it controls |
|---|---|---|---|
| Web app (UI) | `VITE_ENABLE_TEACHER_REGISTRATION` (env var, read by `src/lib/feature-flags.ts`) | `false` | Shows or hides the `/signup` page and the "สมัครใช้งาน" link on the teacher login page. While off, `/signup` redirects to `/login`. |
| Database (security) | `public.app_settings` row `enable_teacher_registration` (migration `0028_teacher_registration_flag.sql`) | `false` | The `handle_new_user` sign-up trigger refuses to create a **teacher** account. This also blocks direct calls to Supabase Auth's public sign-up endpoint, which the UI flag alone cannot stop. |

## Why the database part matters

Every new Supabase Auth user becomes a **teacher** unless the sign-up asks
for `intended_role = 'student'` (see `0003` / `0008`). Anyone with the
public (publishable) key can call the sign-up endpoint directly, so hiding
the page is not enough. Migration `0028` makes the trigger itself refuse
teacher sign-ups while the flag is off.

## Manual steps (not applied automatically)

1. **Apply the migration.** In the Supabase dashboard open SQL Editor, paste
   the full contents of `supabase/migrations/0028_teacher_registration_flag.sql`
   and run it. It is additive and safe to re-run:
   - It creates `public.app_settings` with RLS on and no client access.
   - It seeds the flag as `false` without overwriting an existing value.
   - It replaces `handle_new_user` with the same logic plus the
     registration check.
   - It updates or deletes no existing users or profiles.
2. **Verify** (read-only):
   ```sql
   select key, value from public.app_settings where key = 'enable_teacher_registration';  -- false
   select count(*) from public.profiles;  -- same as before applying
   ```
3. **Web app:** leave `VITE_ENABLE_TEACHER_REGISTRATION` unset or `false` in
   the hosting provider's environment settings. Nothing to change for the
   default.

Until step 1 is done, teacher sign-up is only hidden in the app and is
**not** blocked on the server.

Do **not** turn off "Allow new users to sign up" in Supabase Auth settings
for this. That would also block student registration.

## Creating a teacher account while registration is closed

Either:

- **Admin API (service role, server-side only):** create the user with
  `app_metadata: { krunameclass_allow_teacher: true }`, e.g.
  `supabase.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { krunameclass_allow_teacher: true } })`.
  `app_metadata` cannot be set by a public sign-up, so this exemption is
  not available to the public. Never use the service-role key in the
  browser. Or:
- **Temporarily re-open:** set the database flag to `true`, create the
  account (Dashboard → Authentication → Add user, or the sign-up page),
  then set it back to `false`.

## Re-enabling teacher registration later

No code change is needed:

```sql
update public.app_settings
   set value = 'true'::jsonb, updated_at = now()
 where key = 'enable_teacher_registration';
```

Then set `VITE_ENABLE_TEACHER_REGISTRATION=true` for the web app and
redeploy, so the page and link reappear. To close registration again,
set both back to `false`.

A missing row or any value other than `true` counts as **closed**
(fail closed).
