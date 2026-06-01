# Supabase auth email templates

Branded HTML for **Authentication → Emails** in the Supabase dashboard.

**Important:** Editing files in this repo does **not** change live emails. You must copy/paste into the Supabase dashboard and click **Save**. Only **new** sign-ups after that get the new template (old messages in your inbox stay unchanged).

## Confirm sign-up

1. Deploy the site so `https://finalyze.cc/assets/icon-email.png` is live (included in the repo).
2. **Supabase → Authentication → Emails → Confirm signup** (not “Magic link” or “Invite”).
3. **Subject:** copy from `confirm-signup-subject.txt`
4. **Body:** paste the full contents of `confirm-signup.html` (use **Source** / HTML mode if the editor has a rich-text toggle).
5. Click **Save** at the bottom of the page.

Variables used: `{{ .ConfirmationURL }}` (required). Do not remove it.

## Redirect after confirm → `/app/`

Handled in code: sign-up calls GoTrue with `?redirect_to=https://finalyze.cc/app/`.

Also in **Authentication → URL Configuration**:

- **Redirect URLs** must include `https://finalyze.cc/app/` (and `https://www.finalyze.cc/app/` if you use www).
- **Site URL** can stay `https://finalyze.cc`; confirm links use `redirect_to` from the app when sign-up runs on production.

## Testing

1. Delete the test user in **Authentication → Users** (or use a new `you+test2@…` address).
2. Sign up again from `https://finalyze.cc/app/` (hard refresh so `auth.js` is current).
3. Open the **new** email — old emails still have the old link and template.

## SMTP

Use custom SMTP (Resend) per `SUPABASE_SETUP.md` §3b so confirmations are delivered reliably from `no-reply@finalyze.cc`.

## Preview locally

Open `confirm-signup.html` in a browser. Replace `{{ .ConfirmationURL }}` with a test link to check layout.
