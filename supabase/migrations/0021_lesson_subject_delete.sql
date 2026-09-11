-- AI Classroom Management — Permanent delete support for lessons
-- ("ลบบทเรียน") and subjects ("ลบรายวิชาและข้อมูลทั้งหมด").
--
-- Builds on 0002_subjects_topics.sql (subjects, topics, subject_classrooms),
-- 0004_attendance.sql/0005_subject_attendance.sql (attendance_sessions),
-- 0006_subject_assignments.sql (assignments), 0013_assignment_resources.sql,
-- 0015_lessons.sql (lessons, lesson_resources), 0016_assignment_submission_uploads.sql,
-- and 0019/0020 (the exact "add an ownership-only DELETE policy" pattern
-- this migration reuses for two more tables). 0001-0020 have already been
-- applied — 0019 and 0020 in particular are already applied to
-- PRODUCTION and are NOT edited here. This migration only ADDS two new
-- DELETE policies (lessons, subjects). No table, column, existing
-- policy, or FK is altered.
--
-- ==================================================
-- AUDIT PERFORMED BEFORE WRITING THIS MIGRATION — every table that
-- references subjects.id or lessons.id, and its ON DELETE action:
--
--   subject_classrooms.subject_id  -> on delete cascade  (0002)
--   topics.subject_id              -> on delete cascade  (0002)
--   lessons.subject_id             -> on delete cascade  (0015)
--   assignments.subject_id         -> on delete cascade  (0006)
--   attendance_sessions.subject_id -> on delete RESTRICT (0004) *** see below ***
--
--   lesson_resources.lesson_id     -> on delete cascade  (0015)
--
-- Transitively, deleting a subjects row already cascades (unchanged by
-- this migration, these FKs pre-exist):
--   subjects
--     -> subject_classrooms rows deleted (LINK ROWS ONLY — the linked
--        classrooms themselves are a separate table with no FK back to
--        subjects; they are never touched, matching "unlink vs delete"
--        in 0002's own comment)
--     -> topics rows deleted
--     -> lessons rows deleted -> lesson_resources rows deleted
--     -> assignments rows deleted -> assignment_resources rows deleted
--                                 -> assignment_submissions rows deleted
--                                    -> assignment_submission_resources rows deleted
--
-- *** attendance_sessions.subject_id is ON DELETE RESTRICT, deliberately
-- NOT changed here. *** 0004's own comment on that column states the
-- reason plainly: "a subject must never be hard-deleted out from under
-- attendance records that reference it." That was an intentional,
-- already-shipped safety boundary protecting attendance — the same kind
-- of academic record this schema treats as sacrosanct everywhere else
-- (students/subjects/assignments/lessons all default to archive-only;
-- attendance_records has no delete policy at all, ever). The feature
-- request behind this migration explicitly asks to delete lessons,
-- assignments, submissions, and scores — it does NOT ask to delete
-- attendance history, and turning this RESTRICT into a CASCADE would be
-- exactly the kind of "blindly add ON DELETE CASCADE without verifying
-- every relationship" this migration is instructed not to do. The
-- practical effect: a subject that has ANY recorded attendance session
-- (subject-scoped, via 0005) CANNOT be permanently deleted — Postgres
-- rejects the whole DELETE statement with a foreign-key-violation
-- (SQLSTATE 23503) before anything in the cascade above happens at all.
-- subject-service.ts's deleteSubjectPermanently checks for this
-- up front (via a plain count query) and refuses with a clear Thai
-- message before touching any Storage object, specifically so that
-- check never runs AFTER Storage cleanup has already happened — see that
-- function's own doc comment for the full reasoning.
--
-- Storage objects (assignment-files, submission-files, lesson-files
-- bucket objects) are still NOT covered by any FK, exactly as documented
-- in 0019/0020 for assignments — the application
-- (lesson-service.ts's deleteLessonPermanently, subject-service.ts's
-- deleteSubjectPermanently) is responsible for removing them, and MUST
-- do so BEFORE the row delete for the same reason 0020 documents for
-- submission-files: submission_files_delete_teacher's storage.objects
-- RLS policy re-derives ownership from the still-existing
-- assignment_submissions row behind each object's path. (lesson-files and
-- assignment-files deletes are actually NOT row-dependent — their
-- policies check only the path's leading teacherId segment — but the
-- application cleans them up in the same "before the row delete" order
-- regardless, for one consistent, easy-to-audit rule rather than a
-- bucket-by-bucket exception.)
-- ==================================================

-- Ownership-only — identical shape to lessons_update_teacher's (0015) own
-- USING clause. No dependent-data check: a lesson has no student-
-- generated dependent data (no "lesson submissions" table exists
-- anywhere in this schema), so there is nothing equivalent to
-- assignments' "has submissions" question to ask here.
create policy "lessons_delete_own"
  on public.lessons for delete
  using (
    exists (
      select 1 from public.classrooms c
      where c.id = lessons.classroom_id and c.teacher_id = auth.uid()
    )
  );

-- Ownership-only — identical shape to subjects_update_own's (0002) own
-- USING clause. No dependent-data check is needed IN THE POLICY: the
-- attendance_sessions.subject_id RESTRICT above already enforces the one
-- dependent-data rule this schema actually wants enforced at the
-- database level for subjects, and Postgres applies FK constraints
-- regardless of RLS.
create policy "subjects_delete_own"
  on public.subjects for delete
  using (teacher_id = auth.uid());

-- ==================================================
-- Nothing above touches any table's columns, any existing policy or
-- trigger, any FK's ON DELETE action (attendance_sessions.subject_id's
-- RESTRICT included), or any previously-applied migration (0001-0020) —
-- this migration only adds two additive, ownership-only DELETE policies:
-- one on `lessons`, one on `subjects`.
-- ==================================================
