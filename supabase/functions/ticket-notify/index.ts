// Finalyze - email admin when a new beta ticket is inserted (Database Webhook → Resend).
//
// Deploy:  cd ~/Finalyze && npx supabase functions deploy ticket-notify --no-verify-jwt --project-ref pdanbjmzynsyukfhoftw
// Secrets: RESEND_API_KEY, TICKET_NOTIFY_TO, TICKET_WEBHOOK_SECRET
//           optional TICKET_NOTIFY_FROM (default Finalyze Beta <no-reply@finalyze.cc>)
// Webhook: Supabase Dashboard → Integrations → Database Webhooks → INSERT on public.tickets
//           URL: https://YOURPROJECT.supabase.co/functions/v1/ticket-notify
//           Header: x-webhook-secret: (same as TICKET_WEBHOOK_SECRET)
// See TICKETS_SETUP.md

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const NOTIFY_TO = Deno.env.get('TICKET_NOTIFY_TO') ?? '';
const WEBHOOK_SECRET = Deno.env.get('TICKET_WEBHOOK_SECRET') ?? '';
const NOTIFY_FROM = Deno.env.get('TICKET_NOTIFY_FROM') ?? 'Finalyze Beta <no-reply@finalyze.cc>';

const TYPE_LABEL: Record<string, string> = {
  enhancement: 'Enhancement',
  bug: 'Bug',
  feature: 'New feature request',
  other: 'Other',
};

type TicketRow = {
  id?: string;
  user_id?: string;
  email?: string;
  type?: string;
  description?: string;
  submitted_date?: string;
  submitted_time?: string;
  created_at?: string;
};

type WebhookPayload = {
  type?: string;
  table?: string;
  schema?: string;
  record?: TicketRow;
  old_record?: TicketRow | null;
};

function esc(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unauthorized() {
  return new Response('Unauthorized', { status: 401 });
}

function badRequest(msg: string) {
  return new Response(msg, { status: 400 });
}

async function sendViaResend(subject: string, html: string, replyTo: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + RESEND_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: NOTIFY_FROM,
      to: [NOTIFY_TO],
      reply_to: [replyTo],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('Resend error', res.status, text);
    throw new Error('Resend failed: ' + res.status);
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const hdr = req.headers.get('x-webhook-secret') ?? '';
  if (!WEBHOOK_SECRET || hdr !== WEBHOOK_SECRET) return unauthorized();

  if (!RESEND_KEY || !NOTIFY_TO) {
    console.error('Missing RESEND_API_KEY or TICKET_NOTIFY_TO');
    return new Response('Server misconfigured', { status: 500 });
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return badRequest('Invalid JSON');
  }

  if (payload.type !== 'INSERT' || payload.table !== 'tickets') {
    return new Response(JSON.stringify({ skipped: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const t = payload.record;
  if (!t || !t.email || !t.type || !t.description) {
    return badRequest('Missing ticket fields');
  }

  const typeLabel = TYPE_LABEL[t.type] || t.type;
  const subject = `[Finalyze Beta] ${typeLabel} from ${t.email}`;
  const projectRef = (Deno.env.get('SUPABASE_URL') ?? Deno.env.get('PROJECT_URL') ?? '')
    .match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  const tableLink = projectRef
    ? `https://supabase.com/dashboard/project/${projectRef}/editor?schema=public&table=tickets`
    : '';

  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
      <h2 style="margin:0 0 12px">New beta feedback ticket</h2>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Type</td><td><strong>${esc(typeLabel)}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">From</td><td>${esc(t.email)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Date (ET)</td><td>${esc(t.submitted_date ?? '')} ${esc(String(t.submitted_time ?? ''))}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">Description</td><td style="white-space:pre-wrap">${esc(t.description)}</td></tr>
      </table>
      ${tableLink ? `<p style="margin-top:16px"><a href="${esc(tableLink)}">Open in Supabase</a></p>` : ''}
    </div>`;

  try {
    await sendViaResend(subject, html, t.email);
  } catch (e) {
    console.error(e);
    return new Response('Email send failed', { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
