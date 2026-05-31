-- Referrals: schema, signup trigger, RLS guard
-- Run in Supabase SQL Editor if not using supabase db push.

-- New profile columns
alter table public.profiles
  add column if not exists referred_by     text,
  add column if not exists referral_count  int  default 0,
  add column if not exists rewards_earned  int  default 0;

create unique index if not exists profiles_referral_code_key
  on public.profiles (referral_code) where referral_code is not null;

-- Referral rewards ledger (service role / webhook only)
create table if not exists public.referral_rewards (
  id            uuid primary key default gen_random_uuid(),
  referee_id    uuid not null references public.profiles(id) on delete cascade,
  referrer_id   uuid not null references public.profiles(id) on delete cascade,
  referee_code  text,
  amount_cents  int not null default 700,
  created_at    timestamptz default now(),
  unique (referee_id)
);

alter table public.referral_rewards enable row level security;
-- No client policies — only service role (webhook) writes.

-- Generate a unique referral code from email prefix + random suffix.
create or replace function public.gen_referral_code(p_email text) returns text
  language plpgsql as $$
declare
  base text;
  code text;
  tries int := 0;
begin
  base := upper(regexp_replace(split_part(coalesce(p_email, 'user'), '@', 1), '[^A-Z0-9]', '', 'g'));
  if length(base) < 2 then base := 'USER'; end if;
  if length(base) > 12 then base := left(base, 12); end if;
  loop
    code := base || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));
    exit when not exists (select 1 from public.profiles where referral_code = code);
    tries := tries + 1;
    if tries > 20 then
      code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      exit;
    end if;
  end loop;
  return code;
end;
$$;

-- Auto-create profile with referral_code and validated referred_by.
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_referred text;
  v_referrer_id uuid;
begin
  v_code := public.gen_referral_code(new.email);
  v_referred := upper(trim(coalesce(new.raw_user_meta_data->>'referred_by', '')));
  if v_referred = '' then v_referred := null; end if;

  if v_referred is not null then
    select id into v_referrer_id
    from public.profiles
    where referral_code = v_referred
    limit 1;
    if v_referrer_id is null or v_referrer_id = new.id then
      v_referred := null;
    end if;
  end if;

  insert into public.profiles (id, email, referral_code, referred_by)
  values (new.id, new.email, v_code, v_referred)
  on conflict (id) do update set
    email = excluded.email,
    referral_code = coalesce(public.profiles.referral_code, excluded.referral_code),
    referred_by = coalesce(public.profiles.referred_by, excluded.referred_by);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Prevent clients from rewriting referred_by or referral stats.
create or replace function public.guard_profile_referral_fields() returns trigger
  language plpgsql as $$
begin
  if coalesce(auth.jwt()->>'role', '') = 'service_role' then
    return new;
  end if;
  if old.referred_by is distinct from new.referred_by and old.referred_by is not null then
    new.referred_by := old.referred_by;
  end if;
  if new.referral_count is distinct from old.referral_count
     or new.rewards_earned is distinct from old.rewards_earned
     or new.referral_code is distinct from old.referral_code then
    new.referral_count := old.referral_count;
    new.rewards_earned := old.rewards_earned;
    new.referral_code := old.referral_code;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_referral on public.profiles;
create trigger guard_profile_referral
  before update on public.profiles
  for each row execute function public.guard_profile_referral_fields();

-- Backfill referral codes for existing users
update public.profiles
set referral_code = public.gen_referral_code(email)
where referral_code is null or referral_code = '';
