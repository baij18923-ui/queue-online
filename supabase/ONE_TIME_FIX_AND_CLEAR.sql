-- Meteor Design Queue V3：统计修复 + 清空全部数据
-- 在 Supabase SQL Editor 中整段运行一次。

alter table public.meteor_month_manual_stats
  add column if not exists auto_total_snapshot integer not null default 0;
alter table public.meteor_month_manual_stats
  add column if not exists auto_waiting_snapshot integer not null default 0;
alter table public.meteor_month_manual_stats
  add column if not exists auto_in_progress_snapshot integer not null default 0;
alter table public.meteor_month_manual_stats
  add column if not exists auto_done_snapshot integer not null default 0;
alter table public.meteor_month_manual_stats
  add column if not exists auto_cancelled_snapshot integer not null default 0;

create or replace function public.meteor_upsert_month_stats(
  p_month_key text,
  p_designer_id text,
  p_total integer,
  p_waiting integer,
  p_in_progress integer,
  p_done integer,
  p_cancelled integer
)
returns public.meteor_month_manual_stats
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.meteor_designers%rowtype;
  s public.meteor_month_manual_stats%rowtype;
  v_month text := coalesce(nullif(trim(p_month_key), ''), public.meteor_month_key());
  auto_total integer := 0;
  auto_waiting integer := 0;
  auto_in_progress integer := 0;
  auto_done integer := 0;
  auto_cancelled integer := 0;
begin
  select * into d
  from public.meteor_designers
  where id = p_designer_id;

  if d.id is null then
    raise exception '设计师不存在。';
  end if;

  select
    count(*)::integer,
    count(*) filter (where status = 'waiting')::integer,
    count(*) filter (where status = 'in_progress')::integer,
    count(*) filter (where status = 'done')::integer,
    count(*) filter (where status = 'cancelled')::integer
  into auto_total, auto_waiting, auto_in_progress, auto_done, auto_cancelled
  from public.meteor_design_tickets
  where designer_id = p_designer_id
    and month_key = v_month;

  insert into public.meteor_month_manual_stats (
    month_key, designer_id,
    total_count, waiting_count, in_progress_count, done_count, cancelled_count,
    auto_total_snapshot, auto_waiting_snapshot, auto_in_progress_snapshot,
    auto_done_snapshot, auto_cancelled_snapshot, updated_at
  ) values (
    v_month, p_designer_id,
    greatest(coalesce(p_total,0),0),
    greatest(coalesce(p_waiting,0),0),
    greatest(coalesce(p_in_progress,0),0),
    greatest(coalesce(p_done,0),0),
    greatest(coalesce(p_cancelled,0),0),
    greatest(coalesce(auto_total,0),0),
    greatest(coalesce(auto_waiting,0),0),
    greatest(coalesce(auto_in_progress,0),0),
    greatest(coalesce(auto_done,0),0),
    greatest(coalesce(auto_cancelled,0),0),
    now()
  )
  on conflict (month_key, designer_id) do update
  set total_count = excluded.total_count,
      waiting_count = excluded.waiting_count,
      in_progress_count = excluded.in_progress_count,
      done_count = excluded.done_count,
      cancelled_count = excluded.cancelled_count,
      auto_total_snapshot = excluded.auto_total_snapshot,
      auto_waiting_snapshot = excluded.auto_waiting_snapshot,
      auto_in_progress_snapshot = excluded.auto_in_progress_snapshot,
      auto_done_snapshot = excluded.auto_done_snapshot,
      auto_cancelled_snapshot = excluded.auto_cancelled_snapshot,
      updated_at = now()
  returning * into s;

  return s;
end;
$$;

create or replace function public.meteor_clear_all_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.meteor_design_tickets where id is not null;
  delete from public.meteor_month_manual_stats where id is not null;
  delete from public.meteor_logs where id is not null;

  update public.meteor_designers
  set is_accepting = true,
      updated_at = now()
  where id is not null;

  update public.meteor_settings
  set current_day = public.meteor_today_key(),
      next_number = 1,
      updated_at = now()
  where id = 1;
end;
$$;

grant execute on function public.meteor_upsert_month_stats(text,text,integer,integer,integer,integer,integer) to anon;
grant execute on function public.meteor_clear_all_data() to anon;

-- 本次按你的要求直接清空旧号码、旧统计和历史日志。
select public.meteor_clear_all_data();
