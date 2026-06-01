# Finalyze - Beta tickets + email notifications

Users submit feedback from the app (signed in, not in demo mode). Rows land in
`public.tickets`. A **Database Webhook** calls an Edge Function that emails you
via **Resend**.

## 1. Create the tickets table

If you have not already, run in **SQL Editor**:

[`supabase/migrations/20260603_tickets.sql`](supabase/migrations/20260603_tickets.sql)

## 2. Deploy the notify function

Generate a webhook secret (save it - you need it twice):

```sh
openssl rand -hex 32
```

Set function secrets (use your Resend API key - same `re_…` key as SMTP is fine):

```sh
npx supabase secrets set \
  RESEND_API_KEY=re_xxxxxxxx \
  TICKET_NOTIFY_TO=you@finalyze.cc \
  TICKET_WEBHOOK_SECRET=paste_the_hex_secret_here \
  TICKET_NOTIFY_FROM='Finalyze Beta <no-reply@finalyze.cc>' \
  --project-ref pdanbjmzynsyukfhoftw
```

Deploy (from the repo root):

```sh
cd ~/Finalyze
npx supabase functions deploy ticket-notify --no-verify-jwt --project-ref pdanbjmzynsyukfhoftw
```

(`--no-verify-jwt` is required - the database webhook does not send a user JWT;
the function verifies `x-webhook-secret` instead.)

## 3. Create the Database Webhook

Supabase moved this out of **Database**. Use **Integrations → Database Webhooks**:

[Open Database Webhooks](https://supabase.com/dashboard/project/pdanbjmzynsyukfhoftw/integrations/webhooks/overview)

(Left sidebar: **Integrations** → **Database Webhooks** → **Create a new webhook**.  
The old **Database → Webhooks** / `/database/hooks` URL 404s.)

1. **Create a new webhook**.
2. **Name:** `ticket-notify`
3. **Table:** `public.tickets`
4. **Events:** `INSERT` only
5. **HTTP method:** POST
6. **URL:**
   ```
   https://pdanbjmzynsyukfhoftw.supabase.co/functions/v1/ticket-notify
   ```
7. **HTTP headers** - add one row:
   | Name | Value |
   |------|--------|
   | `x-webhook-secret` | same value as `TICKET_WEBHOOK_SECRET` |
8. Save / enable the webhook.

### Alternative: create the webhook in SQL

If the dashboard UI is unavailable, run in **SQL Editor** (replace `YOUR_WEBHOOK_SECRET` with the same hex value as `TICKET_WEBHOOK_SECRET`):

```sql
create trigger ticket_notify_webhook
  after insert on public.tickets
  for each row
  execute function supabase_functions.http_request(
    'https://pdanbjmzynsyukfhoftw.supabase.co/functions/v1/ticket-notify',
    'POST',
    '{"Content-Type":"application/json","x-webhook-secret":"YOUR_WEBHOOK_SECRET"}',
    '{}',
    '5000'
  );
```

Do not commit the secret into git if you use this approach - paste it only in the SQL Editor.

## 4. Test

1. Sign in to the app (not demo mode) → **Submit feedback** on the beta banner.
2. Confirm a row appears in **Table Editor → tickets**.
3. Check your inbox (`TICKET_NOTIFY_TO`) within a minute.
4. If nothing arrives:
   - **Edge Functions → ticket-notify → Logs** (401 = wrong secret, 500 = Resend error)
   - **Integrations → Database Webhooks → … → Recent deliveries** (if shown)
   - **Resend → Emails** for send logs / bounces

## Email contents

Each notification includes:

- Ticket type (Enhancement / Bug / New feature request / Other)
- Submitter email (also set as **Reply-To**, so you can reply directly to the user)
- Eastern date + time from the row
- Full description
- Link to the row in Supabase (when `SUPABASE_URL` is set on the function)

## Security

- Only the Edge Function sends mail; clients never see `RESEND_API_KEY`.
- The webhook must send the correct `x-webhook-secret` or the function returns 401.
- `TICKET_WEBHOOK_SECRET` must be long and random - do not commit it to git.

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| 401 in function logs | `x-webhook-secret` header ≠ `TICKET_WEBHOOK_SECRET` |
| 500 “Server misconfigured” | Missing `RESEND_API_KEY` or `TICKET_NOTIFY_TO` secrets |
| 500 “Email send failed” | Resend rejected send (unverified `from` domain, invalid `to`) |
| Ticket saves, no email | Webhook not created, disabled, or pointing at wrong URL |

`TICKET_NOTIFY_FROM` must use a domain verified in Resend (e.g. `no-reply@finalyze.cc`).
