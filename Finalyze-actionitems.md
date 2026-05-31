# Finalyze — Action Items

Outstanding setup tasks the project owner must complete outside the codebase.

## Custom domain: finalyze.cc (do these now / once DNS propagates)
- [ ] **Registrar DNS** — apex `finalyze.cc` → four GitHub Pages **A** records:
      `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
      (optional AAAA: `2606:50c0:8000::153` … `8001/8002/8003::153`).
      `www` → **CNAME** `finalyze-app.github.io`.
- [ ] **GitHub → Settings → Pages** — confirm Custom domain = `finalyze.cc`
      (the repo `CNAME` file sets it), then enable **Enforce HTTPS** once the cert
      provisions (~15 min–1 hr after DNS resolves).
- [ ] **Once DNS propagates / HTTPS is on:**
  - [ ] Supabase → Auth → URL Configuration: Site URL = `https://finalyze.cc`;
        Redirect URLs include `https://finalyze.cc`, `https://www.finalyze.cc`
        (keep `https://finalyze-app.github.io` + `http://localhost:8755`).
  - [ ] Resend → verify `finalyze.cc` (SPF/DKIM/DMARC); send from `no-reply@finalyze.cc`.
  - [ ] Stripe → Customer Portal + Payment Links: set return/redirect URLs to `https://finalyze.cc`.
  - [ ] Verify the live site at `https://finalyze.cc` and `https://finalyze.cc/app.html`,
        do one real sign-up → confirmation email → import.

## Custom SMTP (Resend) — fixes throttled confirmation emails
See `SUPABASE_SETUP.md` §3b. Verify domain in Resend, create an API key, set it as
Supabase Custom SMTP (`smtp.resend.com`, port 465, user `resend`, pass = API key),
then raise Supabase Auth **Emails per hour**.

## Supabase requirements (Phase 1: accounts)

The app talks to **one** server — Supabase — and only for email/account data.
Financial transactions never leave the device (IndexedDB).

### 1. Project + keys
- [ ] Create a Supabase project at <https://supabase.com>.
- [ ] Copy **Project URL** and **anon/public key** (Project Settings → API).
- [ ] Paste both into `js/config.js` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`).
      Leaving them blank keeps Finalyze 100% local (account UI hidden).

### 2. Database: `profiles` table
- [ ] Run the SQL in `SUPABASE_SETUP.md` (SQL Editor). It creates:
  - `public.profiles` (id, email, country, currency, household_size, goals,
    license, referral_code, onboarded, timestamps)
  - Row-Level Security so each user can read/write **only their own row**.
  - An `on_auth_user_created` trigger that auto-inserts a profile on sign-up.

### 3. Auth configuration — EMAIL + PASSWORD
- [ ] Authentication → Providers → **Email**: enable **email + password**.
      (Magic link is **not** used anymore.)
- [ ] Decide **Confirm email**:
  - ON (production): users confirm via email before first sign-in. The app
    surfaces a "confirm your email" message after sign-up.
  - OFF (testing): users are signed in immediately on sign-up.
- [ ] Password policy: server minimum **≥ 8 chars** (client already enforces 8).
- [ ] Authentication → URL Configuration: add the hosted URL and
      `http://localhost:8755` to **Site URL / Redirect URLs**
      (for confirmation / password-reset emails).

### 4. Hosting
- [ ] Publish the static folder to Netlify / Vercel / GitHub Pages (no backend
      to deploy — the app is fully static).

### 5. Growing & emailing the user base
- [ ] User base = rows in `public.profiles` (and `auth.users`).
- [ ] Export emails from the Table Editor, or connect a sender
      (Resend / Buttondown / etc.) to that list for product updates.

## Privacy guarantee (unchanged)
- On-device only: transactions, categories, budgets, tags, merges, accounts.
- Server stores only: email, hashed password (managed by Supabase Auth),
  license/referral, feature unlocks, and non-sensitive onboarding settings.

## Phase 0: branding (done, optional polish)
- [x] SVG logo + app icon in `assets/` (`logo.svg`, `icon.svg`), wired to sidebar,
      favicon, and `manifest.webmanifest` (installable PWA).
- [ ] Optional: drop in the original raster logo by overwriting `assets/logo.svg`
      / `assets/icon.svg` (keep the same filenames — everything else just works).
- [ ] Optional: add a 180×180 and 512×512 **PNG** icon for the broadest
      iOS/Android home-screen support, and reference them in `manifest.webmanifest`
      + an `apple-touch-icon` link (SVG works in most modern browsers already).

## Phase 2 + 3: on-device AI (done — opt-in)
- [x] `js/ai.js` — Transformers.js categorization (embeddings + exemplar k-NN).
- [x] `js/chat.js` — WebLLM insights + ask-your-data chat, with deterministic
      insight fallback when WebGPU/LLM is unavailable.
- [x] `js/aiui.js` — "Finalyze AI" sidebar button → modal (Insights / Chat /
      Auto-categorize / Models). Models download on explicit opt-in only.
- **Dependency note:** the AI libraries load via dynamic `import()` from a CDN
  (jsDelivr / esm.run) **at opt-in time only** — there are no AI network calls
  until the user clicks "Download & enable". For a fully self-hosted build,
  vendor `@xenova/transformers` and `@mlc-ai/web-llm` locally and point the
  `LIB_URL` constants in `ai.js` / `chat.js` at the local copies.
- **Browser note:** chat needs **WebGPU** (Chrome/Edge 121+, Safari 18+).
  Categorization (Transformers.js) works without WebGPU.
- [ ] Optional: vendor the AI libs for offline-first installs (above).
- [ ] Optional: gate chat/forecasting behind the Pro license flag.

## Landing page (done)
- [x] Marketing page is the homepage: `index.html` (hero, animated app preview,
      features, pricing, FAQ). The app lives at `app.html`. "Log in" →
      `app.html?signin=1`; "Create account" → `app.html?signup=1` (the app opens
      the matching form once Supabase is configured).

## Notes / future
- Add a **"Forgot password"** flow (Supabase `POST /auth/v1/recover`) — not yet
  wired in the client.
