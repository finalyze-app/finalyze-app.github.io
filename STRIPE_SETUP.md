# Finalyze — Stripe → Pro upgrade (webhook setup)

This makes a paid Stripe subscription automatically flip a user's
`public.profiles.license` to `pro` (and back to `free` on cancel). The app reads
that column to unlock Pro (lift the 2-month limit, etc.).

**How users are matched:** by the **email** they use at Stripe checkout — it must
match their Finalyze (Supabase) account email. Later subscription events match by
the Stripe customer id stored on the profile.

## 1. Add a column to `profiles`
Run in Supabase SQL editor:
```sql
alter table public.profiles add column if not exists stripe_customer_id text;
```

## 2. Make the Payment Links carry the email (recommended)
In each Stripe **Payment Link** (the Monthly and Annual links used on the site):
- Turn **“Collect customers’ email”** ON (so checkout always has an email).
- Optionally enable **“Let customers adjust quantity” = off** and a **trial** if you want one.
- You can also pass the user’s email by appending
  `?prefilled_email=USER_EMAIL` to the link (the app could do this later).

## 3. Deploy the Edge Function
From the project root (requires the Supabase CLI, logged in & linked):
```sh
supabase functions deploy stripe-webhook --no-verify-jwt
```
(`--no-verify-jwt` is required — Stripe calls it without a Supabase JWT; the
function verifies Stripe’s own signature instead.)

## 4. Set the function secrets
```sh
supabase secrets set \
  STRIPE_SECRET_KEY=sk_live_xxx \
  STRIPE_WEBHOOK_SECRET=whsec_xxx \
  SERVICE_ROLE_KEY=eyJ...   # Supabase service-role key (Project Settings → API)
# SUPABASE_URL is provided automatically; set PROJECT_URL only if needed.
```
> The **service-role key** is required so the function can update any profile
> (it bypasses RLS). Keep it secret — it lives only in function secrets, never in
> the client.

## 5. Create the Stripe webhook endpoint
Stripe Dashboard → **Developers → Webhooks → Add endpoint**:
- **URL:** `https://YOURPROJECT.functions.supabase.co/stripe-webhook`
  (or `https://YOURPROJECT.supabase.co/functions/v1/stripe-webhook`)
- **Events to send:**
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- Copy the endpoint’s **Signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET` (step 4).

## 6. Test
- Stripe Dashboard → Webhooks → **Send test event** (`checkout.session.completed`)
  with an email that exists in `profiles`, then confirm that row’s `license = 'pro'`.
- Or use the Stripe CLI: `stripe listen --forward-to https://…/stripe-webhook`.

## How it behaves
- **Payment completes** → `license = 'pro'`, `stripe_customer_id` stored.
- **Subscription active/trialing/past_due** → `pro`.
- **Subscription canceled/deleted/unpaid** → `free`.

## In the app
The app reads `license` on sign-in and when the window regains focus (so after
paying in the Stripe tab and returning, Pro unlocks within a moment). Users can
also sign out/in to force a refresh.
