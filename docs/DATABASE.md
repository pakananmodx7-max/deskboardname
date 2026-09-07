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
