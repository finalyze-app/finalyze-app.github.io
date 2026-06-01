// Beta banner + feedback tickets (Supabase public.tickets).

(function (global) {
  const F = (global.Finalyze = global.Finalyze || {});
  const Auth = F.Auth;
  const esc = (s) => F.escapeHtml(s);
  const $ = (s, r = document) => r.querySelector(s);

  const TYPES = [
    ['enhancement', 'Enhancement'],
    ['bug', 'Bug'],
    ['feature', 'New feature request'],
    ['other', 'Other'],
  ];

  function inDemo() {
    return !!(F.Demo && F.Demo.active && F.Demo.active());
  }

  function canSubmit() {
    return Auth && Auth.enabled && Auth.enabled() && Auth.isSignedIn() && !inDemo();
  }

  // America/Toronto covers Eastern Time (EST/EDT).
  function easternNow() {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
    return {
      submitted_date: `${parts.year}-${parts.month}-${parts.day}`,
      submitted_time: `${parts.hour}:${parts.minute}:${parts.second}`,
    };
  }

  function openModal(html) {
    const m = $('#modal');
    if (!m) return null;
    $('#modalBody').innerHTML = html;
    m.hidden = false;
    document.body.classList.add('modal-open');
    return $('#modalBody');
  }

  function closeModal() {
    const m = $('#modal');
    if (!m) return;
    m.hidden = true;
    $('#modalBody').innerHTML = '';
    document.body.classList.remove('modal-open');
  }

  function openTicketForm() {
    if (!canSubmit()) {
      F.toast && F.toast(inDemo() ? 'Exit demo mode to submit feedback' : 'Sign in to submit feedback');
      if (!inDemo() && F.Account && F.Account.openSignIn) F.Account.openSignIn();
      return;
    }
    const opts = TYPES.map(([v, label]) => `<option value="${v}">${esc(label)}</option>`).join('');
    const body = openModal(
      `<h2>Submit feedback</h2>
      <p class="muted">Help us improve Finalyze during beta testing. Your account email is attached automatically.</p>
      <form id="ticketForm" class="ticket-form">
        <label>Type
          <select id="ticketType" required>${opts}</select>
        </label>
        <label>Description
          <textarea id="ticketDesc" rows="5" required placeholder="What happened? What would you like to see improved?" maxlength="4000"></textarea>
        </label>
        <p class="acct-msg err" id="ticketErr" hidden></p>
        <div class="import-actions">
          <button type="button" class="btn" id="ticketCancel">Cancel</button>
          <button type="submit" class="btn primary" id="ticketSubmit">Submit ticket</button>
        </div>
      </form>`);
    if (!body) return;
    body.querySelector('#ticketCancel').onclick = closeModal;
    $('#modalClose').onclick = closeModal;
    body.querySelector('#ticketForm').onsubmit = async (e) => {
      e.preventDefault();
      const errEl = body.querySelector('#ticketErr');
      const btn = body.querySelector('#ticketSubmit');
      errEl.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Submitting…';
      try {
        const when = easternNow();
        await Auth.submitTicket({
          type: body.querySelector('#ticketType').value,
          description: body.querySelector('#ticketDesc').value,
          submitted_date: when.submitted_date,
          submitted_time: when.submitted_time,
        });
        closeModal();
        openSuccessModal();
      } catch (err) {
        errEl.textContent = err.message || 'Could not submit ticket';
        errEl.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Submit ticket';
      }
    };
  }

  function openSuccessModal() {
    const body = openModal(
      `<div class="ticket-success">
        <div class="ticket-success-icon" aria-hidden="true">✓</div>
        <h2>Thank you</h2>
        <p>Your ticket was submitted successfully. We review feedback within <strong>24 hours</strong>. If a response is needed, we’ll reach out via the email on your account.</p>
        <div class="import-actions"><button type="button" class="btn primary" id="ticketDone">Done</button></div>
      </div>`);
    if (!body) return;
    body.querySelector('#ticketDone').onclick = closeModal;
    $('#modalClose').onclick = closeModal;
  }

  function refresh() {
    const banner = $('#betaBanner');
    const btn = $('#betaTicketBtn');
    if (!banner) return;
    banner.hidden = false;
    document.body.classList.add('has-beta-banner');
    if (btn) {
      const show = canSubmit();
      btn.hidden = !show;
      btn.disabled = !show;
    }
  }

  function init() {
    const btn = $('#betaTicketBtn');
    if (btn) btn.onclick = openTicketForm;
    if (Auth && Auth.onChange) Auth.onChange(() => refresh());
    refresh();
  }

  F.Tickets = { init, refresh, openForm: openTicketForm };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
