# Supabase auth email templates

Branded HTML for **Authentication → Emails** in the Supabase dashboard.

## Confirm sign-up

1. Deploy the site so `https://finalyze.cc/assets/icon-email.png` is live (included in the repo).
2. **Supabase → Authentication → Emails → Confirm signup**
3. **Subject:** copy from `confirm-signup-subject.txt`
4. **Body:** paste the full contents of `confirm-signup.html` (Source view if the editor has HTML/Rich toggle).

Variables used: `{{ .ConfirmationURL }}` (required). Do not remove it.

## SMTP

Use custom SMTP (Resend) per `SUPABASE_SETUP.md` §3b so confirmations are delivered reliably from `no-reply@finalyze.cc`.

## Preview locally

Open `confirm-signup.html` in a browser. Replace `{{ .ConfirmationURL }}` with a test link to check layout.
