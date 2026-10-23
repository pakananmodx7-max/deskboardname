#!/bin/bash
# Concurrency verification for 0032_classroom_archive_and_delete.sql.
#
# DEV-ONLY. Never run against a real database. Needs a disposable Postgres
# with every migration through 0032 applied (same auth shim as the .sql
# tests) and two simultaneous sessions, which a single psql script cannot
# provide. Usage:
#
#   PSQL="psql -h localhost -p 5432 -U postgres -d scratch" \
#     supabase/tests/0032_classroom_delete_concurrency.sh
#
#   K1  two deletes of the same classroom at once: the second waits for the
#       first, then fails with 42501 (classroom gone) — exactly one audit row
#   K2  a submission written while a delete holds its locks waits, then
#       fails (the assignment is gone) — no orphaned grade survives
#   K3  attendance saved (uncommitted) before the delete re-counts: the
#       delete waits for it, sees the changed count and aborts with KC003 —
#       nothing deleted
set -u
: "${PSQL:?set PSQL to a psql command for a DISPOSABLE database}"
sql() { $PSQL -v ON_ERROR_STOP=1 -X -q -At "$@"; }
fail() { echo "FAIL: $*"; exit 1; }
O=$(mktemp -d)
trap 'rm -rf "$O"' EXIT

T=10000000-0000-0000-0000-00000000c0c0
K1=20000000-0000-0000-0000-00000000c0c1
K2=20000000-0000-0000-0000-00000000c0c2
K3=20000000-0000-0000-0000-00000000c0c3
SUBJ=40000000-0000-0000-0000-00000000c0c0
STU=30000000-0000-0000-0000-00000000c0c0
A2=50000000-0000-0000-0000-00000000c0c2
S3=70000000-0000-0000-0000-00000000c0c3

sql <<SQL || fail "fixture"
insert into auth.users (id, email, raw_app_meta_data) values ('$T', 'k@example.com', '{"krunameclass_allow_teacher":"true"}');
insert into public.classrooms (id, teacher_id, name, is_active) values
  ('$K1', '$T', 'K1', false), ('$K2', '$T', 'K2', false), ('$K3', '$T', 'K3', false);
insert into public.students (id, created_by, first_name, last_name) values ('$STU', '$T', 'ก', 'ข');
insert into public.subjects (id, teacher_id, name) values ('$SUBJ', '$T', 'วิชา');
insert into public.subject_classrooms (subject_id, classroom_id) values ('$SUBJ', '$K2'), ('$SUBJ', '$K3');
insert into public.assignments (id, subject_id, classroom_id, title, max_score) values ('$A2', '$SUBJ', '$K2', 'งาน', 10);
insert into public.attendance_sessions (id, classroom_id, subject_id, attendance_date) values ('$S3', '$K3', '$SUBJ', '2026-09-01');
SQL

as_teacher="set role authenticated; select public.set_test_user('$T');"
fp() { sql -c "$as_teacher select public.get_classroom_deletion_preview('$1')->>'fingerprint'" | tail -1; }

# K1 -----------------------------------------------------------------
F=$(fp $K1)
sql -c "begin; $as_teacher select public.delete_classroom_permanently('$K1', 'K1', '$F') is not null; select pg_sleep(2); commit;" > $O/k1a.out 2>&1 &
A=$!
sleep 0.5
start=$(date +%s.%N)
sql -c "$as_teacher select public.delete_classroom_permanently('$K1', 'K1', '$F')" > $O/k1b.out 2>&1
end=$(date +%s.%N)
wait $A || fail "K1 first delete did not succeed: $(cat $O/k1a.out)"
grep -q "ไม่พบห้องเรียนนี้" $O/k1b.out || fail "K1 second delete should fail 42501: $(cat $O/k1b.out)"
waited=$(echo "$end - $start" | bc)
[ "$(echo "$waited > 1" | bc)" = 1 ] || fail "K1 second delete did not wait for the first (${waited}s)"
n=$(sql -c "select count(*) from public.classroom_lifecycle_events where classroom_id = '$K1' and event_type = 'deleted'")
[ "$n" = 1 ] || fail "K1 expected exactly 1 deleted event, got $n"
echo "PASS K1 concurrent double delete: second waited ${waited}s then got 42501; 1 audit row"

# K2 -----------------------------------------------------------------
F=$(fp $K2)
sql -c "begin; $as_teacher select public.delete_classroom_permanently('$K2', 'K2', '$F') is not null; select pg_sleep(2); commit;" > $O/k2a.out 2>&1 &
A=$!
sleep 0.5
sql -c "insert into public.assignment_submissions (assignment_id, student_id, status, score) values ('$A2', '$STU', 'submitted', 8)" > $O/k2b.out 2>&1
wait $A || fail "K2 delete did not succeed: $(cat $O/k2a.out)"
grep -q "violates foreign key constraint" $O/k2b.out || fail "K2 concurrent submission should fail after the delete: $(cat $O/k2b.out)"
n=$(sql -c "select count(*) from public.assignment_submissions where assignment_id = '$A2'")
[ "$n" = 0 ] || fail "K2 orphaned submission survived"
echo "PASS K2 submission written during the delete waited, then failed (FK) — no orphaned grade"

# K3 -----------------------------------------------------------------
F=$(fp $K3)
sql -c "begin; insert into public.attendance_records (attendance_session_id, student_id, status) values ('$S3', '$STU', 'present'); select pg_sleep(2); commit;" > $O/k3a.out 2>&1 &
A=$!
sleep 0.5
sql -c "$as_teacher select public.delete_classroom_permanently('$K3', 'K3', '$F')" > $O/k3b.out 2>&1
wait $A || fail "K3 attendance insert failed: $(cat $O/k3a.out)"
grep -q "ข้อมูลของห้องเรียนนี้เปลี่ยนไป" $O/k3b.out || fail "K3 delete should abort with KC003: $(cat $O/k3b.out)"
n=$(sql -c "select count(*) from public.attendance_records where attendance_session_id = '$S3'")
[ "$n" = 1 ] || fail "K3 attendance should be intact, got $n"
n=$(sql -c "select count(*) from public.classrooms where id = '$K3'")
[ "$n" = 1 ] || fail "K3 classroom should still exist"
echo "PASS K3 attendance saved during the delete: delete waited, saw the change, aborted (KC003) — nothing deleted"

echo "ALL 0032 CONCURRENCY CHECKS PASSED"
