// Finalyze — Stripe webhook (Supabase Edge Function)
//
// Verifies Stripe webhook events and flips `public.profiles.license` between
// 'pro' and 'free'. The user is matched by the email used at Stripe checkout
// (must match their Finalyze/Supabase account email), and by stripe_customer_id
// for later subscription events.
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

// Subscription statuses that should grant Pro.
const ACTIVE = new Set(['active', 'trialing', 'past_due']);

async function setLicenseByEmail(email: string, license: string, customerId?: string) {
  if (!email) return;
  const patch: Record<string, unknown> = { license };
  if (customerId) patch.stripe_customer_id = customerId;
  // Case-insensitive email match.
  const { error } = await supabase.from('profiles').update(patch).ilike('email', email);
  if (error) console.error('update by email failed', error.message);
}
async function setLicenseByCustomer(customerId: string, license: string) {
  if (!customerId) return;
  const { error, count } = await supabase
    .from('profiles').update({ license }, { count: 'exact' })
    .eq('stripe_customer_id', customerId);
  if (error) console.error('update by customer failed', error.message);
  // Fallback: if we never stored the customer id, look up the email from Stripe.
  if (!error && (count ?? 0) === 0) {
    try {
      const cust = await stripe.customers.retrieve(customerId);
      const email = (cust as Stripe.Customer)?.email;
      if (email) await setLicenseByEmail(email, license, customerId);
    } catch (e) { console.error('customer retrieve failed', e); }
  }
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
        const email = s.customer_details?.email || s.customer_email || '';
        const customerId = typeof s.customer === 'string' ? s.customer : s.customer?.id;
        await setLicenseByEmail(email, 'pro', customerId);
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
        break; // ignore other events
    }
  } catch (e) {
    console.error('handler error', e);
    return new Response('handler error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
