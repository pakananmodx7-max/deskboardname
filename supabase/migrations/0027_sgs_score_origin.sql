-- AI Classroom Management — SGS score origin: AUTO / OVERRIDE / EMPTY
--
-- This migration has NOT been applied to a live database yet — do NOT
-- run it automatically. It is safe to edit in place if a review finds
-- issues before it is ever run. The app detects whether it has been
-- applied (see sgs-score-workspace-service.ts's getSgsScoreCellsForColumns)
-- and, until it is, keeps working exactly as before (one plain `score`
-- per cell, no origin tracking) — never a broken workspace.
--
-- PROBLEM THIS FIXES: before this migration a calculated SGS score was
-- written by the SAME setSgsScore as a manual edit, into the SAME
-- `sgs_scores.score` column. Nothing recorded where a value came from,
-- so (a) a teacher could not see which values were calculated, (b)
-- entering a manual value destroyed the only copy of the calculated one,
-- (c) re-running the calculator refilled a cell the teacher had cleared,
-- and (d) a student whose sources became un-calculable kept a stale
-- calculated value forever (the calculator could only ever write
-- numbers, never clear one).
--
-- MODEL (additive only — no existing column changes meaning):
--   calculated_score  the last value calculated from the column's mapped
--                     source assignments (sgs_score_columns.calculation_formula,
--                     0025). NULL = not calculable / never calculated.
--   override_score    a value the teacher entered by hand. NULL = none.
--   auto_suppressed   the teacher explicitly asked for THIS student's
--                     cell to stay empty even though the column is
--                     calculated ("ยกเลิกการคำนวณสำหรับนักเรียนคนนี้").
--   calculated_at     when calculated_score was last written.
--   score             UNCHANGED MEANING for every existing reader: the
--                     EFFECTIVE score. It is now always derived as
--                       coalesce(override_score,
--                                case when auto_suppressed then null
--                                     else calculated_score end)
--                     by the RPCs below, so the SGS Bridge export (which
--                     reads `score`) consumes the effective score with
--                     zero changes on the export/extension side.
--
-- 0 IS A REAL SCORE everywhere below. Every test is `is null` / `is not
-- null` / `is distinct from` — never a truthiness test.
--
-- BACKFILL (deterministic): every existing row with a non-null `score`
-- gets override_score = score. The origin of an existing value is
-- unknowable (calculated and manual values were stored identically), so
-- the only safe assumption is "the teacher owns this value": a later
-- recalculation will then NEVER overwrite it. A teacher converts a
-- column back to automatic with the explicit, confirmed
-- reset_sgs_score_column_to_auto below. Rows with score IS NULL stay
-- exactly as they are (NULL is never inferred as 0). `score` itself is
-- never modified by the backfill.
--
-- ROLLBACK: `score` is never rewritten by the backfill, and remains the
-- effective value at all times afterward, so rolling back is:
--   drop function public.reset_sgs_score_column_to_auto(uuid);
--   drop function public.recalculate_sgs_score_column(uuid, jsonb);
--   drop function public.set_sgs_score_cell(uuid, uuid, text, numeric);
--   drop function public.sgs_score_reconcile_legacy(numeric, numeric, boolean, numeric);
--   drop function public.sgs_score_effective(numeric, boolean, numeric);
--   alter table public.sgs_scores
--     drop column calculated_at, drop column auto_suppressed,
--     drop column override_score, drop column calculated_score;
-- after which every cell keeps its current effective value in `score`
-- (the pre-0027 app reads only that column). Only origin information is
-- lost; no score is.
--
-- LEGACY/STALE WRITES: an older client (or setSgsScore) may still write
-- `score` directly after this migration. sgs_score_reconcile_legacy
-- detects a `score` that no longer matches the derived effective value
-- and treats it as the teacher's intent (a direct value -> override; a
-- direct clear -> suppressed) BEFORE any RPC changes the row, so such a
-- write is never silently overwritten by a recalculation.

-- ==================================================
-- Columns
-- ==================================================

alter table public.sgs_scores
  add column if not exists calculated_score numeric,
  add column if not exists override_score numeric,
  add column if not exists auto_suppressed boolean not null default false,
  add column if not exists calculated_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sgs_scores_calculated_score_nonneg') then
    alter table public.sgs_scores
      add constraint sgs_scores_calculated_score_nonneg check (calculated_score is null or calculated_score >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sgs_scores_override_score_nonneg') then
    alter table public.sgs_scores
      add constraint sgs_scores_override_score_nonneg check (override_score is null or override_score >= 0);
  end if;
end;
$$;

-- ==================================================
-- Backfill — idempotent: a row the RPCs already manage (calculated_score
-- is not null) is never turned into an override on a re-run.
-- ==================================================

update public.sgs_scores
set override_score = score
where score is not null
  and override_score is null
  and calculated_score is null;

-- ==================================================
-- Pure helpers
-- ==================================================

create or replace function public.sgs_score_effective(p_override numeric, p_suppressed boolean, p_calculated numeric)
returns numeric
language sql
immutable
as $$
  select case
    when p_override is not null then p_override
    when p_suppressed then null
    else p_calculated
  end
$$;

-- If `score` was written directly (legacy path / older client) and no
-- longer matches the derived effective value, adopt it as the teacher's
-- intent. Mirrored exactly by resolveSgsScoreCell in
-- src/services/sgs-score-origin.ts.
create or replace function public.sgs_score_reconcile_legacy(
  p_score numeric,
  p_override numeric,
  p_suppressed boolean,
  p_calculated numeric,
  out o_override numeric,
  out o_suppressed boolean
)
language plpgsql
immutable
as $$
begin
  o_override := p_override;
  o_suppressed := p_suppressed;
  if p_score is distinct from public.sgs_score_effective(p_override, p_suppressed, p_calculated) then
    if p_score is not null then
      o_override := p_score;
      o_suppressed := false;
    else
      o_override := null;
      o_suppressed := true;
    end if;
  end if;
end;
$$;

-- ==================================================
-- set_sgs_score_cell — ONE cell, ONE atomic statement sequence, the row
-- locked (FOR UPDATE) for its duration. The effective `score` is always
-- computed HERE from the row's own current calculated_score, never sent
-- by the client — so a client holding a stale calculated value can never
-- write a stale effective score.
--
-- p_action:
--   'override'       teacher value (0 <= p_value <= column max). Keeps
--                    calculated_score intact.
--   'clear_override' remove the teacher value AND any per-student
--                    suppression -> falls back to calculated_score (AUTO)
--                    or EMPTY when there is none. Backs both
--                    "ล้างคะแนน" and "กลับไปใช้คะแนนคำนวณ".
--   'suppress_auto'  keep this cell EMPTY although the column is
--                    calculated; calculated_score and the column's
--                    mapping are untouched ("ยกเลิกการคำนวณสำหรับนักเรียนคนนี้").
--
-- SECURITY INVOKER: every read/write below goes through sgs_scores'
-- existing RLS (0023) exactly as a direct client call would — a new row
-- still requires the student to be a CURRENT classroom member.
-- ==================================================

create or replace function public.set_sgs_score_cell(
  p_column_id uuid,
  p_student_id uuid,
  p_action text,
  p_value numeric default null
)
returns public.sgs_scores
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_max numeric;
  v_row public.sgs_scores;
  v_override numeric;
  v_suppressed boolean;
begin
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อนใช้งาน' using errcode = '28000';
  end if;

  if p_action is null or p_action not in ('override', 'clear_override', 'suppress_auto') then
    raise exception 'คำสั่งแก้ไขคะแนนไม่ถูกต้อง' using errcode = '22023';
  end if;

  select c.max_score into v_max from public.sgs_score_columns c where c.id = p_column_id;
  if v_max is null then
    raise exception 'ไม่พบช่องคะแนนนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' using errcode = '42501';
  end if;

  if p_action = 'override' then
    if p_value is null then
      raise exception 'กรุณากรอกคะแนน' using errcode = '22023';
    end if;
    if p_value < 0 or p_value > v_max then
      raise exception 'คะแนนต้องอยู่ระหว่าง 0 ถึง %', v_max using errcode = '22023';
    end if;
  end if;

  select * into v_row from public.sgs_scores s
  where s.column_id = p_column_id and s.student_id = p_student_id
  for update;

  if not found then
    -- Nothing to clear on a cell that has never had a row.
    if p_action = 'clear_override' then
      return null;
    end if;
    insert into public.sgs_scores (column_id, student_id, score)
    values (p_column_id, p_student_id, null)
    on conflict (column_id, student_id) do nothing;
    select * into v_row from public.sgs_scores s
    where s.column_id = p_column_id and s.student_id = p_student_id
    for update;
    if not found then
      raise exception 'ไม่สามารถบันทึกคะแนนของนักเรียนคนนี้ได้' using errcode = '42501';
    end if;
  end if;

  select r.o_override, r.o_suppressed into v_override, v_suppressed
  from public.sgs_score_reconcile_legacy(v_row.score, v_row.override_score, v_row.auto_suppressed, v_row.calculated_score) r;

  if p_action = 'override' then
    v_override := p_value;
    v_suppressed := false;
  elsif p_action = 'clear_override' then
    v_override := null;
    v_suppressed := false;
  else
    v_override := null;
    v_suppressed := true;
  end if;

  update public.sgs_scores
  set override_score = v_override,
      auto_suppressed = v_suppressed,
      score = public.sgs_score_effective(v_override, v_suppressed, v_row.calculated_score)
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.set_sgs_score_cell(uuid, uuid, text, numeric) from public;
grant execute on function public.set_sgs_score_cell(uuid, uuid, text, numeric) to authenticated;

-- ==================================================
-- recalculate_sgs_score_column — the whole column in ONE transaction
-- (all-or-nothing: any invalid value aborts every row, never a
-- half-recalculated class). p_values is a JSON array of
--   { "student_id": uuid, "calculated_score": number|null,
--     "clear_override": boolean (optional, default false) }
--
-- For every listed student: calculated_score/calculated_at are updated;
-- the effective score follows ONLY for AUTO cells. An override or a
-- per-student suppression is preserved unless that entry explicitly
-- sets clear_override (the calculator's confirmed "เขียนทับคะแนนเดิม").
-- A null calculated_score empties an AUTO cell (its sources are no
-- longer calculable) instead of leaving a stale number behind.
--
-- The column row is locked FOR UPDATE first, so two recalculations of
-- the same column (double click, two tabs) run one after the other,
-- never interleaved.
-- ==================================================

create or replace function public.recalculate_sgs_score_column(p_column_id uuid, p_values jsonb)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_max numeric;
  v_item jsonb;
  v_student_id uuid;
  v_calc numeric;
  v_clear boolean;
  v_row public.sgs_scores;
  v_override numeric;
  v_suppressed boolean;
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อนใช้งาน' using errcode = '28000';
  end if;

  select c.max_score into v_max from public.sgs_score_columns c where c.id = p_column_id for update;
  if v_max is null then
    raise exception 'ไม่พบช่องคะแนนนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' using errcode = '42501';
  end if;

  if p_values is null or jsonb_typeof(p_values) <> 'array' then
    raise exception 'ข้อมูลคะแนนที่คำนวณไม่ถูกต้อง' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_values)
  loop
    v_student_id := (v_item ->> 'student_id')::uuid;
    if v_student_id is null then
      raise exception 'ข้อมูลนักเรียนไม่ถูกต้อง' using errcode = '22023';
    end if;

    if jsonb_typeof(v_item -> 'calculated_score') not in ('number', 'null') then
      raise exception 'คะแนนที่คำนวณต้องเป็นตัวเลขหรือว่าง' using errcode = '22023';
    end if;
    v_calc := (v_item ->> 'calculated_score')::numeric;
    if v_calc is not null and (v_calc < 0 or v_calc > v_max) then
      raise exception 'คะแนนที่คำนวณ (%) อยู่นอกช่วง 0 ถึง %', v_calc, v_max using errcode = '22023';
    end if;
    v_clear := coalesce((v_item ->> 'clear_override')::boolean, false);

    select * into v_row from public.sgs_scores s
    where s.column_id = p_column_id and s.student_id = v_student_id
    for update;

    if not found then
      -- Nothing to record for a student with no row and nothing calculable.
      if v_calc is null then
        continue;
      end if;
      insert into public.sgs_scores (column_id, student_id, score)
      values (p_column_id, v_student_id, null)
      on conflict (column_id, student_id) do nothing;
      select * into v_row from public.sgs_scores s
      where s.column_id = p_column_id and s.student_id = v_student_id
      for update;
      if not found then
        raise exception 'ไม่สามารถบันทึกคะแนนของนักเรียนคนนี้ได้' using errcode = '42501';
      end if;
    end if;

    select r.o_override, r.o_suppressed into v_override, v_suppressed
    from public.sgs_score_reconcile_legacy(v_row.score, v_row.override_score, v_row.auto_suppressed, v_row.calculated_score) r;

    if v_clear then
      v_override := null;
      v_suppressed := false;
    end if;

    update public.sgs_scores
    set calculated_score = v_calc,
        calculated_at = now(),
        override_score = v_override,
        auto_suppressed = v_suppressed,
        score = public.sgs_score_effective(v_override, v_suppressed, v_calc)
    where id = v_row.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.recalculate_sgs_score_column(uuid, jsonb) from public;
grant execute on function public.recalculate_sgs_score_column(uuid, jsonb) to authenticated;

-- ==================================================
-- reset_sgs_score_column_to_auto — the confirmed bulk "ล้างคะแนนที่ครู
-- กำหนดเองทั้งคอลัมน์": every override and every per-student suppression
-- in ONE column is removed, so each cell falls back to its
-- calculated_score (or EMPTY when there is none). calculated_score is
-- never touched. Returns how many cells actually changed. The UI shows
-- that count BEFORE calling this, and requires explicit confirmation.
-- ==================================================

create or replace function public.reset_sgs_score_column_to_auto(p_column_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_row public.sgs_scores;
  v_override numeric;
  v_suppressed boolean;
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อนใช้งาน' using errcode = '28000';
  end if;

  perform 1 from public.sgs_score_columns c where c.id = p_column_id for update;
  if not found then
    raise exception 'ไม่พบช่องคะแนนนี้ หรือคุณไม่มีสิทธิ์เข้าถึง' using errcode = '42501';
  end if;

  for v_row in
    select * from public.sgs_scores s where s.column_id = p_column_id for update
  loop
    select r.o_override, r.o_suppressed into v_override, v_suppressed
    from public.sgs_score_reconcile_legacy(v_row.score, v_row.override_score, v_row.auto_suppressed, v_row.calculated_score) r;

    if v_override is null and not v_suppressed then
      continue;
    end if;

    update public.sgs_scores
    set override_score = null,
        auto_suppressed = false,
        score = v_row.calculated_score
    where id = v_row.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.reset_sgs_score_column_to_auto(uuid) from public;
grant execute on function public.reset_sgs_score_column_to_auto(uuid) to authenticated;
