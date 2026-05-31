-- Run this if you already applied 20260530_referrals.sql but codes are still missing.
-- Fixes the guard trigger (backfill was blocked) and adds ensure_referral_code() RPC.

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
     or new.rewards_earned is distinct from old.rewards_earned then
    new.referral_count := old.referral_count;
    new.rewards_earned := old.rewards_earned;
  end if;
  if new.referral_code is distinct from old.referral_code then
    if coalesce(auth.jwt()->>'role', '') = 'service_role'
       or current_setting('app.internal_referral', true) = '1' then
      null;
    else
      new.referral_code := old.referral_code;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.ensure_referral_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := auth.uid();
  v_email text;
  v_code text;
begin
  if v_id is null then raise exception 'Not authenticated'; end if;
  select referral_code, email into v_code, v_email from public.profiles where id = v_id;
  if v_code is not null and v_code != '' then return v_code; end if;
  v_code := public.gen_referral_code(v_email);
  perform set_config('app.internal_referral', '1', true);
  update public.profiles set referral_code = v_code where id = v_id;
  return v_code;
end;
$$;

grant execute on function public.ensure_referral_code() to authenticated;

do $$
declare r record;
begin
  for r in select id, email from public.profiles where referral_code is null or referral_code = '' loop
    perform set_config('app.internal_referral', '1', true);
    update public.profiles set referral_code = public.gen_referral_code(r.email) where id = r.id;
  end loop;
end $$;
