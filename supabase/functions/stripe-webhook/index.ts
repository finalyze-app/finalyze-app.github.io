// Finalyze - Stripe webhook (Supabase Edge Function)
//
// Verifies Stripe webhook events and flips `public.profiles.license` between
// 'pro' and 'free'. On first Pro checkout, applies referral rewards via Stripe
// customer balance credits (give a month / get a month).
//
// Deploy:   supabase functions deploy stripe-webhook --no-verify-jwt
// Secrets:  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
//           SUPABASE_URL (or PROJECT_URL), SERVICE_ROLE_KEY
// See STRIPE_SETUP.md for the full walkthrough.

import Stripe from 'https://esm.sh/stripe@16?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? Deno.env.get('PROJECT_URL') ?? '',
  Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

const ACTIVE = new Set(['active', 'trialing', 'past_due']);
const REFERRAL_CREDIT_CENTS = 700;
const MAX_REFERRER_REWARDS = 12;

type ProfileRow = {
  id: string;
  email: string | null;
  license: string | null;
  referral_code: string | null;
  referred_by: string | null;
  referral_count: number | null;
  rewards_earned: number | null;
  stripe_customer_id: string | null;
};

async function setLicenseByEmail(email: string, license: string, customerId?: string) {
  if (!email) return;
  const patch: Record<string, unknown> = { license };
  if (customerId) patch.stripe_customer_id = customerId;
  const { error } = await supabase.from('profiles').update(patch).ilike('email', email);
  if (error) console.error('update by email failed', error.message);
}

async function setLicenseByCustomer(customerId: string, license: string) {
  if (!customerId) return;
  const { error, count } = await supabase
    .from('profiles').update({ license }, { count: 'exact' })
    .eq('stripe_customer_id', customerId);
  if (error) console.error('update by customer failed', error.message);
  if (!error && (count ?? 0) === 0) {
    try {
      const cust = await stripe.customers.retrieve(customerId);
      const email = (cust as Stripe.Customer)?.email;
      if (email) await setLicenseByEmail(email, license, customerId);
    } catch (e) { console.error('customer retrieve failed', e); }
  }
}

async function getProfileByEmail(email: string): Promise<ProfileRow | null> {
  if (!email) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, license, referral_code, referred_by, referral_count, rewards_earned, stripe_customer_id')
    .ilike('email', email)
    .limit(1)
    .maybeSingle();
  if (error) { console.error('profile lookup failed', error.message); return null; }
  return data as ProfileRow | null;
}

async function creditCustomerBalance(customerId: string, amountCents: number, description: string) {
  if (!customerId) return false;
  try {
    await stripe.customers.createBalanceTransaction(customerId, {
      amount: amountCents,
      currency: 'usd',
      description,
    });
    return true;
  } catch (e) {
    console.error('balance credit failed', customerId, e);
    return false;
  }
}

async function applyReferralRewards(referee: ProfileRow, refereeCustomerId?: string) {
  const code = referee.referred_by?.trim();
  if (!code) return;

  const { data: existing } = await supabase
    .from('referral_rewards')
    .select('id')
    .eq('referee_id', referee.id)
    .maybeSingle();
  if (existing) return;

  const { data: referrer, error: refErr } = await supabase
    .from('profiles')
    .select('id, email, referral_code, referral_count, rewards_earned, stripe_customer_id')
    .eq('referral_code', code)
    .maybeSingle();
  if (refErr || !referrer) { console.error('referrer lookup failed', refErr?.message); return; }
  if (referrer.id === referee.id) return;

  const referrerRewards = referrer.rewards_earned ?? 0;
  if (referrerRewards >= MAX_REFERRER_REWARDS) {
    console.log('referrer reward cap reached', referrer.id);
    return;
  }

  const { error: insErr } = await supabase.from('referral_rewards').insert({
    referee_id: referee.id,
    referrer_id: referrer.id,
    referee_code: code,
    amount_cents: REFERRAL_CREDIT_CENTS,
  });
  if (insErr) {
    if (insErr.code === '23505') return;
    console.error('referral_rewards insert failed', insErr.message);
    return;
  }

  if (refereeCustomerId) {
    await creditCustomerBalance(
      refereeCustomerId,
      -REFERRAL_CREDIT_CENTS,
      'Referral bonus - 2nd month of Pro free',
    );
  }

  if (referrer.stripe_customer_id) {
    await creditCustomerBalance(
      referrer.stripe_customer_id,
      -REFERRAL_CREDIT_CENTS,
      `Referral reward - friend upgraded (${code})`,
    );
  } else {
    console.log('referrer has no stripe_customer_id yet', referrer.id);
  }

  const { error: updErr } = await supabase
    .from('profiles')
    .update({
      referral_count: (referrer.referral_count ?? 0) + 1,
      rewards_earned: referrerRewards + 1,
    })
    .eq('id', referrer.id);
  if (updErr) console.error('referrer stats update failed', updErr.message);
}

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig!, WEBHOOK_SECRET, undefined, cryptoProvider);
  } catch (err) {
    return new Response(`Webhook signature verification failed: ${(err as Error).message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.payment_status !== 'paid') break;
        const email = s.customer_details?.email || s.customer_email || '';
        const customerId = typeof s.customer === 'string' ? s.customer : s.customer?.id;
        await setLicenseByEmail(email, 'pro', customerId);
        const referee = await getProfileByEmail(email);
        if (referee) await applyReferralRewards(referee, customerId);
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
        await setLicenseByCustomer(customerId!, ACTIVE.has(sub.status) ? 'pro' : 'free');
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
        await setLicenseByCustomer(customerId!, 'free');
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error('handler error', e);
    return new Response('handler error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
