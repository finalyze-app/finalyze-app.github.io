# Finalyze — Supabase setup (Phase 1: accounts)

This wires up the **only** server Finalyze talks to. It stores email + account
metadata so you can track your user base and email updates. **No financial data
is ever sent here** — transactions stay in the browser's IndexedDB.

## 1. Create a project
1. Go to <https://supabase.com>, create a free project.
2. In **Project Settings → API**, copy the **Project URL** and the **anon/public** key.
3. Paste both into `js/config.js`:
   ```js
   SUPABASE_URL: 'https://YOURPROJECT.supabase.co',
   SUPABASE_ANON_KEY: 'eyJhbGc...the anon key...',
   ```
   Leaving these blank keeps Finalyze fully local (account UI disappears).

## 2. Create the profiles table + security
Open **SQL Editor** and run:

```sql
create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text,
  country        text,
  currency       text,
  household_size int,
  goals          jsonb default '[]'::jsonb,
  license        text default 'free',
  referral_code  text unique,
  referred_by    text,
  referral_count int default 0,
  rewards_earned int default 0,
  onboarded      boolean default false,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

alter table public.profiles enable row level security;

-- Each user can read and write ONLY their own row.
create policy "own profile - select" on public.profiles
  for select using (auth.uid() = id);
create policy "own profile - insert" on public.profiles
  for insert with check (auth.uid() = id);
create policy "own profile - update" on public.profiles
  for update using (auth.uid() = id);

-- Auto-create a profile row when a user signs up (referral_code + referred_by).
-- See supabase/migrations/20260530_referrals.sql for the full referral schema,
-- referral_rewards ledger, and guard triggers. Run that file in SQL Editor on
-- existing projects; new projects can paste it after the table above.
```

## 2b. Referrals (existing projects)
If you already created `profiles`, run [`supabase/migrations/20260530_referrals.sql`](supabase/migrations/20260530_referrals.sql) in the SQL Editor. It adds:
- `referred_by`, `referral_count`, `rewards_earned` on `profiles`
- `referral_rewards` ledger (webhook-only writes)
- Signup trigger that generates `referral_code` and validates `referred_by` from signup metadata
- Guard trigger so clients cannot rewrite referral fields

Sign-up passes `data: { referred_by: 'CODE' }` in auth metadata; the trigger validates the code exists on another profile.

Existing users without a code: the app calls `ensure_referral_code()` RPC on account open, or run the backfill block at the end of the migration SQL.

```sql
-- (full script in supabase/migrations/20260530_referrals.sql)
```

## 3. Configure auth (email + password)
- **Authentication → Providers → Email**: enable **Email** with
  **"Enable email + password"** turned on. (Magic link is not used.)
- **Confirm email**: your choice.
  - ON (recommended for production): new sign-ups must click a confirmation
    email before they can sign in. The app shows a "confirm your email" message.
  - OFF (fastest for testing): users are signed in immediately on sign-up.
- **Password policy** (Authentication → Policies): the client enforces a minimum
  of 8 characters; set the server minimum to match.
- **Authentication → URL Configuration**: set **Site URL** to your production
  domain (`https://finalyze.cc`) and add **Redirect URLs** for every origin you
  use: `https://finalyze.cc`, `https://www.finalyze.cc`,
  `https://finalyze-app.github.io`, and `http://localhost:8755` for local testing.

## 3b. Custom SMTP (Resend) — required for production email
Supabase's built-in email is rate-limited (~2–4/hour) and not for production, so
confirmation/reset emails get throttled. Use Resend:

1. **Resend → Domains → Add Domain** (e.g. `finalyze.cc` or `send.finalyze.cc`).
   Add the **SPF / DKIM / DMARC** DNS records Resend shows, and **Verify**.
2. **Resend → API Keys → Create** (Sending access). Copy the `re_…` key — it's the
   SMTP password.
3. **Supabase → Authentication → Emails → SMTP Settings → Enable Custom SMTP:**
   | Field | Value |
   |---|---|
   | Host | `smtp.resend.com` |
   | Port | `465` (SSL) or `587` (STARTTLS) |
   | Username | `resend` |
   | Password | your `re_…` API key |
   | Sender email | `no-reply@finalyze.cc` (must be on the verified domain) |
   | Sender name | `Finalyze` |
4. **Supabase → Authentication → Rate Limits:** raise **Emails per hour** (the low
   default was the throttle). Resend free tier ≈ 100/day, 3,000/month.
5. Test: create a fresh account → the confirmation should arrive in seconds from
   `no-reply@finalyze.cc`, not spam. Check **Resend → Emails** logs on failure.

This same SMTP also powers magic-link and password-reset emails.

## 4. Tracking your user base
Every signed-in user has a row in `public.profiles`. To email updates, export
emails from the **Table Editor** or query `auth.users` / `public.profiles`.
(For bulk sending, connect a tool like Resend/Buttondown to that list.)

## Privacy guarantee (unchanged)
- Transactions, categories, budgets, tags → IndexedDB, on-device only.
- Server stores → email, license/referral, feature unlocks, and the
  non-sensitive onboarding settings above. Nothing else.
