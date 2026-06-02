-- Track last authentication time on public.profiles for admin/support visibility.
-- Clients may only update via touch_last_login(); direct writes are blocked.

alter table public.profiles
  add column if not exists last_login_at timestamptz;

create or replace function public.touch_last_login() returns timestamptz
  language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := auth.uid();
  v_ts timestamptz := now();
begin
  if v_id is null then
    raise exception 'Not authenticated';
  end if;

  perform set_config('app.internal_login_touch', '1', true);
  update public.profiles
    set last_login_at = v_ts,
        updated_at = v_ts
    where id = v_id;

  return v_ts;
end;
$$;

grant execute on function public.touch_last_login() to authenticated;

create or replace function public.guard_profile_billing_fields() returns trigger
  language plpgsql as $$
declare
  v_jwt_role text := coalesce(auth.jwt()->>'role', '');
  v_admin boolean := current_user in ('postgres', 'supabase_admin')
    or current_setting('app.bypass_billing_guard', true) = '1';
begin
  if v_admin or v_jwt_role = 'service_role' then
    return new;
  end if;

  if TG_OP = 'INSERT' then
    new.license := 'free';
    new.stripe_customer_id := null;
    new.last_login_at := null;
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
  if new.last_login_at is distinct from old.last_login_at then
    if current_setting('app.internal_login_touch', true) != '1' then
      new.last_login_at := old.last_login_at;
    end if;
  end if;
  return new;
end;
$$;
