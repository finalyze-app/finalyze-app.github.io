-- Beta feedback tickets (submitted from the app by signed-in users).
-- Run in Supabase SQL Editor or via CLI migrate.

create table if not exists public.tickets (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  email           text not null,
  type            text not null check (type in ('enhancement', 'bug', 'feature', 'other')),
  description     text not null check (char_length(trim(description)) >= 1),
  submitted_date  date not null,
  submitted_time  time not null,
  created_at      timestamptz not null default now()
);

create index if not exists tickets_user_id_idx on public.tickets (user_id);
create index if not exists tickets_created_at_idx on public.tickets (created_at desc);

alter table public.tickets enable row level security;

drop policy if exists "users insert own tickets" on public.tickets;
create policy "users insert own tickets" on public.tickets
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "users select own tickets" on public.tickets;
create policy "users select own tickets" on public.tickets
  for select to authenticated
  using (auth.uid() = user_id);

-- Admins: query all tickets in the Supabase Table Editor or via service role.
