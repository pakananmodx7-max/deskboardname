# Database schema

This document explains the schema introduced in
`supabase/migrations/0001_init.sql`, why it's shaped the way it is, and
what's intentionally deferred to a later phase.

## Tables

### `profiles`

One row per authenticated user, mirroring `auth.users`. Holds `role`
(`teacher` / `admin` / `student`) so the rest of the schema and the app's
RLS policies can reason about "is this user a teacher" without touching
the `auth` schema directly.

### `classrooms`

A section taught by one teacher for a given academic year/semester —
e.g. name `ม.5/1`, grade_level `ม.5`, section `1`, academic_year `2569`,
semester `1`. Owned by exactly one teacher via `teacher_id`.

### `students`

A student record identified by `student_code` (a stable external id,
e.g. the school's official student number) — **not** by name. A student
row is standalone: it is not owned by a single classroom or teacher.

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

## Row Level Security (RLS)

RLS is enabled on all four tables. Nothing bypasses it — there is no
service-role key in the client, and no "admin shortcut" policy.

- **`profiles`**: a user may only `select`/`insert`/`update` their own
  row (`id = auth.uid()`).
- **`classrooms`**: a teacher may only `select`/`insert`/`update`/`delete`
  classrooms where `teacher_id = auth.uid()`. There is no shared/admin
  visibility yet.
- **`students`**:
  - `select`/`update` are scoped through `classroom_students` → only
    students who belong to at least one classroom the requesting teacher
    owns are visible.
  - `insert` is allowed for any authenticated user with `role = 'teacher'`
    — a brand-new student isn't linked to any classroom yet at the
    moment it's created, so the classroom-scoped check can't apply to
    the insert itself. It only becomes visible to that teacher once
    linked via `classroom_students`.
- **`classroom_students`**: `select`/`insert`/`delete` all require the
  referenced `classroom_id` to belong to the requesting teacher.

Students do not get any broad read policy in this phase — the schema
only serves the teacher-facing app for now, matching the current UI.

## Reusable `updated_at` trigger

`public.set_updated_at()` is a single trigger function applied via
`BEFORE UPDATE` triggers on `profiles`, `classrooms`, and `students`, so
`updated_at` is always set server-side and can't drift or be forgotten
by application code.

## `pgcrypto`

Enabled for `gen_random_uuid()`, used as the default for every table's
`id` primary key.
