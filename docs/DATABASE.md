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

# Phase 8: Default theme, remove global Assignments workspace, subject+classroom-scoped assignments (0006)

Three changes, described together because they were requested and shipped
as one refactor, but independent of each other (no dependency between the
theme fix and the assignment-model change).

## Default theme = light

`src/lib/theme.ts`'s `getStoredTheme()` previously fell back to the
browser's `prefers-color-scheme` when nothing was stored yet
(`systemPrefersDark()`). That meant a first-time visitor on a machine set
to dark mode silently opened the app in dark mode with no explicit choice
ever made. Fixed by defaulting unconditionally to `'light'` when
`localStorage` has no stored `'ai-classroom-theme'` value; an explicit
prior choice (light or dark) is still restored exactly as before, and the
toggle/persistence mechanism (`applyTheme`, the theme button) is
unchanged. `systemPrefersDark()` was removed as now-unused. Covered by
`src/lib/theme.test.ts` (first-visit-defaults-to-light, restores stored
dark/light, corrupt value falls back to light, SSR guard, persistence
across a simulated refresh) using `vi.stubGlobal` mocks — this project has
no jsdom/@testing-library installed, so component/DOM-touching logic is
tested this way rather than via rendering.

## Remove the global, classroom-less Assignments workspace

The old `/teacher/assignments` sidebar item and page (`assignments-page.tsx`,
`src/demo/legacy` `state.assignments`/`state.students` slice) let a
teacher manage assignments with no subject or classroom context at all —
architecturally incompatible with assignments now being scoped to a
specific subject+classroom pair (see below). Removed from
`src/components/layout/nav-items.ts`; the route now renders
`AssignmentsRedirectPage`, which shows "กรุณาเลือกรายวิชาและห้องเรียนก่อน"
and a button back to `/teacher/subjects`, rather than 404ing or silently
showing the old ungoverned workspace to anyone with the URL bookmarked.
The old page file and its supporting `demo-assignments/` components are
left in place, unreferenced (not deleted), per the "don't delete reusable
UI logic" instruction — though in practice the *subject-scoped* demo
assignment components (`demo-subjects/tabs/assignments-tab.tsx`,
`demo-subjects/assignment-dialog.tsx`) were what got reused/adapted for
classroom scoping, not the legacy flat ones. Tested by
`nav-items.test.ts` (no sidebar entry pointing at the old route, still
links to Subjects) and `assignments-redirect-page.test.ts` (redirect copy
and target).

## Subject + classroom-scoped assignments (`0006_subject_assignments.sql`)

**Status: written and empirically RLS-verified locally, but NOT applied to
the Supabase project — requires a manual run in the Supabase SQL Editor.**

Assignments are now managed from inside the subject workspace's งาน tab
(`/teacher/subjects/:subjectId/classrooms/:classroomId`, tab `assignments`)
instead of a separate top-level page. An assignment always belongs to
exactly one `(subject_id, classroom_id)` pair — never a subject-wide
thing. Two classrooms linked to the same subject get completely
independent assignment sets, even when a title matches between them (e.g.
DS's ม.5/1 and ม.5/2 can both have a "Worksheet 1" — two unrelated rows).

Two new tables, following the same shape as every prior academic-data
migration in this project:

- **`assignments`** — `subject_id`/`classroom_id` (both required, `on
  delete cascade`), `topic_id` (optional, `on delete set null` — an
  assignment may reference a subject topic but topics stay subject-wide
  per Phase 7), `title`, `description`, `max_score` (`> 0`), `due_date`,
  `is_archived` (no hard delete — same no-DELETE-policy convention as
  every other academic-data table in this schema), `created_by`,
  timestamps.
- **`assignment_submissions`** — one row per `(assignment_id, student_id)`
  (unique constraint), `status` (`not_submitted` / `submitted` / `late` /
  `missing`), nullable `score` (`>= 0`), `note`, timestamps.
  `student_id` references `students.id` directly — **not**
  `classroom_students.id` — for the same reason as `attendance_records`
  (0004): `classroom_students` rows are ephemeral (deleted/replaced when a
  student is removed from or moved between classrooms), so a cascade FK to
  that row would silently destroy submission/score history on a routine
  membership change. Classroom membership is instead checked only at
  INSERT time via a direct `classroom_students` lookup inside the RLS
  policy — never re-checked on UPDATE, so a teacher can still correct a
  submission after the student has since left the classroom.

RLS (`assignments`): `assignments_select_own` (owner via
`classroom_id` → `classrooms.teacher_id`); `assignments_insert_own` — the
same 4-part ownership+link check pattern introduced in Phase 6
(`attendance_sessions_insert_own`): own the classroom AND own the subject
AND a `subject_classrooms` row actually links them AND `created_by =
auth.uid()`; `assignments_update_own` (ownership only — an assignment's
`subject_id`/`classroom_id` are immutable after creation, there is no
"reassign to another classroom" path). No delete policy.

RLS (`assignment_submissions`): `assignment_submissions_select_own` /
`..._insert_own` (ownership via the parent assignment's classroom, plus
the INSERT-time-only membership check described above) /
`..._update_own` (ownership only, no membership re-check). No delete
policy.

**No RPC.** Every prior write-heavy migration in this project (0004, 0005)
added a `SECURITY DEFINER` RPC because a whole attendance session's worth
of records had to be saved atomically alongside creating/reusing the
parent session row. Assignments don't have that shape: an assignment
already exists persistently before any submission is touched, and each
submission edit (`setSubmissionStatus`/`setSubmissionScore`/
`setSubmissionNote` in `assignment-service.ts`, all plain
`.upsert(..., {onConflict: 'assignment_id,student_id'})` calls) is
independently authorized with no shared parent write that needs
all-or-nothing semantics — RLS alone is sufficient. `bulkSetSubmissionStatus`
(used by "mark all as submitted") is a client-side `Promise.all` of those
same independent upserts, not a batch RPC — a partial failure only affects
the specific student(s) it applies to, which is the correct behavior here
(unlike an attendance session, there's no single row whose existence all
the writes depend on).

Empirically verified against a throwaway local Postgres 16 instance (same
`auth` schema shim as every prior phase), fixtures: teacher A owns
classroom A1 (linked to their subject) and classroom A2 (initially
unlinked) plus 3 students; teacher B owns a separate classroom, subject,
and student.

| # | Scenario | Result |
|---|---|---|
| 1 | Create an assignment scoped to a linked classroom | PASS |
| 2 | Create scoped to an unlinked classroom (own, but not linked to the subject) | PASS — rejected, RLS denial |
| 3 | Cross-owner classroom id spoof | PASS — rejected |
| 4 | Cross-owner subject id spoof | PASS — rejected |
| 5 | `created_by` spoofed to another user | PASS — rejected |
| 6 | Cross-classroom isolation — link A2 too, create a same-titled assignment there | PASS — each classroom's query returns only its own row; no merge |
| 7 | Submission for a student who is a current classroom member | PASS |
| 8 | Submission for a student who is NOT a member of the assignment's classroom | PASS — rejected |
| 9 | Upsert on conflict (same assignment+student twice) | PASS — updates in place, no duplicate row |
| 10 | Correct a submission after the student has since left the classroom | PASS — UPDATE path doesn't re-check membership |
| 11 | Archive via UPDATE (`is_archived = true`) | PASS — submission history preserved, no data loss |
| 12 | Cross-owner read denial | PASS — 0 rows visible |
| 13 | Anonymous read denial | PASS — 0 rows visible |
| 14 | Unauthorized direct UPDATE by another teacher | PASS — 0 rows affected |

No security-critical FAIL. Local test database dropped and the throwaway
Postgres cluster stopped after verification, per this project's standing
cleanup discipline — nothing from the verification run was committed.

The demo-mode assignment model (`src/demo/types.ts`'s
`DemoSubjectAssignment`) was extended with the same `classroomId`/
`isArchived` scoping to keep demo and real behavior identical: previously
a subject's assignments/submissions were seeded and read from a single
subject-wide list, actually merging submissions across every classroom
linked to that subject (a real bug, matching what this migration's design
fixes for the real backend) — `getAssignmentsForClassroom`
(`src/demo/subject-selectors.ts`) now scopes every tab's assignment data
the same way `getAssignments(subjectId, classroomId)` scopes the real
query. The demo seed data (`buildInitialSubjectAssignments`,
`src/demo/subjects.ts`) deliberately includes a same-titled assignment
("ใบงานเรื่องแรง") independently in both of the science subject's linked
classrooms, to make the classroom-isolation fix concretely demonstrable
and regression-tested (`subjects.test.ts`, `subject-selectors.test.ts`).

# Phase 9: Topics tab removed from the workspace, real Grades (derived, no new table), score upper-bound trigger (0007)

## Topics tab removed from the Subject-Classroom workspace (UI only — no schema change)

The หัวข้อ (Topics) tab and the "หัวข้อที่เกี่ยวข้อง" field on the
create/edit Assignment dialog were removed from both
`subject-classroom-workspace-page-real.tsx` and
`-demo.tsx` to simplify the day-to-day workspace down to ภาพรวม /
นักเรียน / เช็คชื่อ / งาน / คะแนน. This is a UI-only change:

- The `topics` table, its RLS policies, `topic-service.ts`, and the
  `TopicsTab` components (`subjects-real/tabs/topics-tab.tsx`,
  `demo-subjects/tabs/topics-tab.tsx`) are all untouched and left in
  place, unreferenced from the workspace — same "leave it for possible
  future use, don't delete" treatment as the old flat Assignments page in
  Phase 8. No migration was written or needed for this.
- `assignments.topic_id` (0006) is untouched. The Assignment dialogs no
  longer expose a topic picker, but an existing assignment's `topicId` is
  preserved exactly as-is on edit (the dialogs simply omit `topicId` from
  their update payload, and `updateAssignment`/demo's
  `updateSubjectAssignment` only ever patch fields that are actually
  present); a newly created assignment just has no topic (`null`).
- Overview's own "หัวข้อ" stat card (a topic *count*, unrelated to the
  removed tab) is untouched — still subject-wide by design (Phase 7).

Covered by `subject-classroom-workspace-page.test.ts`, which exports each
workspace page's `TABS` array specifically so the exact tab set — and
that Topics is gone from both real and demo — is unit-testable without
rendering (this project has no jsdom/@testing-library, see Phase 8's note).

## Real Grades — a derived view, not a new table

Grades were migrated from demo-only data to a real, Supabase-backed
`คะแนน` tab (`subjects-real/tabs/grades-tab.tsx`), exactly matching the
"Future relationship" note at the bottom of `0006_subject_assignments.sql`:
**there is no `grades` table.** A grade is just `assignment_submissions.score`,
read back through the lens of one subject+classroom's `assignments`.
Everything else — the student × assignment matrix, each student's total,
"possible" denominator, percentage, and the class average/highest/lowest
— is computed live in `assignment-service.ts` (`computeGradeRows`,
`computeClassGradeStats`) from data the Grades tab already fetched with
`getAssignments`/`getSubmissions`/`getStudentsByClassroom`, and is never
persisted anywhere. This mirrors how a subject's roster and attendance
summaries are already derived rather than stored elsewhere in this schema.

**Total/possible/percentage semantics** (matches the worked example given
when this phase was scoped — a classroom with ใบงาน 1 (/10), Quiz 1 (/20),
Project (/30) where one student has all three graded and another has
Quiz 1 still ungraded):

- `total` = sum of only this student's **graded** scores.
- `possible` = sum of **every** assignment's `max_score` in this
  classroom, whether or not it's graded yet for this student — the same
  fixed denominator for every student. An ungraded assignment still
  counts toward what's possible; it just hasn't been earned. This is why
  a student with Quiz 1 still blank shows e.g. `36/60`, not `36/40` — the
  30 total from the visibly blank cell has been actually earned; the 60
  denominator is not the sum of only the two graded assignments (10+30)
  but of all three assignments in the classroom (10+20+30).
- `percentage` = `total / possible * 100`, or `null` only when the
  classroom has no assignments at all (avoids a divide-by-zero — a
  student with every assignment still ungraded gets `0%`, not `null`,
  since `possible` is still positive).
- `classAverage`/`highest`/`lowest` are the average/max/min of every
  student's `percentage` — recomputed on every render from
  `computeGradeRows`' output, never cached or written back.

**Score entry and the submission-to-graded transition.** Entering a score
writes straight to `assignment_submissions.score` via the same
`setSubmissionScore` the assignment detail page already used — a score
entered in the Grades tab shows up on the assignment detail page
immediately (and vice versa), because both call the exact same service
function against the exact same row; there is no second, competing grade
record to keep in sync. `setSubmissionScore` was extended to take the
submission's current status and, via the new pure `nextStatusAfterScore`
helper, auto-promote an untouched `not_submitted` row to `submitted` the
moment a real score is recorded — a score sitting next to a
"not_submitted" status would be a confusing, self-contradictory state.
An explicit `late`/`missing`/`submitted` call a teacher already made is
never silently overwritten by this (only the `not_submitted` default
transitions), and clearing a score back to blank never moves status
backwards either — "ungraded yet" and "not submitted" are different
questions. The same rule was mirrored into demo mode's
`setSubmissionScore` (`demo-context.tsx`) so demo and real behave
identically here.

**Score validation** (`parseScoreInput`, `assignment-service.ts`):
`0 <= score <= assignment.max_score`; a blank entry is always valid and
means "not submitted" or "submitted but not graded yet" — never an
error, and exactly how a teacher clears a previously entered score. An
out-of-range or non-numeric entry is rejected with a toast and the input
reverts to its last saved value (a `resetTick` counter forces the
otherwise-uncontrolled score `<input>` to remount even when the saved
value itself didn't change). Both the Grades tab and the assignment
detail page use this same validator.

**Classroom/assignment isolation** is inherited entirely from
`getAssignments(subjectId, classroomId)`'s existing exact-match scoping
(Phase 8) — the Grades tab never fetches or displays another linked
classroom's assignments or submissions, and `computeGradeRows` only ever
iterates the `assignments` array its caller already scoped this way (a
stray submission keyed to a foreign assignment id is simply never looked
at — see the "classroom isolation" test in `assignment-service.test.ts`).

## Security review of 0006 RLS for the Grades feature — PASS, with one WARNING addressed by 0007

Grades introduces no new query shape and no new table: it reads via the
existing `getAssignments`/`getSubmissions` and writes via the existing
`setSubmissionScore`, all governed by 0006's already-verified RLS
policies (`assignments_select_own`, `assignment_submissions_select_own`/
`_insert_own`/`_update_own` — see Phase 8's 14-scenario empirical
verification table, unchanged by this phase). Concretely, for Grades:

- A teacher can only ever see assignments/submissions for classrooms they
  own (`assignments_select_own`, `assignment_submissions_select_own`).
- A brand-new submission row can only be created for a student who is a
  CURRENT member of that assignment's classroom
  (`assignment_submissions_insert_own`) — a cross-classroom or foreign
  student score write is rejected the same way it already was for the
  assignment detail page (Phase 8, scenario 8).
- Correcting an already-recorded score never re-checks membership
  (`assignment_submissions_update_own`, ownership-only) — intentional,
  same as Phase 8, so a score can still be fixed after a student changes
  classrooms.
- No new RLS was written or needed for this — **0006 already fully
  covers Grades' read/write shape**, so per this phase's instructions, no
  new RLS migration was created.

**WARNING found and addressed:** `assignment_submissions.score` had
`check (score is null or score >= 0)` (0006) but no upper bound against
the assignment's own `max_score` — that bound was enforced ONLY in the
UI (`parseScoreInput`). A `check()` constraint can't reference another
table's column, so nothing in the database stopped a teacher's own valid
session from writing an out-of-range score for their own data by calling
the Supabase API directly, bypassing the form. This is not an
authorization bypass (RLS still fully restricts the write to the
submission's owning teacher; a teacher can only mis-grade their own
students, not touch anyone else's data) but is a real data-integrity gap
worth closing. **`supabase/migrations/0007_assignment_score_bound.sql`**
adds a `before insert or update` trigger on `assignment_submissions` that
looks up the row's assignment's `max_score` and rejects the write if
`score > max_score` — written and reviewed, **NOT applied** (per this
phase's instructions: create for review, don't apply automatically).

**Overall verdict: PASS.** No cross-classroom, cross-subject, or foreign-
student score write is possible under 0006 as it stands; the one
WARNING was a same-teacher data-integrity gap, not an authorization
issue, and a fix is staged in 0007 pending a manual apply.

# Phase 10: Student Portal Phase 1 — account linking + teacher approval (0008)

**Status: `supabase/migrations/0008_student_account_links.sql` written and
empirically verified (14+ adversarial scenarios, all PASS), NOT applied.**

Scope, explicitly bounded per this phase's instructions: a student gets
their own Supabase Auth account, separate from the `students` row a
teacher already created for them; they REQUEST to be linked to that row
by entering their student_code; a teacher who actually teaches that
student approves or rejects the request; only approval ever establishes
the permanent link. No auto-link by student_code anywhere. No Student
Dashboard yet — an approved student sees a stub "your account is linked"
message and nothing else. This phase does not touch Grades or
Assignments.

## Schema

- **`students.linked_profile_id`** (new column, nullable `uuid
  references profiles(id) on delete set null`) — the permanent link.
  Guarded by a new `protect_students_linked_profile_id` BEFORE UPDATE
  trigger (see "RLS-recursion and trigger-bypass findings" below) so it
  can only ever be set by `approve_student_link_request`, never by a
  teacher's normal `UPDATE students ...` (which the existing
  `students_update_via_classroom` policy from 0001 would otherwise allow
  for any column, including this one). A partial unique index
  (`where linked_profile_id is not null`) enforces "one auth account =
  maximum one approved student"; "one student = maximum one approved
  account" is structurally true (a single column can only hold one value).

- **`student_account_link_requests`** (new table) — one row per request,
  never per student (a student may have a rejected-then-retried history,
  all kept, no hard delete). Columns: `id`, `student_id`, `requested_by`
  (the requesting profile), `status` (`pending`/`approved`/`rejected`),
  `reviewed_by`, `reviewed_at`, `review_note`, `created_at`, `updated_at`.
  Deliberately does NOT store `classroom_id` — which teacher(s) can see
  and act on a request is derived live from the student's CURRENT
  `classroom_students` membership at query/RPC time, the same
  recompute-don't-snapshot choice as `students_select_via_classroom`
  (0001). Two partial unique indexes: at most one `pending` row per
  `requested_by` (a student can't spray requests at multiple targets at
  once) and at most one `pending` row per `student_id` (two accounts
  can't both have a live claim on the same student, avoiding an
  ambiguous review queue).

## RLS

- **`student_account_link_requests_select_own_or_teacher`** — a student
  sees their own request history; a teacher sees requests for students
  currently in one of their own classrooms (derived via
  `classroom_students`/`classrooms`, same pattern as every other
  ownership check in this schema).
- **`student_account_link_requests_select_admin`** — mirrors
  `classroom_students_insert_admin` (0001): an admin sees every request,
  independent of classroom ownership, so the RPC-level admin override
  below isn't paired with a dead end where an admin can approve a request
  they have no way to find in the first place.
- **`student_account_link_requests_insert_own`** — SECURITY-CRITICAL: a
  student may insert a request only for themselves
  (`requested_by = auth.uid()`), only with `status = 'pending'` and
  `reviewed_by`/`reviewed_at` both null (closes a direct
  self-approval-by-forged-insert path — see battery scenario 2b below),
  only as a `role = 'student'` profile, and only against a target that
  `student_link_target_valid` (a SECURITY DEFINER helper, same
  bootstrapping-problem fix as `is_student_creator` in 0001) confirms
  exists and isn't already linked.
- **No UPDATE policy, no DELETE policy, for ANY role.** This is the
  literal enforcement of "students must never be able to approve
  themselves": there is categorically no client-reachable path, for
  anyone, that can ever transition a request's status. The only two ways
  a request changes are the two SECURITY DEFINER RPCs below, each of
  which re-verifies authorization itself in PL/pgSQL rather than leaning
  on a declarative RLS policy.
- **`profiles_select_via_link_request`** (new, additive to
  `profiles_select_own` from 0001) — lets a teacher see the identity
  (email/display name) of an account that has requested to link to one
  of their own students, via the `teacher_can_view_link_requester`
  helper (see below). No broader "teachers can browse all profiles"
  access is introduced.

## RPCs / functions

- **`student_link_target_valid(student_id)`** — SECURITY DEFINER
  boolean helper (student existence + unclaimed check), the standard fix
  for the same "caller has no SELECT visibility into the table being
  checked" bootstrapping problem `is_student_creator` solved in 0001.
- **`teacher_can_view_link_requester(profile_id)`** — SECURITY DEFINER
  boolean helper backing `profiles_select_via_link_request`. Its
  existence is itself the direct result of an empirical finding — see
  next section.
- **`find_student_for_link(student_code)`** — the secure minimal lookup
  RPC: exact `student_code` match only (no name search), requires an
  authenticated `role = 'student'` caller, returns only
  `(student_id, first_name, last_name)` — never `student_code`, email,
  phone, or any other column — silently excludes already-linked
  students rather than revealing "that code exists but is taken," and
  raises rather than guessing when a code ambiguously matches more than
  one unlinked student (`student_code` is not unique in this schema —
  see 0001's "student_code duplicate strategy").
- **`approve_student_link_request(request_id)`** /
  **`reject_student_link_request(request_id, note)`** — SECURITY
  DEFINER, deliberately NOT the SECURITY INVOKER choice
  `create_student_and_enroll` (0001) made, because there is intentionally
  no RLS UPDATE policy for these to lean on — each re-verifies caller is
  teacher/admin, owns a classroom containing the target student (or is
  admin), locks the row (`for update`) to close a concurrent-approval
  race, and — approve only — re-checks the target isn't already linked
  and the requester doesn't already have an approved student elsewhere,
  then sets `students.linked_profile_id` and the request's status in the
  same transaction. Approving also auto-rejects any other stray pending
  request from the same requester (they could never be approved anyway
  once one is granted). Bulk approve is a client-side
  `Promise.allSettled` loop over this single RPC (same pattern as
  `assignment-service.ts`'s `bulkSetSubmissionStatus`), not a dedicated
  SQL bulk function — one ineligible request must never block the rest.

## RLS-recursion and trigger-bypass findings (both fixed before this migration was finalized)

Empirical verification against a local Postgres 16 instance (same `auth`
schema shim used throughout this project) surfaced two real, non-obvious
bugs that a purely written-not-tested migration would have shipped:

1. **A `profiles` SELECT policy referencing `classroom_students` broke
   an unrelated, pre-existing statement.** The first draft of
   `profiles_select_via_link_request` queried
   `student_account_link_requests` → `classroom_students` → `classrooms`
   directly. The moment that policy existed, ANY `insert into
   classroom_students` anywhere in the app — including the
   already-working 0001 flow, confirmed by reproducing on a
   0001–0007-only database where it works fine — started failing with
   `infinite recursion detected in policy for relation
   "classroom_students"`, even though nothing in
   `classroom_students_insert_own`'s own policy text mentions `profiles`.
   Root cause not fully resolved theoretically, but empirically
   confirmed and fixed the same way `is_student_creator`/
   `has_existing_classroom_link` (0001) already fix this exact class of
   problem: wrapping the check in a narrowly-scoped SECURITY DEFINER
   function (`teacher_can_view_link_requester`) instead of a raw
   cross-table subquery inline in the policy. Verified fixed by
   reproducing the failure, applying the fix, and confirming the same
   `classroom_students` insert then succeeds.
2. **`current_setting('role', true) = 'authenticated'`, the guard
   `protect_profile_privileged_fields` (0003) uses, does NOT distinguish
   a SECURITY DEFINER caller from a normal client request** — verified
   directly: a minimal SECURITY DEFINER function was confirmed to still
   report `current_setting('role', true) = 'authenticated'` internally
   (SECURITY DEFINER does not do a `SET ROLE`-equivalent change to the
   `role` GUC), while `current_user` DOES change to the function's owner
   for the duration of the call. Had `protect_students_linked_profile_id`
   copied 0003's exact guard expression, it would have silently blocked
   `approve_student_link_request`'s own UPDATE, breaking every approval.
   Fixed by using `current_user = 'authenticated'` instead, empirically
   confirmed to correctly allow the RPC's internal UPDATE while still
   blocking a direct client UPDATE attempt (battery scenario 6a). This is
   now documented inline in the migration as the deliberate, verified
   reason the two triggers in this schema use different guard
   expressions for what looks like the same purpose.

## Empirical RLS/RPC verification — PASS (all scenarios)

Fixtures: two teachers (A, B) each with one classroom and students of
their own (including a same-`student_code` pair across teachers, to
exercise the ambiguous-lookup case); three student portal accounts
signed up through the real `handle_new_user` trigger path (`auth.users`
insert with `intended_role` metadata, not hand-inserted profile rows);
two adversarial signups requesting `intended_role: 'admin'` and garbage
values.

| # | Scenario | Result |
|---|---|---|
| 1 | Signup requesting `intended_role: 'admin'` or garbage | PASS — both landed as `role = 'teacher'` (the safe default), never 'admin' |
| 2 | `find_student_for_link` — exact match | PASS — returns id/first/last name only |
| 3 | `find_student_for_link` — not found | PASS — empty result |
| 4 | `find_student_for_link` — ambiguous code (two unlinked students share it) | PASS — rejected with a clear error, no row guessed |
| 5 | `find_student_for_link` — called by a teacher account | PASS — rejected, role check |
| 6 | `find_student_for_link` — anonymous | PASS — rejected |
| 7 | `find_student_for_link` — target already linked | PASS — excluded from results |
| 8 | Submit a valid pending request | PASS |
| 9 | **Self-approval via forged INSERT** (`status: 'approved'`, `reviewed_by: self`) | PASS — rejected by WITH CHECK |
| 10 | Second pending request from the same account while one is pending | PASS — rejected, unique index |
| 11 | Competing pending request for the same target student from a different account | PASS — rejected, unique index |
| 12 | Forging `requested_by` to another account | PASS — rejected |
| 13 | A teacher account submitting a request | PASS — rejected, role check |
| 14 | **Student direct UPDATE to `status: 'approved'` on their own request** | PASS — 0 rows affected (no UPDATE policy) |
| 15 | **Owning teacher's direct UPDATE instead of the RPC** | PASS — 0 rows affected (RPC is the only path, even for the legitimate teacher) |
| 16 | Cross-teacher SELECT visibility | PASS — Teacher B sees 0 rows for Teacher A's student |
| 17 | Wrong teacher approves a REAL, known, still-pending request id | PASS — rejected "คุณไม่มีสิทธิ์อนุมัติคำขอของนักเรียนคนนี้" (not merely "not found") |
| 18 | Anonymous caller approves | PASS — rejected |
| 19 | Legitimate approval by the owning teacher | PASS — `students.linked_profile_id` set correctly |
| 20 | Re-approving an already-approved request | PASS — rejected, not pending |
| 21 | **Direct `UPDATE students SET linked_profile_id = ...`** by the owning teacher, bypassing approval entirely | PASS — rejected by `protect_students_linked_profile_id` |
| 22 | Already-approved account submits a second request for a DIFFERENT student (allowed to sit pending) | PASS — insert succeeds |
| 23 | ...then that second request is approved | PASS — rejected at approval time, "บัญชีนี้เชื่อมกับนักเรียนคนอื่นไปแล้ว" |
| 24 | Rejection with a note, then retry after rejection | PASS — `linked_profile_id` untouched by rejection; retry succeeds since the old row is `rejected`, not `pending` |
| 25 | Teacher visibility into the requester's profile (email/display name) | PASS — visible only once a request ties that profile to one of the teacher's own students; an unrelated profile stays invisible |
| 26 | Student account (now approved/linked) reads `students` directly | PASS — 0 rows; the table stays fully closed to student accounts even after linking |
| 27 | Admin approves a request for a student in a classroom the admin doesn't own | PASS — admin override works, mirrors `classroom_students_insert_admin` |
| 28 | Student attempts self-escalation to `role = 'admin'` via direct `profiles` UPDATE | PASS — rejected by 0003's existing `protect_profile_privileged_fields`, confirmed unaffected by this phase |

**Overall verdict: PASS.** No scenario allowed a student to approve their
own request, approve another account's request, read the `students`
table, or escalate role. The two findings above were real bugs in the
first draft, not merely defense-in-depth — both are fixed in the
migration as committed, and both fixes are verified, not just argued.

## Frontend

- **`src/lib/auth-context.tsx`** — `SignUpInput` gains an optional
  `intendedRole?: 'student'` field (type-restricted to that one literal,
  so there's no way to even attempt requesting anything else through
  this code path).
- **`src/components/auth/protected-route.tsx`** (`/teacher/*`) — now
  also waits for `profile` to load (not just `user`) before rendering,
  and redirects a `role = 'student'` session to `/student/pending`. This
  is a deliberate UX tradeoff over the pre-Student-Portal version (which
  rendered as soon as `user` was set): a student must never even briefly
  see the `/teacher/*` shell.
- **`src/components/auth/student-protected-route.tsx`** (new) — the
  `/student/link-account` and `/student/pending` equivalent; requires a
  session, does not redirect a teacher account away (RLS already makes
  every write there meaningless for one).
- **`src/services/student-link-service.ts`** (new) — thin client for
  every RPC/table above, plus `deriveMyLinkStatus` (pure: picks the most
  recent request from a student's own history to decide what
  `/student/login` and `/student/pending` show — unit tested).
- Pages: `/student/login`, `/student/signup`, `/student/link-account`,
  `/student/pending`; teacher-side `/teacher/student-link-requests`
  (pending queue, approve/reject with an optional note, bulk approve),
  added to the sidebar.

# Phase 11: Classroom-scoped student account-linking lookup (0009)

## Problem

Live on production: entering a real, valid student_code on
`/student/link-account` (e.g. `04103`) returned "พบรหัสนักเรียนนี้มากกว่าหนึ่งคน"
("this code matches more than one person") and blocked linking entirely.
Root cause: `student_code` is deliberately NOT unique across the whole
`students` table (0001's "student_code duplicate strategy" — each
teacher numbers their own roster independently), but 0008's
`find_student_for_link(student_code)` matched on `student_code` ALONE
against the entire table. Any code that happened to repeat across two
classrooms — normal, expected, not a data-quality bug — made that RPC
raise its ambiguity error for every student sharing it, a permanent dead
end, not just a rare edge case.

The fix is **not** a `student_code` uniqueness constraint (rejected, same
reasoning as 0001): identity is scoped to `student_code + classroom`,
which is what actually identifies a student uniquely in this schema.

## Schema

No table/column changes. This migration only adds two new
`SECURITY DEFINER` functions and revokes `EXECUTE` on one existing one —
0008 itself is left completely unmodified (it had already been applied).

## New RPCs

- **`list_classrooms_for_student_code(student_code)`** — backs the new
  classroom selector on `/student/link-account`. Returns
  `(classroom_id, classroom_name)` for classrooms that currently contain
  an **unlinked** student with the given code — never the full classroom
  directory. A student account has zero baseline `SELECT` on
  `classrooms` at all (0001's `classrooms_select_own` is teacher-only),
  so `SECURITY DEFINER` is what lets this narrow, purpose-built query see
  across teachers for this one purpose, same bootstrapping pattern as
  `student_link_target_valid` (0008). Requires an authenticated
  `role = 'student'` caller; empty code or no session raises.
- **`find_student_for_link_in_classroom(student_code, classroom_id)`** —
  replaces `find_student_for_link(student_code)` as the RPC the frontend
  calls. Verifies through `students` → `classroom_students` →
  `classrooms`: a match must be an unlinked student whose `student_code`
  equals the input AND who is currently enrolled in the given
  `classroom_id`. Still refuses to guess — if more than one unlinked
  student in the SAME classroom somehow shares the same code (a
  data-quality edge case; `student_code` was never constrained unique),
  this raises instead of returning an arbitrary match, exactly like
  0008's original guard, just re-scoped to "within this classroom."
  Returns `(student_id, student_code, first_name, last_name,
  classroom_name)` — `student_code` is now safe to echo back (the caller
  already typed it to get here, and it's no longer the whole lookup key
  by itself) — never any other column, never the roster, never the
  teacher.
- **`find_student_for_link(student_code)` (0008) — EXECUTE revoked from
  `authenticated`.** Left in place, unmodified, but no longer callable by
  a normal client session. Kept rather than dropped (smallest possible
  change, fully reversible), but retiring it as a live entrypoint closes
  a real gap: it would otherwise still succeed whenever a code happens to
  be globally unique (most codes — just not the colliding ones), silently
  bypassing the classroom disambiguation this migration exists to
  enforce.

## Information-leak review (classroom selector)

Considered and rejected: listing *every* classroom in the system for the
selector. That would hand any signed-in student account the full
classroom directory — every section name run by every teacher — which is
more than linking requires and not something a student account has any
other way to see. Adopted instead: `list_classrooms_for_student_code`
returns only classrooms that actually contain an unlinked student with
the code just entered — typically one, occasionally a handful for a
colliding code, never the whole school. Fields are capped to
`classroom_id`/`classroom_name`; no `teacher_id`, `is_active`, roster
size, or any other column is exposed by either new RPC.

## Frontend

- **`src/types/student-link-request.ts`** — new
  `StudentLinkClassroomOption { classroomId, classroomName }`;
  `StudentLinkCandidate` gains `studentCode` and `classroomName`.
- **`src/services/student-link-service.ts`** — new
  `listClassroomsForStudentCode`; `findStudentForLink` now takes
  `(studentCode, classroomId)` and calls
  `find_student_for_link_in_classroom`.
- **`src/pages/student/link-account-page.tsx`** — three-step flow: enter
  code → `list_classrooms_for_student_code` → pick a classroom (a single
  match is pre-selected via the pure, unit-tested `pickDefaultClassroom`,
  but the student still confirms explicitly) →
  `find_student_for_link_in_classroom` → confirm name + classroom →
  submit the pending request exactly as before (unchanged: `students`.
  `linked_profile_id` is still only ever set by
  `approve_student_link_request`).

## Empirical verification — PASS (all scenarios)

Same local-Postgres methodology as every prior phase in this document.
Fixtures: two teachers, three classrooms; `student_code "04103"` shared
across two DIFFERENT classrooms (the exact reported bug); `student_code
"99001"` shared by two DIFFERENT students inside the SAME classroom (the
still-ambiguous case that must stay rejected); one already-linked
(claimed) student.

| # | Scenario | Result |
|---|---|---|
| 1 | `list_classrooms_for_student_code("04103")` | PASS — returns both classrooms, id+name only |
| 2 | `find_student_for_link_in_classroom("04103", classroom A)` | PASS — returns only classroom A's student |
| 3 | `find_student_for_link_in_classroom("04103", classroom B)` | PASS — returns only classroom B's student |
| 4 | Same code, WRONG classroom (not enrolled there) | PASS — empty result, no error, no data guessed |
| 5 | Duplicate code inside the SAME classroom ("99001") | PASS — rejected as ambiguous, no row guessed |
| 6 | Already-linked (claimed) student — both RPCs | PASS — excluded from both; 0 rows either way |
| 7 | Return-type introspection | PASS — exactly the documented minimal columns, nothing else |
| 7b | Student account's baseline direct `SELECT` on `classrooms`/`students`/`classroom_students` | PASS — 0 rows each; the RPCs are the only path |
| 8 | Old `find_student_for_link(text)` called directly | PASS — `permission denied`, EXECUTE revoked |
| 9 | Full happy path: submit in classroom A, teacher A approves | PASS — `linked_profile_id` set correctly |
| 10 | Teacher B (wrong teacher) tries to approve a classroom-A request | PASS — invisible via SELECT (0 rows) and rejected by the RPC |

**Overall verdict: PASS.** The reported bug is fixed (a duplicate
`student_code` across classrooms no longer blocks linking), the
still-genuinely-ambiguous case (duplicate code within one classroom)
still correctly refuses to guess, no additional data (roster, teacher,
grades, attendance, assignments) is exposed by either new RPC, and every
Phase 10 protection (no self-approval, no auto-link, one link per
student/account, teacher-owns-classroom required to approve) is
unaffected.

# Phase 12: Production incident — generic permission error on /student/link-account (0010)

## Symptom

In production, after 0009 had been applied, an authenticated account
with `profiles.role = 'student'` entering a valid student code got
`"คุณไม่มีสิทธิ์ดำเนินการนี้"` instead of either succeeding or one of this
schema's own Thai rejection messages.

## Diagnosis

That exact string is not raised by any SQL in this schema — it is
`src/lib/errors.ts`'s **generic fallback** for SQLSTATE `42501`, used
only when the underlying Postgres error message does *not* contain Thai
text (`looksLikeFriendlyMessage`). Every one of this schema's own
`raise exception ... using errcode = '42501'` calls carries a Thai
message and would therefore display verbatim, not the fallback. A raw,
English-language `42501` can only mean a genuine Postgres-native
`permission denied for function ...` — i.e. `EXECUTE` missing on
whichever function was actually invoked.

Empirically confirmed against a byte-for-byte local replay of
0001–0009, applied in order, with a real `authenticated`/`anon` role
split (not a superuser bypass):

| # | Check | Result |
|---|---|---|
| 1 | `role='student'`, EXECUTE correctly granted → `list_classrooms_for_student_code` | PASS — succeeds, minimal columns only |
| 2 | `role='teacher'` caller | PASS — rejected with our own Thai role-guard message (42501, Thai text) |
| 3 | No session (`auth.uid()` null) | PASS — rejected with our own Thai message (28000) |
| 4 | Authenticated but no `profiles` row at all | PASS — rejected with our own Thai message (42501) |
| 5 | Literal Postgres `anon` role | PASS — correctly has no EXECUTE at all (raw Postgres 42501, expected — anon must never reach this RPC) |
| 6 | **Simulated "grant missing"**: revoke EXECUTE on `list_classrooms_for_student_code`, then call as a correctly-roled student | Reproduces the **exact** reported symptom: raw English `permission denied for function list_classrooms_for_student_code` |
| 7 | **Simulated "stale frontend"**: correctly-roled student calls the OLD, 0009-retired `find_student_for_link(text)` directly | Reproduces the **identical** symptom: raw English `permission denied for function find_student_for_link` |

**Conclusion: 0009's SQL, exactly as committed, is correct.** Checks 1–5
rule out all three "logic" hypotheses:
- **Wrong profile role at signup** — ruled out. `handle_new_user`
  (0008) and `src/lib/auth-context.tsx`'s `signUp` both use the
  matching key `intended_role`; a wrong role produces our own Thai
  role-guard message (check 2/4), not the generic fallback.
- **Wrong internal role guard in the RPC** — ruled out for the same
  reason; the guard's own `raise exception` is reached and behaves
  correctly whenever EXECUTE is actually granted.
- **EXECUTE not granted** (check 6) and **frontend calling the
  retired RPC** (check 7) are the only two hypotheses that reproduce the
  reported symptom, and they are **indistinguishable from the error text
  alone** — both are operational (deployment) failure modes, not a code
  defect in 0009.

## Fix (0010, defensive only — 0008 and 0009 are NOT modified)

`supabase/migrations/0010_fix_student_link_rpc_permissions.sql`
re-asserts the exact `REVOKE`/`GRANT` statements 0009 already contains
for `list_classrooms_for_student_code`, `find_student_for_link_in_classroom`,
and the retirement of `find_student_for_link(text)`. `GRANT`/`REVOKE` are
idempotent in Postgres — re-running them is always safe and a no-op if
0009 already landed cleanly. It also prints the current grant state via
`RAISE NOTICE` for visibility when applied through `psql`. **This
migration alone does not fix the symptom if the real cause is a stale
frontend deployment (check 7)** — that requires re-deploying the
frontend from at least commit `40bb590` (the commit that switched the
client from the retired single-argument `find_student_for_link` to
`list_classrooms_for_student_code` / `find_student_for_link_in_classroom`),
not a database change.

## Manual verification query (run directly against production to tell the two apart)

```sql
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p
where p.proname in (
  'list_classrooms_for_student_code',
  'find_student_for_link_in_classroom',
  'find_student_for_link'
)
order by p.proname;
```

If `list_classrooms_for_student_code` / `find_student_for_link_in_classroom`
already show `authenticated_can_execute = true`, the database is
provably fine and 0010 will change nothing — the incident is a frontend
deployment issue. If either shows `false`, 0010 is required.

## Regression test (new — not a migration, not applied automatically)

`supabase/tests/0009_student_link_rpc_permissions.sql` — a self-contained,
re-runnable script (own fixtures, own cleanup) that exercises exactly
the scenarios above (student succeeds with minimal data; teacher/
anonymous/no-profile/`anon`-role callers stay rejected; `authenticated`'s
exact grant state is asserted) against a disposable local Postgres
instance. Verified twice: passes clean against 0001–0009, and — to prove
it actually catches this class of regression rather than trivially
passing — was re-run against a deliberately broken state (EXECUTE
revoked) where it correctly failed with the exact production error, then
passed again once 0010 was applied on top.

# Phase 13: Production incident — classroom Attendance showed 0 students despite a real 31-student roster

## Symptom

`/teacher/attendance`, for a real classroom with 31 active students
(confirmed correct on the Students/Classroom UI, which reads the same
roster via `getStudentsByClassroom`), showed
`"เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง"` (the generic fallback in
`src/lib/errors.ts`) plus `total = 0` and
`"ยังไม่มีนักเรียนในห้องเรียนนี้"`.

## Diagnosis

`attendance-page-real.tsx` loaded the roster (`getStudentsByClassroom`)
and the saved attendance session (`getAttendance`) as a SINGLE
`Promise.all([...])`. Because `.then()` only runs if BOTH promises
resolve, any failure in `getAttendance` — for any reason — meant
`setStudents(...)` was never called at all, leaving `students` at its
initial `[]` and rendering the exact "no students in this classroom"
empty state, alongside whatever generic error text the thrown error
produced. The roster itself was never the problem; it was silently
discarded by the failure of an unrelated, coupled request.

Empirically verified against a byte-for-byte local replay of 0001–0010
with a real 31-student classroom and real `authenticated`/`anon` roles
(not a superuser bypass) — see `supabase/tests/0004_attendance_roster_and_rls.sql`:

| # | Check | Result |
|---|---|---|
| 1 | Owning teacher — roster query (`classroom_students` → `students`) | PASS — all 31 active students |
| 2 | No attendance session yet for today | PASS — 0 rows, no error (the intended, common "first time" case works correctly) |
| 3 | `save_attendance_session` for all 31 students, defaulting to "มา" | PASS |
| 4 | Re-fetch after save | PASS — exactly 1 session row, 31 records — no duplication |
| 5 | Direct duplicate homeroom-session INSERT (bypassing the RPC entirely) | PASS — rejected by `attendance_sessions_classroom_date_no_subject_uidx`; true duplicates cannot occur via any write path |
| 6 | Unauthorized teacher (does not own the classroom) | PASS — 0 rows across roster, sessions, and records |

**Conclusion: the schema, RLS, RPC, and indexes from 0004/0005 are all
correct and unaffected by 0008/0009/0010** — those later migrations only
ever touch `profiles`/`student_account_link_requests`/the account-link
RPCs; none of `attendance_sessions`'/`attendance_records`' SELECT
policies reference `profiles` or `classroom_students` at all, so there is
no path for the recursion class of bug documented in Phase 10 to reach
this code. The unique index makes a genuine duplicate session
structurally impossible going forward. The root cause is a **frontend
resilience bug**: `getAttendance()`'s `.maybeSingle()` throws (a raw,
non-SQLSTATE PostgREST "multiple rows" error, invisible to
`toFriendlyErrorMessage`'s specific branches) if that invariant is ever
violated for any reason — a legacy row, a not-fully-applied migration
(see Phase 12 for a real prior example of that exact failure mode), or
any future edge case — and `Promise.all` then needlessly took the
already-successful roster load down with it.

## Fix (frontend only — no schema/RLS change)

- **`src/services/attendance-service.ts`**:
  - `getAttendance()` no longer uses `.maybeSingle()` for the session
    lookup. `.order('updated_at', { ascending: false }).limit(1)` picks
    the most recently updated matching session and NEVER throws for
    "more than one row" — it degrades gracefully instead of taking down
    the whole page.
  - New pure `buildRecordsForRoster(activeStudentIds, attendance)` —
    `attendance: null` (a failed/pending lookup) is treated exactly like
    "no session saved yet": every active student still defaults to "มา".
- **`src/pages/teacher/attendance/attendance-page-real.tsx`** and
  **`src/features/subjects-real/tabs/attendance-tab.tsx`** (same bug,
  same fix — both call `getAttendance` the same way): the roster fetch
  and the attendance-session fetch are now two INDEPENDENT requests, not
  a combined `Promise.all`. The roster renders — with every active
  student defaulted to "มา" — as soon as `getStudentsByClassroom`
  resolves, regardless of whether the attendance-session lookup
  succeeds, fails, or is still in flight. A failed attendance lookup
  surfaces as a separate, non-blocking warning
  (`attendanceWarning`/`text-warning-foreground`) instead of blanking
  the roster. Saved statuses still win over the "มา" default the moment
  the lookup does succeed — reopening an already-saved day is unchanged.

## Is a new migration required?

**No.** Every schema/RLS/RPC/index check above passed against a clean
0001–0010 replay; nothing here needed to change on the database side.
This is recorded for completeness (per the standing "determine root
cause before touching schema" rule this project follows), not because a
migration was skipped that should have run.

## Regression test (new — not a migration, not applied automatically)

- **`supabase/tests/0004_attendance_roster_and_rls.sql`** — the
  six database-level checks in the table above, self-contained
  (own fixtures, own cleanup), re-runnable against a disposable local
  Postgres instance.
- **`src/services/attendance-service.test.ts`** — new
  `buildRecordsForRoster` suite: the literal reported scenario ("31
  students + no session yet -> roster renders 31, not 0"), the actual
  regression case ("31 students + the attendance lookup THREW -> still
  31, never 0"), an existing-session case (saved statuses win),
  classroom switch and date switch (no cross-contamination between
  independent loads), archived/moved-student behavior (composes
  correctly with the existing, already-tested `deriveAttendanceRoster`),
  and the legitimate "0 students" case kept distinct from the bug's "0
  students because a request failed" case.

# Phase 14: Teacher navigation consolidation — one entry point per workflow

## What changed (UI/routing only — no schema, no RLS, no migration)

`/teacher/attendance` was the last standalone, classroom-less top-level
page — `/teacher/assignments` and `/teacher/grades` were already
redirect-only as of Phase 8/9. It now gets the identical treatment:

- **`src/components/layout/nav-items.ts`** — "Attendance" removed from
  the sidebar. Final sidebar (9 items): Dashboard, ห้องเรียน, Students,
  Subjects, คำขอเชื่อมบัญชีนักเรียน, Reports, AI Assistant, Integrations,
  Settings.
- **`src/pages/teacher/attendance/attendance-redirect-page.tsx`** (new) —
  same shape as `assignments-redirect-page.tsx`/`grades-redirect-page.tsx`:
  catches anyone with the old `/teacher/attendance` URL bookmarked and
  points them at `/teacher/subjects` → เช็คชื่อ tab. `attendance-page.tsx`
  and its `-real`/`-demo` implementations are left in place, unreferenced
  from the router — same treatment already given to the old
  `assignments-page.tsx`/`grades-page.tsx`. Nothing about
  `attendance_sessions`/`attendance_records`/`save_attendance_session`/
  `attendance-service.ts` changes; the เช็คชื่อ tab already runs on the
  exact same backend.
- **`src/components/dashboard/quick-actions.tsx`** and
  **`attendance-overview.tsx`** — their เช็คชื่อ/เพิ่มคะแนน/เพิ่มงาน
  shortcuts now link straight to `/teacher/subjects` instead of the
  deprecated `/teacher/attendance`/`/teacher/grades`/`/teacher/assignments`
  routes, so a Dashboard click no longer bounces through a redirect page
  first.

## Duplication audit — findings

- **Classroom roster (`classroom-students-tab.tsx`) vs. global Students
  page**: both call the exact same `student-service.ts` mutations
  (`updateStudent`, `archiveStudent`, `removeStudentFromClassroom`,
  `moveStudentToClassroom`) — no duplicated mutation logic anywhere.
  Intentional overlap: one is "all of this teacher's students," the
  other is "this classroom's roster," and both need to edit/move/archive
  from wherever the teacher happens to be looking at a student.
- **Subject workspace's นักเรียน tab (`subjects-real/tabs/students-tab.tsx`)
  vs. global Students**: read-only (view a student in a drawer, no
  add/edit/move/archive at all) — reads via the same
  `getStudentsByClassroom`, no separate roster table, no duplicated
  mutation path. Legitimate, narrower "who's in this classroom, in the
  context of this subject" view.
- **Dashboard quick actions** — was the one real duplicate-*route*
  problem (see above); fixed by repointing at `/teacher/subjects`
  directly. The three labeled shortcuts (เช็คชื่อ/เพิ่มคะแนน/เพิ่มงาน) do
  still land on the same Subjects hub — an intentional, accepted overlap
  now that none of the three have their own classroom-less landing page
  to go to; Subjects has no way to jump straight into a specific tab
  from a URL param today, so this is as consolidated as it gets without
  adding new functionality this task didn't ask for.
- **Old demo routes**: none exist — every real/demo split happens
  *inside* a single route's page component via `dataMode`
  (`attendance-page.tsx`, `subjects-page.tsx`, etc.), never as a
  separate `/demo/...` URL. Nothing to consolidate here.
- **Legacy flat pages** (`assignments-page.tsx`, `grades-page.tsx`,
  `attendance-page.tsx` + its demo/real children): all confirmed
  unreferenced from `router.tsx` (grep-verified); left in place per
  standing "don't delete, just stop linking to it" policy, since their
  demo data plumbing is still reused by the classroom-scoped tabs that
  replaced them.
- **Reports page**: no links to any of the three deprecated routes.

## Current data scope (verified against the schema/services, not just the UI)

- **Attendance**: `attendance_sessions`/`attendance_records`, scoped to
  **classroom + date**, with an *optional* subject_id + period_number —
  `subject_id is null` is the classroom-level homeroom session (what the
  now-removed standalone page wrote); a non-null `subject_id` is a
  subject-period session (what the เช็คชื่อ tab writes). Same table,
  same RPC (`save_attendance_session`), disambiguated by three partial
  unique indexes (0004/0005) — never two different tables.
- **Assignments**: `assignments`/`assignment_submissions`, scoped to
  **subject + classroom** (`subject_classrooms`-linked) — an assignment
  has no meaning outside a specific subject taught to a specific
  classroom (0006).
- **Grades**: not a stored table — a **derived view** computed live from
  `assignments` + `assignment_submissions` for one subject + classroom
  (0006/0007's Grades work), scoped identically to Assignments since
  it's read from the same rows.
- **Students**: `students` is the **global registry** (one row per
  student, independent of any classroom); `classroom_students` is the
  **membership** join (which classroom(s) a student currently belongs
  to). The global Students page and every classroom/subject roster view
  all read through this same pair of tables — there is only ever one
  student record per person, never a per-classroom copy.

## Is a migration required?

**No.** This phase changed zero SQL — no table, no RLS policy, no RPC.
Every fix was routing (`router.tsx`), sidebar (`nav-items.ts`), or a
dashboard shortcut's target URL. `docs/DATABASE.md`'s own standing rule
("do not merge tables merely because menus are consolidated") was
followed by construction: Attendance/Assignments/Grades keep their
existing, already-correct data scopes exactly as documented in Phases
5/6/8/9 — only their *sidebar entry point* changed.
