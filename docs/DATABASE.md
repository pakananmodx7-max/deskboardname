# Database schema

This document explains the schema introduced in
`supabase/migrations/0001_init.sql`, why it's shaped the way it is, and
what's intentionally deferred to a later phase.

> **Security review note:** this schema was revised in place (not
> patched with a follow-up migration — it had never been applied to a
> live database) after a security review found gaps in cross-teacher
> student access, profile role escalation, and student-creation
> atomicity. Every section below reflects the fixed version. See
> "Cross-teacher student hijacking prevention", "Profile role escalation
> prevention", and "Atomic student creation" for the specifics.

## Tables

### `profiles`

One row per authenticated user, mirroring `auth.users`. Holds `role`
(`teacher` / `admin` / `student`) so the rest of the schema and the app's
RLS policies can reason about "is this user a teacher" without touching
the `auth` schema directly. `role` is authorization-sensitive — see
"Profile role escalation prevention" below.

### `classrooms`

A section taught by one teacher for a given academic year/semester —
e.g. name `ม.5/1`, grade_level `ม.5`, section `1`, academic_year `2569`,
semester `1`. Owned by exactly one teacher via `teacher_id`.

### `students`

A student record identified by `student_code` (a stable external id,
e.g. the school's official student number) — **not** by name. A student
row is standalone: it is not owned by a single classroom, and is
visible to any teacher who legitimately teaches it. `created_by` records
which teacher originally created the record — this is an authorization
anchor, not a broad ownership flag; see "Cross-teacher student
hijacking prevention".

### `classroom_students`

The join table that represents classroom membership: `(classroom_id,
student_id)`, unique together. This is the only place classroom
membership is recorded.

## Why `classroom_students` exists

A student can belong to different classrooms across semesters and
academic years (promoted to the next grade, moved sections, etc.). If
`students` had a single `classroom_id` column, that history would be
overwritten every time a student moved, and the same student would need
a duplicate row per classroom. Modeling membership as its own table
means:

- One `students` row per real student, ever.
- A student can be linked to many classrooms over time.
- Future tables (attendance, grades, submissions) can reference a
  specific classroom membership rather than "the student" in the
  abstract, which matters once a student has been in more than one
  classroom.

## Relationships

```
profiles
   |
   v
classrooms
   |
   v
classroom_students
   |
   v
students
   |
   v
attendance / grades / submissions   (future — not implemented yet)
```

`attendance`, `assignments`, `submissions`, and `grades` are not created
in this phase. When they are, they should reference `classroom_students`
(or the `classroom_id` + `student_id` pair) rather than `students` alone,
so a record is always scoped to a specific classroom enrollment.

## `student_code` duplicate strategy

`students.student_code` is **indexed but not a unique database
constraint**. This is deliberate, not an oversight:

- RLS scopes every teacher's visibility of `students` to rows that are
  members of a classroom *they* own (see below). A teacher can only ever
  see and search among students already connected to one of their own
  classrooms.
- If `student_code` were a hard, table-wide unique constraint, a
  collision between two completely unrelated teachers' students (e.g.
  two different schools both numbering students `001`, `002`, ...) would
  throw a database error neither teacher could see or resolve, since
  neither can see the other's row.
- Instead, duplicate detection is done at the **service layer**, scoped
  to what the requesting teacher can already see:
  1. Look up `student_code` among the teacher's visible students.
  2. If found and already linked to the target classroom → duplicate.
  3. If found but not linked to the target classroom → link the existing
     student instead of creating a new row.
  4. If not found → create a new student.

A future multi-school design would likely add a `school_id` to
`classrooms`/`profiles` and make `student_code` unique *per school*,
which would make a database-level constraint safe again.

## Cross-teacher student hijacking prevention

**The problem:** if linking a student into a classroom only checked
"does this classroom belong to me", any teacher who learned or guessed
another teacher's student UUID could link that student into their own
classroom and immediately gain read/update access to it via
`students_select_via_classroom` — a hard privilege-escalation and
data-leak bug. UUIDs being hard to guess is not a security boundary.

**The fix — a custody model.** `classroom_students` INSERT
(`classroom_students_insert_own`) now requires **both**:

1. the target classroom belongs to the caller (`teacher_id = auth.uid()`), **and**
2. the caller has *custody* of the student — either:
   - they created that student record (`students.created_by = auth.uid()`), or
   - the student is already linked to some **other** classroom the
     caller owns (they legitimately already teach this student, e.g.
     re-enrolling them the following semester).

Custody can never be created "out of nothing" for a student you have no
existing relationship with — you can't manufacture condition 2 without
already satisfying it, and you can't satisfy condition 1 for a student
someone else created. This closes the hijack path entirely for ordinary
teacher accounts.

**Explicit escape hatch for legitimate transfers.** Real schools do need
a way to move or share a student across teachers (transfers, co-taught
sections). Rather than loosen the teacher-scoped policy above to make
room for that, there's a **separate, independent policy**
(`classroom_students_insert_admin`): a profile with `role = 'admin'` may
link any student into any classroom, no ownership or custody required.
Postgres evaluates multiple permissive policies for the same operation
with OR, so this is an explicit, auditable, separately-grantable
authorization path — not a loophole baked into the teacher policy. Full
self-service transfer flows (a request/approval UI) are still future
work; for now this gives the schema a real mechanism an admin-mediated
process can use.

**Implementation detail worth knowing — two small `SECURITY DEFINER`
helpers, for two different reasons:**

- `is_student_creator(uuid)`: the custody check can't be a plain
  subquery against `students` from inside the `classroom_students`
  policy, because `students_select_via_classroom` only grants visibility
  into a student *after* a `classroom_students` link exists — exactly
  the row being created. A plain subquery would always see zero rows
  and permanently block enrolling a student you just created.
  `is_student_creator` checks `created_by = auth.uid()` for exactly one
  student id, bypassing that bootstrapping problem.
- `has_existing_classroom_link(uuid)`: the "already teaches this student
  elsewhere" branch needs to query `classroom_students` itself — but
  Postgres flatly refuses to let a policy on a table contain a raw
  subquery against that *same* table ("infinite recursion detected in
  policy"), regardless of whether the inner query would actually
  terminate. Wrapping it in a function sidesteps that restriction.

Both take no "which user" parameter (always check the caller against
themselves — no cross-teacher information leak), return a boolean only,
and have `EXECUTE` revoked from `public`/granted only to `authenticated`.
These are the only two places in the schema where `SECURITY DEFINER` is
actually necessary — see their comments in the migration for the full
checklist. Confirmed empirically: an earlier draft of this migration
compiled fine but failed both of these exact cases (a plain "students"
subquery, and a self-referential "classroom_students" subquery) the
first time it was actually run against a throwaway local Postgres
instance during review — which is exactly why it was dry-run before
ever being pointed at Supabase.

## Profile role escalation prevention

`role` is the one authorization-sensitive column on `profiles`; every
other column (`display_name`, `email`) is freely self-editable.
Preventing self-escalation needs two separate checks, since insert and
update are different operations:

- **Insert:** `profiles_insert_own`'s `with check` requires `role =
  'teacher'` — the only role this app's UI provisions. A user cannot
  insert their own profile as `'admin'`.
- **Update:** `profiles_update_own`'s `with check (id = auth.uid())`
  only constrains *which row* can be touched, not *which columns* — so a
  `BEFORE UPDATE` trigger (`protect_profiles_privileged_fields` /
  `protect_profile_privileged_fields()`) additionally blocks any change
  to `role` whenever the request is running as the ordinary Postgres
  `authenticated` role (i.e. a normal client using the publishable key +
  a user JWT). `current_setting('role', true) = 'authenticated'` is
  checked rather than the JWT's role claim, so a trusted `service_role`
  call or a superuser SQL-editor session (both used for legitimate
  operator-driven role changes) are unaffected — only the app's own
  client requests are constrained.

Both checks are enforced in Postgres/RLS, not the client — a malicious
direct API call gets the same result as using the app's UI.

## Row Level Security (RLS)

RLS is enabled on all four tables. Nothing bypasses it from the client —
there is no service-role key in the client, and no "admin shortcut"
policy on tables an admin doesn't need broad access to.

- **`profiles`**: a user may only `select` their own row, `insert` their
  own row (forced to `role = 'teacher'`), and `update` their own row's
  ordinary fields (`role` is separately protected by a trigger — see
  above).
- **`classrooms`**: a teacher may only `select`/`update`/`delete`
  classrooms where `teacher_id = auth.uid()`. `insert` additionally
  requires the caller's profile role to be `'teacher'` or `'admin'` — a
  `'student'`-role profile cannot create a classroom.
- **`students`**:
  - `select`/`update` are scoped through `classroom_students` → only
    students who belong to at least one classroom the requesting teacher
    owns are visible.
  - `insert` (`students_insert_authorized`) requires `created_by =
    auth.uid()` (the caller can't forge authorship for someone else) and
    a `role` of `'teacher'` or `'admin'`. A brand-new student isn't
    linked to any classroom yet at the moment it's created, so the
    classroom-scoped check can't apply to the insert itself — it only
    becomes visible to anyone once linked via `classroom_students`.
- **`classroom_students`**: `select`/`delete` require the referenced
  classroom to belong to the requesting teacher. `insert` requires
  classroom ownership **and** custody of the student (see "Cross-teacher
  student hijacking prevention"), or `role = 'admin'` (separate policy).

Students do not get any broad read policy in this phase — the schema
only serves the teacher-facing app for now, matching the current UI.

## Atomic student creation (`create_student_and_enroll`)

Creating a student and enrolling them in a classroom used to be two
separate client-side statements (`insert into students`, then `insert
into classroom_students`). If the second insert ever failed after the
first succeeded, the result was an orphaned, unreachable `students` row
— created, but with no membership, and no RLS path back to it (see
"Orphan student strategy" below for what "orphan" means more broadly).

`public.create_student_and_enroll(...)` wraps both inserts in one
PL/pgSQL function so they run as a single, atomic unit — if anything
inside raises an exception, both inserts roll back together. It runs as
`SECURITY INVOKER` (the default, stated explicitly) rather than
`SECURITY DEFINER`: the existing RLS policies already grant a legitimate
teacher everything the function does, so there's no privileged
functionality to wrap — just a single round-trip instead of two, with a
transactional guarantee the two-statement version couldn't offer.
`student-service.ts`'s `createStudent()` calls this RPC instead of
inserting into `students` directly.

The Excel/CSV bulk import (`src/features/student-import/`) calls the
same `createStudent()` service function for each "create" row — the
Add Student dialog and bulk import go through the identical
authorization path and the identical atomic RPC. Rows resolved to
"link an existing student" instead call `addStudentToClassroom`
directly; this is safe under the custody model above because a student
can only ever be *found* by `findStudentByCode` if `students_select_via_classroom`
already grants the requesting teacher visibility into it — which means
they already have custody via an existing classroom link, satisfying
`classroom_students_insert_own`'s second condition automatically. No
import-specific bypass was needed. A dedicated bulk RPC (e.g. inserting
many rows in one transaction) is a reasonable future optimization once
import volumes justify it, but was deliberately not built now —
correctness and a single well-reviewed authorization path matter more
here than round-trip count.

## Orphan student strategy

"Orphan" can mean two different things in this schema, and they're
handled differently:

1. **A student with zero classroom memberships**, because a teacher
   removed them from their last remaining classroom
   (`removeStudentFromClassroom` → deletes the `classroom_students` row
   only). This is **expected, normal, and reversible** — the student
   record is never deleted just because a membership is. The row simply
   becomes invisible to every teacher (no `classroom_students` link
   means no one currently passes `students_select_via_classroom`) until
   re-linked — either by re-enrolling them (their original
   `created_by` teacher retains custody indefinitely) or by an admin.
   There is intentionally no automatic cleanup job for these — a student
   record disappearing from view for a semester isn't data loss, and
   permanent deletion is a decision a human should make explicitly (see
   below).
2. **A student created but never successfully enrolled anywhere**, which
   was previously possible if the two-step create-then-link flow failed
   halfway. `create_student_and_enroll`'s atomicity (above) makes this
   case impossible going forward for anything going through the app.

Neither `students` nor `profiles` has a `DELETE` RLS policy at all —
nobody can delete a student or profile row through the client API in
this phase. That's a deliberate fail-closed default: destructive,
permanent deletion of academic records is exactly the kind of operation
that should require a deliberate, audited, operator-level action (a
future admin tool backed by `service_role`, not a checkbox in the
teacher UI), not something reachable from ordinary RLS-governed traffic.

## Foreign key cascade policy

| Constraint | Behavior | Why |
|---|---|---|
| `profiles.id → auth.users(id)` | `on delete cascade` | Deleting the actual Supabase auth user removes the corresponding shell profile row — there's no reason for a profile to outlive its auth identity. |
| `classrooms.teacher_id → profiles(id)` | `on delete restrict` (was `cascade`) | A teacher's classrooms — and everything that will eventually hang off them (attendance, grades) — must never disappear as a *side effect* of deleting a profile. `restrict` makes Postgres refuse the delete outright while classrooms still reference that profile, forcing an explicit step (reassign or archive classrooms first) before a teacher account can be removed. Combined with the row above, this also means deleting an `auth.users` row is blocked while that user still owns classrooms — the cascade can't "jump past" the restrict. |
| `classroom_students.classroom_id → classrooms(id)` | `on delete cascade` | Deleting a classroom (an explicit, deliberate action) reasonably takes its membership records with it. |
| `classroom_students.student_id → students(id)` | `on delete cascade` | If a student row is ever deleted, stale membership rows pointing at it should go too. (Currently unreachable in practice — there's no `DELETE` policy on `students`.) |
| `students.created_by → profiles(id)` | `on delete set null` | The student record must survive its creator's profile being deleted (never auto-deleted — see "Orphan student strategy"), and a profile delete must never be blocked by how many students that teacher created over time. `created_by` becoming `null` just means "creator's account no longer exists," not "no creator." |

## Reusable `updated_at` trigger

`public.set_updated_at()` is a single trigger function applied via
`BEFORE UPDATE` triggers on `profiles`, `classrooms`, and `students`, so
`updated_at` is always set server-side and can't drift or be forgotten
by application code.

## `pgcrypto`

Enabled for `gen_random_uuid()`, used as the default for every table's
`id` primary key.

---

# Phase 3: subjects, subject↔classroom links, topics

This section explains the schema added in
`supabase/migrations/0002_subjects_topics.sql`, on top of everything
above. Scope is deliberately narrow: subjects, the subject↔classroom
relationship, subject student enrollment (derived, not stored), and
topics. Attendance, assignments, submissions, and grades stay demo-only
in the application and are **not** modeled here yet.

> Like 0001, this migration has never been applied to a live database as
> of writing, and was dry-run against a throwaway local Postgres instance
> (with a hand-rolled `auth` schema/role shim) during review — see
> "Security review" below for the exact scenarios that were empirically
> tested, not just reasoned about.

## Tables

### `subjects`

A subject (วิชา) taught by one teacher — e.g. name "วิทยาศาสตร์", `subject_code`
"ว32101", `academic_year` "2569", `semester` "1". Owned by exactly one
teacher via `teacher_id`, same ownership shape as `classrooms`.

### `subject_classrooms`

The join table linking a subject to the classroom(s) it's taught to.
`(subject_id, classroom_id)` unique together. A subject can link to many
classrooms (taught to multiple sections); a classroom can host many
subjects.

### `topics`

A syllabus topic/unit within a subject (e.g. "บทที่ 1 แรงและการเคลื่อนที่"),
ordered by `position`. Always belongs to exactly one subject — no
standalone topics.

## How a subject's student roster is derived

**Students are never duplicated or stored per-subject.** "Which students
are in this subject" is always computed on read, via:

```
subjects → subject_classrooms → classroom_students → students
```

i.e. a student is "in" a subject if and only if they belong to at least
one classroom currently linked to that subject. `subject-service.ts`'s
`getSubjectStudents()` implements exactly this: look up the subject's
linked classroom ids via `subject_classrooms`, then pull
`classroom_students` for those classrooms joined with `students`,
de-duplicating a student who happens to belong to more than one of the
subject's linked classrooms (returned once). There is no
`subject_students` table and no student row that "belongs to" a subject.

This is why unlinking a classroom from a subject (`subject_classrooms`
delete) is enough to remove that classroom's students from the subject's
roster on the next read — nothing about the students or their classroom
membership changes at all, only the link.

### Future extension: `subject_students`

Pure classroom-derivation can't express three real scenarios: **elective
subjects** (a hand-picked subset of students, not "everyone in classroom
X"), **individual removals** (a specific student opted out despite their
classroom being linked), and **special enrollment** (a student from an
unlinked classroom sitting in on a subject anyway). A future
`subject_students` table with an `enrollment_type` of `'include'` /
`'exclude'` — overriding or extending the classroom-derived roster
without ever storing duplicate student data — is sketched in a comment
at the bottom of `0002_subjects_topics.sql`, but deliberately not built
yet: none of these three scenarios has a real product need today, and
speculatively building it now would be exactly the kind of premature
abstraction the rest of this schema has avoided.

## Cross-teacher link prevention

**The problem, symmetric with `classroom_students` in Phase 1:** if
linking a classroom into a subject only checked "do I own the subject",
a teacher could attach *another* teacher's classroom (and thus that
classroom's students) to their own subject. If it only checked "do I own
the classroom", a teacher could attach their classroom to a subject they
don't own.

**The fix:** `subject_classrooms_insert_own` requires **both**:

1. the target subject belongs to the caller (`subjects.teacher_id = auth.uid()`), **and**
2. the target classroom belongs to the caller (`classrooms.teacher_id = auth.uid()`).

Unlike the Phase 1 `classroom_students` insert policy, this needed no
`SECURITY DEFINER` helper functions and no RLS-visibility bootstrapping
workaround: `subjects` and `classrooms` are both independent parent
tables with their own straightforward ownership columns, so two direct
`exists (...)` subqueries are sufficient — there's no self-referential
dependency on `subject_classrooms` itself, and no table whose SELECT
policy depends on the very row being inserted (the way
`students_select_via_classroom` depended on `classroom_students`).

## Atomic subject creation (`create_subject_with_classrooms`)

Creating a subject and linking N selected classrooms used to be N+1
separate client-side statements. If any single link insert failed
partway through (e.g. a `classroom_id` the caller doesn't actually own —
exactly the case `subject_classrooms_insert_own` exists to catch), the
subject row itself would already be committed, leaving a subject with
zero or a partial set of linked classrooms silently visible in the UI —
a half-created subject.

`public.create_subject_with_classrooms(...)` wraps the subject insert and
every classroom-link insert in one PL/pgSQL function, run as a single
atomic unit: if any insert raises, everything rolls back together,
including the subject row. Like `create_student_and_enroll` in Phase 1,
it runs as `SECURITY INVOKER` — the existing RLS policies already grant a
legitimate teacher everything the function does, so there's nothing
privileged to wrap, just one round trip with a transactional guarantee
instead of N unguarded ones. `subject-service.ts`'s `createSubject()`
calls this RPC exclusively; there is no code path that inserts into
`subjects` directly from the client.

Unlike `create_student_and_enroll`, there was no RLS-visibility
bootstrapping problem to design around here: `subjects_select_own` only
checks `subjects.teacher_id = auth.uid()`, which is already true the
instant the row is inserted — it doesn't depend on `subject_classrooms`
existing first, so the function's final `select ... into v_subject` is a
plain, ordinary RLS-checked read.

## Subject delete/cascade strategy

Like `students` in Phase 1, **`subjects` has no `DELETE` RLS policy at
all.** Retiring a subject goes through `archiveSubject()` (an `UPDATE`
setting `is_active = false`), never a hard delete through the app. This
keeps a subject's topics — and, once that phase is migrated, its
attendance/assignments/grades — intact as history instead of letting a
single teacher action silently destroy academic records.

| Constraint | Behavior | Why |
|---|---|---|
| `subjects.teacher_id → profiles(id)` | `on delete restrict` | Same rationale as `classrooms.teacher_id` in Phase 1 — a teacher's subjects must never disappear as a *side effect* of deleting a profile. Reassigning/archiving subjects first is an explicit, forced step. |
| `subject_classrooms.subject_id → subjects(id)` | `on delete cascade` | If a subject were ever hard-deleted (only reachable via `service_role`, never via RLS — see above), its links should go with it rather than leaving dangling rows. |
| `subject_classrooms.classroom_id → classrooms(id)` | `on delete cascade` | Deleting a classroom (`classrooms_delete_own` does allow this) removes just the link row — the subject and its topics are unaffected; the subject only loses that one classroom's students from its derived roster. Same pattern as `classroom_students.classroom_id` in Phase 1. |
| `topics.subject_id → subjects(id)` | `on delete cascade` | Topics have no independent existence outside their subject; if the subject were ever hard-deleted, its topics should go with it. |

## Unlink vs delete

`unlinkClassroomFromSubject()` (`subject_classrooms` delete) removes
*only* that one link row. It never touches the subject, the classroom,
or any student/membership data — a classroom's students simply stop
appearing in that subject's derived roster on the next read. This
mirrors `removeStudentFromClassroom` in Phase 1 removing only a
`classroom_students` row.

## Demo vs Supabase data mode

There is no login page in this app yet. `src/hooks/use-data-mode.ts`
decides, for the Subjects/Topics UI specifically, whether to read from
the demo context (mock, in-memory, always available) or the real
Supabase-backed services — and picks the real services **only when
Supabase is configured AND a signed-in session actually exists**.
"Configured but signed out" (the expected state for the deployed demo
even if it's ever pointed at a real Supabase project, since there's no
way to sign in yet) falls back to demo mode rather than rendering a
broken or empty real UI. This is what keeps demo and production data
from ever mixing — the two never read from or write to each other, and
which one is active is decided once, before any Subjects data fetch
happens.

The เช็คชื่อ/งาน/คะแนน tabs are intentionally **not** switched by data
mode at all in this phase: when a subject is backed by real data, those
three tabs render a `DemoOnlyNotice` placeholder instead of the demo
attendance/assignments/grades components, because those components' data
(`DemoSubjectAssignment`, `DemoSubjectAttendance`) lives entirely in the
in-memory demo context and has no relationship to a real subject's UUID
— rendering them against a real subject would silently show unrelated
mock data instead of that subject's data. This keeps the gap explicit
until that phase is migrated, rather than papering over it.

## Security review (Phase 3)

Each item below was verified empirically against a throwaway local
Postgres 16 instance with a hand-rolled `auth.uid()` / `authenticated` /
`anon` role shim (not just reasoned about), covering two teachers, a
role-`student` profile, and every INSERT/SELECT/DELETE path introduced
by `0002_subjects_topics.sql`.

| # | Item | Result |
|---|---|---|
| A | Subject RLS (owner-only CRUD, no delete) | PASS |
| B | Classroom linking ownership (both subject AND classroom must be owned by caller) | PASS |
| C | Topic ownership (transitive through subject) | PASS |
| D | Cross-teacher isolation (subjects, links, topics) | PASS |
| E | Anonymous access (`anon` role) | PASS — 0 rows |
| F | Atomic subject creation (bad classroom_id rolls back the whole subject) | PASS |
| G | Student derivation without duplication | PASS (by construction — no `subject_students` table exists) |
| H | Delete/cascade behavior | PASS |

See the top-of-file "Phase 3" section of the main security report (or the
session's final report) for the full scenario-by-scenario writeup.

---

# Phase 4: real teacher authentication

This section explains `supabase/migrations/0003_auth_profile.sql`, on top
of everything above. Scope: wiring `auth.users` signup to an automatic
`public.profiles` row. Nothing about classrooms, students, subjects, or
topics changes.

## `handle_new_user` — profile creation moves entirely server-side

Phase 1's `profiles_insert_own` RLS policy let an authenticated client
`INSERT` its own `profiles` row directly, gated by
`with check (id = auth.uid() and role = 'teacher')`. That was already
safe against role escalation, but profile creation was still a
client-initiated request — one more thing the frontend has to remember to
do, and one more `INSERT` whose `WITH CHECK` clause was the only thing
standing between a normal signup and a client that sends `role: 'admin'`.

`0003_auth_profile.sql` replaces that entirely with a trigger:
`public.handle_new_user()` fires `after insert on auth.users`, i.e. the
instant `supabase.auth.signUp()` succeeds, and inserts the matching
`profiles` row itself — a normal signup flow never touches `profiles` at
all, client-side, in any way.

**Why a client can never make this insert admin, or spoof another user:**

- `role` is hardcoded to the literal `'teacher'` in the function body. It
  is never read from `new.raw_user_meta_data` or anywhere else
  client-controlled — even a client that calls
  `supabase.auth.signUp({ ..., options: { data: { role: 'admin' } } })`
  has that `role` key simply never looked at. There is no code path
  through which client input can reach the `role` column. (Confirmed
  empirically — see "Security review" below.)
- `id` and `email` come from `new.id` / `new.email`, the just-created
  `auth.users` row — not from any client-supplied parameter. A trigger
  has no caller-supplied arguments at all (only `NEW`/`OLD`), so there is
  no "which id" input to spoof in the first place, structurally, not just
  by a runtime check.
- `display_name` comes from `new.raw_user_meta_data->>'display_name'`
  (the signup form's one text field). Not authorization-sensitive — same
  as `display_name` already being freely self-editable via
  `profiles_update_own`.

**Why `SECURITY DEFINER`:** this trigger fires as part of the
`auth.users` insert Supabase's own auth service performs, not as a normal
client request running as `authenticated`. `profiles` has RLS enabled
with **no INSERT policy at all** after this migration (see below), so the
invoking role has no reason to already hold INSERT privileges on it.
Running as the function owner is what lets it write the row regardless of
which role performed the `auth.users` insert. `search_path` is pinned,
same pattern as every other `SECURITY DEFINER` function in this schema.

**Why no `EXECUTE` grant/revoke, unlike `is_student_creator` /
`has_existing_classroom_link` in Phase 1:** those are called from RLS
policies evaluated in a normal client session, so PUBLIC's default
EXECUTE had to be revoked and re-granted narrowly. `handle_new_user`
is declared `returns trigger`, which Postgres refuses to execute except
as an actual trigger — `select public.handle_new_user()` fails outright —
so it has no callable surface for a client to invoke directly regardless
of grants. Revoking PUBLIC's default EXECUTE here would only risk
breaking Supabase's own internal auth flow for a security property this
function already has for free.

`on conflict (id) do nothing` is defensive only: under normal operation
this fires once per new auth user with a fresh `id`, so nothing conflicts.
It just means a retry can never turn into a hard error that blocks
signup.

## `profiles` loses its INSERT policy

`drop policy if exists "profiles_insert_own" on public.profiles;` — now
that every profile is created automatically by the trigger, the client
never legitimately needs to `INSERT` into `profiles` at all. Removing the
policy removes that entire request from the app's authorization surface,
rather than leaving a now-unnecessary "insert your own row, but only as
`role='teacher'`" policy around for defense in depth that no longer
defends anything. After this migration, `profiles` has:

- `SELECT` — own row only (`profiles_select_own`, Phase 1, unchanged)
- `UPDATE` — own row only, `role` separately blocked by
  `protect_profile_privileged_fields` (Phase 1, unchanged)
- **no `INSERT` policy** — the only way a `profiles` row comes into
  existence is `handle_new_user()`, which bypasses RLS via
  `SECURITY DEFINER` and is not reachable as a client-callable function.
- no `DELETE` policy (unchanged from Phase 1)

## Frontend auth architecture

- **`src/lib/data-mode.ts`** — `dataMode: 'demo' | 'supabase'`, a plain
  constant computed once from `isSupabaseConfigured`. Unlike the Phase 3
  version of this concept, it does **not** depend on whether a session
  exists: Supabase configured means the real system is active, full stop;
  an unauthenticated visitor gets sent to `/login`, not silently shown
  demo data. Supabase not configured means demo mode is active and never
  requires signing in. This is what keeps demo and production data from
  ever mixing, now that a real login exists to make "configured but
  signed out" a meaningful, reachable state.
- **`src/lib/auth-context.tsx`** — `AuthProvider` / `useAuth()`, the
  single source of truth for session + profile state (`status`, `user`,
  `profile`) and every auth action (`signIn`, `signUp`, `signOut`,
  `sendPasswordReset`, `updatePassword`). Always mounted (wraps the whole
  router), including in demo mode, where it just stays in an inert
  `{status:'ready', user:null, profile:null}` state — nothing in demo
  mode ever calls its action methods, since the auth pages redirect away
  before rendering a form when `dataMode === 'demo'`.
- **`src/components/auth/protected-route.tsx`** — wraps the `/teacher`
  route's `element`. Demo mode: always renders. Supabase mode: renders
  only once a session is confirmed present; no session → `<Navigate
  to="/login" />`; still resolving the initial check → a lightweight
  loading state (never a flash of teacher data before the check finishes).

## Manual sign-in workaround retired

`docs/SUPABASE_SETUP.md`'s previous "§6 Create a teacher user to test
with" (insert a profile row by hand, sign in via the browser console) is
no longer needed or accurate — signup now creates the profile
automatically, and a real `/login` page exists. That section has been
replaced with a pointer to the real signup flow.

## Security review (Phase 4)

Verified empirically against a throwaway local Postgres 16 instance —
this time with the auth shim extended to include an `auth.users` table
and a low-privilege `supabase_auth_admin` role (granted only `INSERT` on
`auth.users`, deliberately **no** grant on `public.profiles`) standing in
for the real Supabase auth service role, so the test actually exercises
the `SECURITY DEFINER` bypass rather than passing only because the test
role happened to have broad privileges.

| Item | Result |
|---|---|
| User cannot choose `admin` role | PASS — `raw_user_meta_data` containing `{"role":"admin"}` produced a `role='teacher'` profile; the field is never read |
| User cannot modify their own role | PASS — `protect_profile_privileged_fields` (Phase 1) still blocks it; re-verified after this migration |
| Profile creation cannot spoof another auth user | PASS — by construction (trigger has no caller-supplied id parameter; `id`/`email` always come from `NEW`) |
| Unauthenticated users cannot access teacher data | PASS — anon reads 0 profiles; `ProtectedRoute` redirects unauthenticated `/teacher/*` visits to `/login` (verified live against this dev environment's real, schema-applied Supabase project) |
| Session/logout behavior is correct | PASS — sign out clears the session and returns to `/login`; verified the redirect-to-login path live in the browser |
| RLS still works | PASS — cross-teacher profile read still denied; classroom/subject/topic policies from Phases 1–3 untouched and re-spot-checked (new teacher can still create a classroom end-to-end) |

No security-critical FAIL.

# Phase 5: Attendance

Migration: `supabase/migrations/0004_attendance.sql`. Has **not** been applied
to a live database as of writing — do not run it automatically. Scope:
classroom-level (homeroom) attendance only — "select classroom → select date
→ mark each student → save". Assignments, submissions, and grades stay
demo-only in the application; not touched by this migration.

## Tables

### `attendance_sessions`

One row per (classroom, date[, subject]) — "the roll call for ม.5/1 on
8 ก.ย. 2569". `classroom_id` cascades on classroom delete, matching
`classroom_students` (Phase 1). `created_by` is an audit trail only, never
the authorization boundary (that is always derived from `classroom_id` →
`classrooms.teacher_id`, exactly like every other table in this schema).

`subject_id` is **nullable on purpose**, not a placeholder that will need
migrating later:

- Every session the current app creates is classroom-level homeroom
  attendance, which isn't "about" any one subject — forcing a fake
  `subject_id` would misrepresent the data.
- A later phase can add subject-period attendance ("history class
  attendance for ม.5/1 on 8 ก.ย.") on the **same** table and the same
  `attendance_records` child rows by simply setting a real `subjects.id` —
  no new table, no data migration, no destructive redesign.

Two partial unique indexes make room for both cases without conflicting:

```sql
create unique index attendance_sessions_classroom_date_no_subject_uidx
  on attendance_sessions (classroom_id, attendance_date) where subject_id is null;

create unique index attendance_sessions_classroom_subject_date_uidx
  on attendance_sessions (classroom_id, subject_id, attendance_date) where subject_id is not null;
```

The first enforces "at most one homeroom session per classroom per day"
(what the app uses today); the second is unused today but will enforce "at
most one session per classroom+subject per day" the instant subject-period
attendance starts writing non-null `subject_id` rows.

### `attendance_records`

One row per (session, student), unique on `(attendance_session_id,
student_id)` — exactly one record per student per session.

`student_id` (**not** `classroom_student_id`) is a deliberate choice.
`classroom_students` rows are ephemeral by design — "เอาออกจากห้อง" and
"ย้ายห้อง" (`student-service.ts`, Phase 4.5) delete/replace them as routine,
everyday operations. If this table referenced `classroom_students.id` with
`on delete cascade`, removing a student from a classroom — or moving them —
would silently wipe every attendance record ever taken for them in that
classroom. Referencing `students.id` directly means attendance history
survives a membership change untouched; "was this student actually in that
classroom on that date" is instead an application-level check made once, at
the moment a record is first **written** (by `save_attendance_session`
below and `attendance_records_insert_own`'s `WITH CHECK`) — never a
constraint that would later delete history when membership changes.

## RLS

Ownership for both tables is always derived transitively: `attendance_sessions`
→ `classrooms.teacher_id`, `attendance_records` → `attendance_sessions` →
`classrooms.teacher_id`. Neither table has its own owner column (`created_by`
on sessions is an audit trail, not an authorization check).

`attendance_records_select_own` and `_update_own` deliberately do **not**
re-check the student's *current* classroom membership — only that the
caller owns the session. A student who later moves to a different classroom,
or is archived, must not lose visibility into (or the ability to correct)
attendance history that was legitimately recorded while they were there.

`attendance_records_insert_own` is the one place membership **is** checked,
and only at INSERT time: a brand-new record requires the student to be a
*current* member of the session's classroom via a direct `classroom_students`
lookup. This is what prevents "attendance records for students not
belonging to that classroom" — see Security review below for the empirical
test.

Neither table has a DELETE policy — matching `students`/`subjects`/the
no-hard-delete stance taken everywhere else in this schema. A status is
corrected via UPDATE (`มา` → `สาย`, add/edit a note), never removed outright.
See "Attendance delete strategy" below.

## Atomic save (`save_attendance_session`)

Persisting a full roll call (a session plus 30+ student records) as
N+1 separate client-side statements risks a partial save: if one record
write fails partway through (a student the caller no longer teaches, a bad
status value, a network blip), everything written before that point is
already committed, leaving a session with some students saved and others
silently missing. `save_attendance_session(p_classroom_id, p_attendance_date,
p_records jsonb)` wraps the session upsert and every record upsert in one
PL/pgSQL function, so Postgres runs the whole batch as a single
statement-level unit — any exception rolls every write in the call back
together.

Like `create_student_and_enroll` (Phase 1) and
`create_subject_with_classrooms` (Phase 3), this is `SECURITY INVOKER`, not
`DEFINER` — the RLS policies above already grant a legitimate teacher
everything the function does; it's just one round trip instead of many.

Calling it again for the same classroom+date **updates** the existing
session/records in place (`on conflict ... do update`) rather than creating
a duplicate — this is what makes reopening and re-saving a date safe, and
is exercised directly in the Security review's Test 3.

`p_records` is a JSON array of `{"student_id": uuid, "status": text, "note":
text | null}` objects. The app always sends the full current roster's
statuses; the function does not require that, and never deletes a record
just because it was omitted — consistent with the no-hard-delete policy.

## Attendance delete strategy

No table in this migration has a DELETE policy, for the same reason
`students` (Phase 1), `subjects` (Phase 3), and `classroom_students`
removal-vs-deletion already draw this line: attendance is academic history.
A wrong status is corrected via UPDATE; a whole session is never wiped from
the UI. If a genuine "undo an entire accidental roll call" need ever comes
up, that should be its own deliberate, audited action — not a byproduct of
this phase's default policy set.

## Demo vs Supabase data mode

Same branching pattern as Students/Classrooms/Subjects (Phase 3/4.5):
`attendance-page.tsx` picks `AttendancePageReal` or `AttendancePageDemo`
based on the module-level `dataMode` constant. `AttendancePageDemo` is the
original, untouched demo implementation (`src/demo/attendance.ts`,
`src/demo/demo-context.tsx`'s legacy `students`/`attendance` slice) — no
demo state was changed by this phase. `AttendancePageReal` calls
`attendance-service.ts`, which is Supabase-only; demo mode never touches it
and real mode never touches demo state. The 38 baked-in demo students are
never shown in real mode — the real page always loads its roster from
`classroom_students` for the selected classroom.

## Security review (Phase 5)

Verified empirically against a throwaway local Postgres 16 instance (same
auth shim as Phases 1–4) with two teachers, each owning one classroom and
its own students.

| # | Scenario | Result |
|---|---|---|
| 1 | New session save — teacher saves a full roster's statuses for a never-before-saved classroom+date | PASS — one session row created, one record row per student, statuses exactly as sent |
| 2 | Reopen existing attendance — read back the same classroom+date | PASS — saved statuses and notes returned unchanged |
| 3 | Duplicate session prevention — call `save_attendance_session` again for the SAME classroom+date with different statuses | PASS — still exactly 1 session row (not 2); the 3 record rows were UPDATED in place, not duplicated |
| 4 | Status validation — invalid status string (`"sick"`) | PASS — whole call rejected (`22023`), zero session/records created for that date (atomic rollback) |
| 5 | Cross-owner classroom denial — teacher A calls the RPC naming teacher B's classroom | PASS — rejected `42501` before any write |
| 6 | Spoofed student — teacher A's own classroom, but naming teacher B's student id | PASS — rejected `42501` ("นักเรียนไม่ได้อยู่ในห้องเรียนนี้"), zero session/records created |
| 7 | Empty classroom — save with `p_records: []` | PASS — session created with zero records, no error |
| 8 | Changing date — same classroom, second date | PASS — a distinct second session row, first session/records untouched |
| 9 | Inactive student handling — archive a student (`status = 'inactive'`) who already has a saved record | PASS — their existing record remains fully readable; `classroom_students` membership is untouched by archiving (status and membership are independent); correcting their already-saved record via the RPC afterward still succeeds (UPDATE path does not re-check current membership, by design) |
| 10 | Cross-owner read denial — teacher B queries teacher A's sessions/records directly | PASS — 0 rows visible |
| 11 | Anonymous read denial — `anon` role (no JWT `sub`) queries both tables | PASS — 0 rows visible |
| 12 | Unauthorized modification — teacher B attempts a direct `UPDATE` on a record inside teacher A's session, bypassing the RPC entirely | PASS — 0 rows updated (RLS filters the target row to nothing for this role) |

No security-critical FAIL. Changing classroom (test case in the app's own
test plan) is not a distinct database scenario — it is scenario 1 or 2
repeated against a different `classroom_id`, already covered above; the
UI-level "does switching the dropdown actually refetch" behavior is
ordinary React effect re-run behavior, verified by code review of the
`useEffect` dependency array (`[selectedClassroomId, date]`) rather than a
separate database test.

# Phase 6: Subject Attendance

Migration: `supabase/migrations/0005_subject_attendance.sql`. Has **not**
been applied to a live database as of writing — do not run it
automatically. Builds on 0001, 0002, and 0004 (all must already be
applied). Scope: wires up the `subject_id` column 0004 already reserved so
a subject's own เช็คชื่อ tab can record attendance for one of its linked
classrooms, on a date, optionally scoped to a คาบ (period) — this is the
smallest safe extension of 0004's design, not a new attendance system. No
table is dropped or recreated; the classroom-only (homeroom) attendance
flow from Phase 5 is untouched end to end.

## Schema changes

- `attendance_sessions.period_number` — new nullable `integer` column,
  `check (period_number is null or period_number > 0)`. Nullable for the
  same reason `subject_id` is (Phase 5): homeroom attendance never has a
  period, and a subject taught once a day to a classroom has no
  meaningful period number either.
- The old `attendance_sessions_classroom_subject_date_uidx` (Phase 5,
  never actually exercised — every write left `subject_id` null) is
  dropped and replaced by two period-aware partial unique indexes:
  `(classroom_id, subject_id, attendance_date)` where `subject_id is not
  null and period_number is null`, and `(classroom_id, subject_id,
  attendance_date, period_number)` where both are not null. Together with
  Phase 5's original `(classroom_id, attendance_date) where subject_id is
  null` index (untouched), exactly one of the three can ever apply to a
  given row, so "one session per (classroom, date) at whatever
  specificity you're writing at" holds for all three shapes at once.

## RLS changes

`attendance_sessions_insert_own`/`_update_own` (Phase 5) are dropped and
recreated with one added clause: when `subject_id` is not null, the caller
must additionally own that subject AND that subject must be linked to the
session's `classroom_id` via `subject_classrooms`. Without this, owning
the target classroom alone (Phase 5's only check) would let a teacher
attach *any* subject_id they merely know the UUID of — including another
teacher's subject — to a session inside their own classroom.
`attendance_records` policies are untouched: their existing
classroom-membership check already applies correctly regardless of
whether the parent session is homeroom or subject-scoped.

## `save_attendance_session` — extended, not just replaced

**This required an explicit `drop function` before the `create or replace`,
which was not obvious going in and is worth documenting precisely**:
Postgres identifies a function by name *and* its declared argument types.
Appending `p_subject_id`/`p_period_number` (even as defaulted trailing
parameters) changes the signature, and `create or replace function` in
that situation does **not** swap the old function out — it creates a
second, separate overload sitting alongside the original 3-argument one.

This was caught empirically while verifying this migration: after
`create or replace`-ing the extended function without first dropping the
old one, the *existing* 3-argument call from `attendance-service.ts`'s
standalone classroom Attendance page — exactly the "keep this working
unchanged" requirement for this phase — started failing with `function
save_attendance_session(uuid, date, jsonb) is not unique`, because
Postgres could no longer tell whether a 3-argument call meant the old
function or the new 5-argument one invoked with both trailing defaults
omitted. The fix is the explicit `drop function if exists
public.save_attendance_session(uuid, date, jsonb);` immediately before
the `create or replace` in 0005 — after that, only the 5-argument
signature exists, and every existing 3-argument call resolves to it
unambiguously with `p_subject_id`/`p_period_number` both defaulting to
null (exactly what those calls already did implicitly).

Two small additions to the function body itself: (1) when `p_subject_id`
is provided, it's validated against ownership + `subject_classrooms`
linkage up front, before any write, mirroring the RLS check above but
with a clearer Thai error message than a bare RLS violation; (2) the
session upsert branches into three `if`/`elsif` cases (homeroom /
subject+no-period / subject+period), each targeting the one partial
unique index that can actually apply — a single `INSERT ... ON CONFLICT`
can only name one conflict target, so three mutually-exclusive index
shapes need three insert branches, not one. Record validation
(status check, classroom-membership check) is unchanged and still keys
off `p_classroom_id` regardless of subject scoping, since a subject's
roster is exactly its linked classrooms' rosters.

## Service and UI

`attendance-service.ts`'s `getAttendance`/`saveAttendance` both gained
optional `subjectId`/`periodNumber` parameters defaulting to `null` —
every existing call site (the standalone Attendance page) is
byte-for-byte unchanged and keeps reading/writing homeroom rows only. Two
new pure helpers were added alongside the existing ones:
`deriveAttendanceRoster` (the "active members, plus any archived member
who already has a saved record" roster rule from Phase 5, extracted so
both the classroom page and every subject's เช็คชื่อ tab share the exact
same rule instead of two copies) and `parsePeriodNumber` (client-side
mirror of the RPC's `period_number > 0` rule, so an invalid คาบ value
never reaches Supabase). The summary card + roster table markup itself
was extracted into `AttendanceRosterCard`
(`src/features/attendance/attendance-roster-card.tsx`) and is now used by
both the standalone page and the subject tab — one UI, not two.

`subjects-real/tabs/attendance-tab.tsx` restricts its classroom picker to
`getSubjectClassrooms(subject.id)` (subject-service.ts, Phase 3) — never
the teacher's full classroom list — so only classrooms actually linked to
this subject can be selected, and always sends `subject.id` as the
RPC's `p_subject_id`. Demo mode is untouched: the demo subject Attendance
tab (`demo-subjects/tabs/attendance-tab.tsx`) still operates entirely on
`DemoSubjectAttendance` in `demo-context.tsx`, unrelated to any of this.

## Security review (Phase 6)

Verified empirically against a throwaway local Postgres 16 instance (same
auth shim as prior phases), with two teachers: teacher A owns two
classrooms (one linked to their subject, one deliberately NOT linked) and
a subject; teacher B owns a separate classroom, subject, and student.

| # | Scenario | Result |
|---|---|---|
| 1 | New subject-scoped session save (no period) | PASS — one session with `subject_id` set, `period_number` null; 3 records saved as sent |
| 2 | Reopen the same classroom/date/subject/no-period combination | PASS — still exactly 1 session (upsert, not duplicate), 3 records unchanged |
| 3 | Multiple periods same subject/classroom/date (คาบ 1 and คาบ 5) | PASS — 2 distinct new sessions created alongside the no-period one (3 total) |
| 4 | Re-saving คาบ 1 again | PASS — still 3 sessions total (no new one for คาบ 1); the คาบ 1 record was updated in place, not duplicated |
| 5 | Unlinked classroom — teacher's own classroom, but NOT linked to the subject | PASS — rejected `42501` ("ห้องเรียนนี้ไม่ได้เชื่อมกับรายวิชานี้"), zero session created |
| 6 | Cross-owner subject spoof — own (linked) classroom, but another teacher's subject id | PASS — rejected `42501` before any write |
| 7 | Cross-owner classroom spoof — own subject, but another teacher's classroom id | PASS — rejected `42501` before any write |
| 8 | Invalid period number (`0`) | PASS — rejected `22023` ("คาบเรียนไม่ถูกต้อง"), zero session created |
| 9 | Standalone classroom (homeroom) attendance via the original 3-argument call | PASS **after the drop-function fix above** — resolves unambiguously, creates the expected 4th (homeroom) session, fully unaffected by every subject-scoped row already present for the same classroom+date |
| 10 | Cross-owner read denial — teacher B queries teacher A's subject-attendance sessions | PASS — 0 rows visible |
| 11 | Anonymous read denial | PASS — 0 rows visible |

No security-critical FAIL. Scenario 9 surfaced a real backward-compatibility
bug during verification (the function-overload ambiguity above) — it was
fixed in the migration before this table was finalized, not worked around
in application code.

# Phase 7: Subject Workspace classroom scoping (UI/routing only — no schema change)

Pure UI/routing/service-scoping change — no migration, no RLS change. A
subject linked to multiple classrooms (subject_classrooms, 0002) was, until
now, presented as one merged workspace (Students/Attendance/Grades all
showing every linked classroom's data at once). This phase makes the
subject workspace classroom-scoped end to end, matching how the rest of
the app already treats "which classroom" as the thing a teacher picks
first, everywhere else.

New route: `/teacher/subjects/:subjectId/classrooms/:classroomId` (the
classroom-scoped workspace: header + 6 tabs). The existing
`/teacher/subjects/:subjectId` route becomes the root — an overview +
classroom picker (one card per linked classroom, with that classroom's own
student count) that auto-redirects straight into the workspace when the
subject has exactly one linked classroom, since there's no real choice to
present in that case.

Scoping rules, applied identically in real and demo mode:
- **Students, Attendance** — scoped strictly to the selected classroomId;
  never merge another linked classroom's roster. Attendance already had
  this scoping at the database level (0005); this phase only changes which
  classroom the UI hands it, dropping the tab's own internal classroom
  picker in favor of one shared switcher in the workspace header.
- **Topics** — deliberately NOT classroom-scoped. Topics are subject-level
  by design (0002) and stay visible identically regardless of which linked
  classroom is selected — this is unchanged from before this phase.
- **Assignments, Grades** — the real backend for these is still demo-only
  (not migrated); GradesTab's demo implementation now filters which
  student rows are displayed to the selected classroom (assignment
  definitions/submissions remain a subject-wide demo data structure).
  AssignmentsTab (both real's DemoOnlyNotice and demo's card grid) now
  receives `classroomId` as a prop without using it yet, specifically so a
  future real assignments feature — described in a design-note comment on
  `subject-classroom-workspace-page-real.tsx` — can add classroom scoping
  (whole-subject, classroom-subset, or per-classroom due dates) without
  re-plumbing the route or workspace shell.
- **Editing subject↔classroom links** — a new EditSubjectDialog (real and
  demo) lets a teacher link/unlink classrooms and see each one's student
  count. Unlinking a classroom that already has subject-scoped attendance
  recorded (`hasSubjectClassroomAttendance`, subject-service.ts) is
  confirmed first — unlinking never actually deletes that attendance data
  (attendance_sessions references subject_id/classroom_id directly, not
  the subject_classrooms link row, per 0005), so this is a "you won't be
  able to check attendance here again" warning, not a data-loss
  prevention. The same confirm-before-unlink pattern is documented as the
  template for a future assignments/grades safeguard once those become
  classroom-scoped and have real orphanable data.

Shared pure logic (`src/features/subjects-shared/subject-classroom-nav.ts`,
unit-tested): the auto-redirect rule, the "classroomId actually belongs to
this subject" validation the workspace page uses to reject a tampered URL,
the root page's classroom-count/student-count summary, and the canonical
workspace URL builder — used verbatim by both real and demo mode so the
picker/redirect/summary behavior can never drift between them.
