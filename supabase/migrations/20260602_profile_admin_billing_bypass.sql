-- Allow Supabase dashboard / SQL editor (postgres) to set license for support grants.
-- Client JWT updates remain blocked; service_role (Stripe webhook) unchanged.

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
