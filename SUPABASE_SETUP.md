# Finalyze - Supabase setup (Phase 1: accounts)

This wires up the **only** server Finalyze talks to. It stores email + account
metadata so you can track your user base and email updates. **No financial data
is ever sent here** - transactions stay in the browser's IndexedDB.

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
- **Authentication → URL Configuration**: set **Site URL** to `https://finalyze.cc`
  (or `https://finalyze.cc/app/` - either works if redirects below are set).
  Add **Redirect URLs** for every origin you use: `https://finalyze.cc`, `https://www.finalyze.cc`,
  `https://finalyze-app.github.io`, and `http://localhost:8755` for local testing.
  **Email confirmation** sends users to `https://finalyze.cc/app/` via `email_redirect_to`
  in `js/config.js` (`EMAIL_CONFIRM_REDIRECT`). That URL must be allow-listed.
  For Google sign-in, also allow-list the **app paths** (that's where OAuth sends
  users back): `https://finalyze.cc/app/`, `https://www.finalyze.cc/app/`,
  `https://finalyze-app.github.io/app/`, `http://localhost:8754/app/`
  (and legacy `…/app.html` if you still have bookmarks).

## 3a. Google sign-in (OAuth)
The auth modal shows a **"Continue with Google"** button. It's dependency-free:
`Auth.signInWithGoogle()` redirects to Supabase's `/auth/v1/authorize?provider=google`
endpoint; Supabase handles the Google handshake and redirects back with tokens in
the URL hash, which `Auth.init()` picks up and then cleans out of the address bar.

To turn it on:
1. **Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID**
   (type: *Web application*). Under **Authorized redirect URIs**, add Supabase's
   callback: `https://<your-project-ref>.supabase.co/auth/v1/callback`.
2. **Supabase → Authentication → Providers → Google**: enable it and paste the
   **Client ID** and **Client Secret** from step 1.
3. Make sure the **`/app/` redirect URLs** above are allow-listed (§3) so the
   round-trip back to the app succeeds.
4. No client config needed - the button uses the same `SUPABASE_URL` /
   `SUPABASE_ANON_KEY` already in `js/config.js`. New Google users get a `profiles`
   row from the same `on_auth_user_created` trigger and run the onboarding wizard.

## 3b. Custom SMTP (Resend) - required for production email
Supabase's built-in email is rate-limited (~2–4/hour) and not for production, so
confirmation/reset emails get throttled. Use Resend:

1. **Resend → Domains → Add Domain** (e.g. `finalyze.cc` or `send.finalyze.cc`).
   Add the **SPF / DKIM / DMARC** DNS records Resend shows, and **Verify**.
2. **Resend → API Keys → Create** (Sending access). Copy the `re_…` key - it's the
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

## 3c. Branded confirmation email

Repo templates live in [`supabase/email/`](supabase/email/):

1. Deploy the site (so `https://finalyze.cc/assets/icon-email.png` is reachable).
2. **Authentication → Emails → Confirm signup**
3. **Subject:** `Confirm your email - you're one step from Finalyze` (or copy from `confirm-signup-subject.txt`).
4. **Body:** paste the full HTML from [`supabase/email/confirm-signup.html`](supabase/email/confirm-signup.html). Use the editor's HTML/source mode if available.
5. Send a test sign-up and check inbox + spam. The message uses Finalyze colours, the app icon, and `{{ .ConfirmationURL }}` for the confirm button.

**Troubleshooting - still seeing the old template or redirect?**

- Repo/email file edits do not update Supabase until you paste into **Confirm signup** and **Save**.
- Only emails sent **after** that save use the new template; resend or sign up with a **new** address.
- Redirect to `/app/` is set via `?redirect_to=` on sign-up in `js/auth.js` (not the JSON body). Allow-list `https://finalyze.cc/app/` under Redirect URLs.
- Hard refresh the app (`auth.js` cache bust) before a test sign-up.

## 4. Tracking your user base
Every signed-in user has a row in `public.profiles`. To email updates, export
emails from the **Table Editor** or query `auth.users` / `public.profiles`.
(For bulk sending, connect a tool like Resend/Buttondown to that list.)

## Privacy guarantee (unchanged)
- Transactions, categories, budgets, tags → IndexedDB, on-device only.
- Server stores → email, license/referral, feature unlocks, and the
  non-sensitive onboarding settings above. Nothing else.

## 5. Beta feedback tickets
Run [`supabase/migrations/20260603_tickets.sql`](supabase/migrations/20260603_tickets.sql) in the SQL Editor. It creates `public.tickets` with:
- `user_id`, `email`, `type` (`enhancement` | `bug` | `feature` | `other`), `description`
- `submitted_date` and `submitted_time` (Eastern Time, set by the app on submit)
- RLS: signed-in users can **insert** (and **select** their own) tickets only

The app shows a fixed **Beta** banner with **Submit feedback** for signed-in users (hidden during demo mode). Tickets appear in **Table Editor → tickets** for review.

**Email when a ticket arrives:** deploy the `ticket-notify` Edge Function and a Database Webhook - full steps in [`TICKETS_SETUP.md`](TICKETS_SETUP.md).
