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
  referral_code  text,
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

-- Auto-create a profile row when a user signs up.
create function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
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
- **Authentication → URL Configuration**: add your hosted URL (and
  `http://localhost:8755` for local testing) to **Site URL / Redirect URLs**
  (used by confirmation/reset emails).

## 4. Tracking your user base
Every signed-in user has a row in `public.profiles`. To email updates, export
emails from the **Table Editor** or query `auth.users` / `public.profiles`.
(For bulk sending, connect a tool like Resend/Buttondown to that list.)

## Privacy guarantee (unchanged)
- Transactions, categories, budgets, tags → IndexedDB, on-device only.
- Server stores → email, license/referral, feature unlocks, and the
  non-sensitive onboarding settings above. Nothing else.
