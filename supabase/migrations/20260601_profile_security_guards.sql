-- Security: block client tampering with billing fields and referred_by.
-- Run in Supabase SQL Editor or via supabase db push.

-- Allow signup trigger to set referred_by on initial profile insert.
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

  perform set_config('app.internal_signup', '1', true);
  insert into public.profiles (id, email, referral_code, referred_by)
  values (new.id, new.email, v_code, v_referred)
  on conflict (id) do update set
    email = excluded.email,
    referral_code = coalesce(public.profiles.referral_code, excluded.referral_code),
    referred_by = coalesce(public.profiles.referred_by, excluded.referred_by);
  return new;
end;
$$;

-- Block ALL client updates to referred_by (not only when old value was non-null).
create or replace function public.guard_profile_referral_fields() returns trigger
  language plpgsql as $$
begin
  if coalesce(auth.jwt()->>'role', '') = 'service_role' then
    return new;
  end if;
  if old.referred_by is distinct from new.referred_by then
    new.referred_by := old.referred_by;
  end if;
  if new.referral_count is distinct from old.referral_count
     or new.rewards_earned is distinct from old.rewards_earned then
    new.referral_count := old.referral_count;
    new.rewards_earned := old.rewards_earned;
  end if;
  if new.referral_code is distinct from old.referral_code then
    if current_setting('app.internal_referral', true) = '1' then
      null;
    else
      new.referral_code := old.referral_code;
    end if;
  end if;
  return new;
end;
$$;

-- Block client writes to license and stripe_customer_id (webhook/service_role only).
create or replace function public.guard_profile_billing_fields() returns trigger
  language plpgsql as $$
begin
  if coalesce(auth.jwt()->>'role', '') = 'service_role' then
    return new;
  end if;

  if TG_OP = 'INSERT' then
    new.license := 'free';
    new.stripe_customer_id := null;
    if current_setting('app.internal_signup', true) != '1' then
      new.referred_by := null;
    end if;
    return new;
  end if;

  if new.license is distinct from old.license then
    new.license := old.license;
  end if;
  if new.stripe_customer_id is distinct from old.stripe_customer_id then
    new.stripe_customer_id := old.stripe_customer_id;
  end if;
  if new.referral_count is distinct from old.referral_count then
    new.referral_count := old.referral_count;
  end if;
  if new.rewards_earned is distinct from old.rewards_earned then
    new.rewards_earned := old.rewards_earned;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_billing on public.profiles;
create trigger guard_profile_billing
  before insert or update on public.profiles
  for each row execute function public.guard_profile_billing_fields();
