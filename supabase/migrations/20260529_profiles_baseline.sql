-- Baseline profiles table + RLS (versioned for reproducible deployments).
-- Safe to run on existing projects (uses IF NOT EXISTS).

create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              text,
  country            text,
  currency           text,
  household_size     int,
  goals              jsonb default '[]'::jsonb,
  license            text default 'free',
  stripe_customer_id text,
  referral_code      text,
  referred_by        text,
  referral_count     int default 0,
  rewards_earned     int default 0,
  onboarded          boolean default false,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

alter table public.profiles enable row level security;

drop policy if exists "own profile - select" on public.profiles;
create policy "own profile - select" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "own profile - insert" on public.profiles;
create policy "own profile - insert" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "own profile - update" on public.profiles;
create policy "own profile - update" on public.profiles
  for update using (auth.uid() = id);
