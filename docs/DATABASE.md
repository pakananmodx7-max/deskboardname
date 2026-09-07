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
