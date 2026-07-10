
-- Meteor Design Queue V2
-- 流星设计排队系统：设计师工作量、取号、叫号、完成、暂停接单

create extension if not exists pgcrypto;

create table if not exists public.meteor_settings (
  id integer primary key default 1 check (id = 1),
  current_day text not null default to_char(now(), 'YYYY-MM-DD'),
  next_number integer not null default 1 check (next_number >= 1),
  updated_at timestamptz not null default now()
);

create table if not exists public.meteor_designers (
  id text primary key,
  name text not null,
  sort_order integer not null default 0,
  is_accepting boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meteor_design_tickets (
  id uuid primary key default gen_random_uuid(),
  number text not null,
  number_seq integer not null,
  designer_id text not null references public.meteor_designers(id),
  status text not null default 'waiting' check (status in ('waiting', 'in_progress', 'done', 'cancelled')),
  date_key text not null,
  month_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  called_at timestamptz,
  finished_at timestamptz,
  cancelled_at timestamptz
);

create table if not exists public.meteor_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);

insert into public.meteor_settings (id)
values (1)
on conflict (id) do nothing;

insert into public.meteor_designers (id, name, sort_order, is_accepting)
values
  ('designer_a', '设计A', 1, true),
  ('designer_b', '设计B', 2, true)
on conflict (id) do update
set sort_order = excluded.sort_order,
    updated_at = now();

create or replace function public.meteor_today_key()
returns text
language sql
stable
as $$
  select to_char(now(), 'YYYY-MM-DD');
$$;

create or replace function public.meteor_month_key()
returns text
language sql
stable
as $$
  select to_char(now(), 'YYYY-MM');
$$;

create or replace function public.meteor_take_ticket(p_designer_id text)
returns public.meteor_design_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.meteor_settings%rowtype;
  d public.meteor_designers%rowtype;
  t public.meteor_design_tickets%rowtype;
  today text := public.meteor_today_key();
  month text := public.meteor_month_key();
  ticket_number text;
begin
  select * into cfg
  from public.meteor_settings
  where id = 1
  for update;

  if cfg.current_day <> today then
    update public.meteor_settings
    set current_day = today,
        next_number = 1,
        updated_at = now()
    where id = 1
    returning * into cfg;
  end if;

  select * into d
  from public.meteor_designers
  where id = p_designer_id;

  if d.id is null then
    raise exception '设计师不存在。';
  end if;

  if d.is_accepting is not true then
    raise exception '% 当前暂停接单，请选择其他设计师。', d.name;
  end if;

  ticket_number := lpad(cfg.next_number::text, 2, '0') || '号';

  insert into public.meteor_design_tickets (
    number, number_seq, designer_id, status, date_key, month_key
  )
  values (
    ticket_number, cfg.next_number, d.id, 'waiting', today, month
  )
  returning * into t;

  update public.meteor_settings
  set next_number = cfg.next_number + 1,
      updated_at = now()
  where id = 1;

  insert into public.meteor_logs (action, detail)
  values ('取号', ticket_number || ' - ' || d.name);

  return t;
end;
$$;

create or replace function public.meteor_call_next_ticket(p_designer_id text)
returns public.meteor_design_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.meteor_design_tickets%rowtype;
begin
  select * into t
  from public.meteor_design_tickets
  where designer_id = p_designer_id
    and date_key = public.meteor_today_key()
    and status = 'waiting'
  order by created_at asc
  limit 1
  for update;

  if t.id is null then
    raise exception '该设计师暂无等待号码。';
  end if;

  update public.meteor_design_tickets
  set status = 'in_progress',
      called_at = now(),
      updated_at = now()
  where id = t.id
  returning * into t;

  insert into public.meteor_logs (action, detail)
  values ('叫号', t.number || ' - ' || t.designer_id);

  return t;
end;
$$;

create or replace function public.meteor_update_ticket_status(p_ticket_id uuid, p_status text)
returns public.meteor_design_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.meteor_design_tickets%rowtype;
begin
  if p_status not in ('waiting', 'in_progress', 'done', 'cancelled') then
    raise exception '状态不正确。';
  end if;

  update public.meteor_design_tickets
  set status = p_status,
      called_at = case when p_status = 'in_progress' then coalesce(called_at, now()) else called_at end,
      finished_at = case when p_status = 'done' then now() else finished_at end,
      cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
      updated_at = now()
  where id = p_ticket_id
  returning * into t;

  if t.id is null then
    raise exception '找不到该号码。';
  end if;

  insert into public.meteor_logs (action, detail)
  values ('修改状态', t.number || ' - ' || p_status);

  return t;
end;
$$;

create or replace function public.meteor_transfer_ticket(p_ticket_id uuid, p_designer_id text)
returns public.meteor_design_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.meteor_design_tickets%rowtype;
  d public.meteor_designers%rowtype;
begin
  select * into d
  from public.meteor_designers
  where id = p_designer_id;

  if d.id is null then
    raise exception '设计师不存在。';
  end if;

  update public.meteor_design_tickets
  set designer_id = d.id,
      updated_at = now()
  where id = p_ticket_id
  returning * into t;

  if t.id is null then
    raise exception '找不到该号码。';
  end if;

  insert into public.meteor_logs (action, detail)
  values ('转单', t.number || ' 转给 ' || d.name);

  return t;
end;
$$;

create or replace function public.meteor_set_designer_accepting(p_designer_id text, p_is_accepting boolean)
returns public.meteor_designers
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.meteor_designers%rowtype;
begin
  update public.meteor_designers
  set is_accepting = p_is_accepting,
      updated_at = now()
  where id = p_designer_id
  returning * into d;

  if d.id is null then
    raise exception '设计师不存在。';
  end if;

  insert into public.meteor_logs (action, detail)
  values (case when p_is_accepting then '恢复接单' else '暂停接单' end, d.name);

  return d;
end;
$$;

create or replace function public.meteor_update_designer_names(p_name_a text, p_name_b text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.meteor_designers
  set name = coalesce(nullif(trim(p_name_a), ''), '设计A'),
      updated_at = now()
  where id = 'designer_a';

  update public.meteor_designers
  set name = coalesce(nullif(trim(p_name_b), ''), '设计B'),
      updated_at = now()
  where id = 'designer_b';

  insert into public.meteor_logs (action, detail)
  values ('修改设计师名称', p_name_a || ', ' || p_name_b);
end;
$$;

create or replace function public.meteor_reset_today_number()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.meteor_settings
  set current_day = public.meteor_today_key(),
      next_number = 1,
      updated_at = now()
  where id = 1;

  insert into public.meteor_logs (action, detail)
  values ('重置今日号码', public.meteor_today_key());
end;
$$;

create or replace function public.meteor_clear_today_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.meteor_design_tickets
  where date_key = public.meteor_today_key();

  update public.meteor_settings
  set current_day = public.meteor_today_key(),
      next_number = 1,
      updated_at = now()
  where id = 1;

  insert into public.meteor_logs (action, detail)
  values ('清空今日测试数据', public.meteor_today_key());
end;
$$;

alter table public.meteor_settings enable row level security;
alter table public.meteor_designers enable row level security;
alter table public.meteor_design_tickets enable row level security;
alter table public.meteor_logs enable row level security;

drop policy if exists "meteor_settings_public_access" on public.meteor_settings;
drop policy if exists "meteor_designers_public_access" on public.meteor_designers;
drop policy if exists "meteor_design_tickets_public_access" on public.meteor_design_tickets;
drop policy if exists "meteor_logs_public_access" on public.meteor_logs;

create policy "meteor_settings_public_access"
on public.meteor_settings
for all
using (true)
with check (true);

create policy "meteor_designers_public_access"
on public.meteor_designers
for all
using (true)
with check (true);

create policy "meteor_design_tickets_public_access"
on public.meteor_design_tickets
for all
using (true)
with check (true);

create policy "meteor_logs_public_access"
on public.meteor_logs
for all
using (true)
with check (true);

grant usage on schema public to anon;
grant select, insert, update, delete on public.meteor_settings to anon;
grant select, insert, update, delete on public.meteor_designers to anon;
grant select, insert, update, delete on public.meteor_design_tickets to anon;
grant select, insert, update, delete on public.meteor_logs to anon;

grant execute on function public.meteor_today_key() to anon;
grant execute on function public.meteor_month_key() to anon;
grant execute on function public.meteor_take_ticket(text) to anon;
grant execute on function public.meteor_call_next_ticket(text) to anon;
grant execute on function public.meteor_update_ticket_status(uuid, text) to anon;
grant execute on function public.meteor_transfer_ticket(uuid, text) to anon;
grant execute on function public.meteor_set_designer_accepting(text, boolean) to anon;
grant execute on function public.meteor_update_designer_names(text, text) to anon;
grant execute on function public.meteor_reset_today_number() to anon;
grant execute on function public.meteor_clear_today_data() to anon;

do $$
begin
  alter publication supabase_realtime add table public.meteor_designers;
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.meteor_design_tickets;
exception
  when duplicate_object then null;
end;
$$;
