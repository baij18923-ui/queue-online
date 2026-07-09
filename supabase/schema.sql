create extension if not exists pgcrypto;

create table if not exists public.queue_settings (
  id integer primary key default 1 check (id = 1),
  prefix text not null default 'A',
  digits integer not null default 3 check (digits between 1 and 6),
  next_number integer not null default 1 check (next_number >= 1),
  call_text text not null default '请 {number} 到窗口办理',
  is_open boolean not null default true,
  current_call_id uuid,
  last_ticket_id uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.queue_tickets (
  id uuid primary key default gen_random_uuid(),
  number text not null,
  status text not null default 'waiting' check (status in ('waiting', 'called', 'skipped')),
  created_at timestamptz not null default now(),
  called_at timestamptz,
  skipped_at timestamptz
);

create table if not exists public.queue_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);

insert into public.queue_settings (id)
values (1)
on conflict (id) do nothing;

create or replace function public.take_queue_ticket()
returns public.queue_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.queue_settings%rowtype;
  ticket public.queue_tickets%rowtype;
  ticket_number text;
begin
  select *
  into cfg
  from public.queue_settings
  where id = 1
  for update;

  if not cfg.is_open then
    raise exception '当前暂停取号，请稍后再试。';
  end if;

  ticket_number := cfg.prefix || lpad(cfg.next_number::text, cfg.digits, '0');

  insert into public.queue_tickets (number, status)
  values (ticket_number, 'waiting')
  returning * into ticket;

  update public.queue_settings
  set next_number = cfg.next_number + 1,
      last_ticket_id = ticket.id,
      updated_at = now()
  where id = 1;

  insert into public.queue_logs (action, detail)
  values ('取号', ticket.number);

  return ticket;
end;
$$;

create or replace function public.call_queue_ticket(ticket_id uuid)
returns public.queue_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  ticket public.queue_tickets%rowtype;
begin
  update public.queue_tickets
  set status = 'called',
      called_at = now()
  where id = ticket_id
  returning * into ticket;

  if ticket.id is null then
    raise exception '找不到该号码。';
  end if;

  update public.queue_settings
  set current_call_id = ticket.id,
      updated_at = now()
  where id = 1;

  insert into public.queue_logs (action, detail)
  values ('叫号', ticket.number);

  return ticket;
end;
$$;

create or replace function public.skip_queue_ticket(ticket_id uuid)
returns public.queue_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  ticket public.queue_tickets%rowtype;
begin
  update public.queue_tickets
  set status = 'skipped',
      skipped_at = now()
  where id = ticket_id
  returning * into ticket;

  if ticket.id is null then
    raise exception '找不到该号码。';
  end if;

  insert into public.queue_logs (action, detail)
  values ('跳过', ticket.number);

  return ticket;
end;
$$;

create or replace function public.clear_waiting_queue()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  skipped_count integer;
begin
  update public.queue_tickets
  set status = 'skipped',
      skipped_at = now()
  where status = 'waiting';

  get diagnostics skipped_count = row_count;

  insert into public.queue_logs (action, detail)
  values ('清空等待', skipped_count || ' 个号码');
end;
$$;

create or replace function public.reset_queue_system()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  truncate table public.queue_tickets restart identity;
  truncate table public.queue_logs restart identity;

  update public.queue_settings
  set prefix = 'A',
      digits = 3,
      next_number = 1,
      call_text = '请 {number} 到窗口办理',
      is_open = true,
      current_call_id = null,
      last_ticket_id = null,
      updated_at = now()
  where id = 1;

  insert into public.queue_logs (action, detail)
  values ('全部重置', '系统已重置');
end;
$$;

alter table public.queue_settings enable row level security;
alter table public.queue_tickets enable row level security;
alter table public.queue_logs enable row level security;

drop policy if exists "queue_settings_public_access" on public.queue_settings;
drop policy if exists "queue_tickets_public_access" on public.queue_tickets;
drop policy if exists "queue_logs_public_access" on public.queue_logs;

create policy "queue_settings_public_access"
on public.queue_settings
for all
using (true)
with check (true);

create policy "queue_tickets_public_access"
on public.queue_tickets
for all
using (true)
with check (true);

create policy "queue_logs_public_access"
on public.queue_logs
for all
using (true)
with check (true);

grant usage on schema public to anon;
grant select, insert, update, delete on public.queue_settings to anon;
grant select, insert, update, delete on public.queue_tickets to anon;
grant select, insert, update, delete on public.queue_logs to anon;
grant execute on function public.take_queue_ticket() to anon;
grant execute on function public.call_queue_ticket(uuid) to anon;
grant execute on function public.skip_queue_ticket(uuid) to anon;
grant execute on function public.clear_waiting_queue() to anon;
grant execute on function public.reset_queue_system() to anon;

do $$
begin
  alter publication supabase_realtime add table public.queue_settings;
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.queue_tickets;
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.queue_logs;
exception
  when duplicate_object then null;
end;
$$;
