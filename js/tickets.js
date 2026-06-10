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

  let bannerResizeObs = null;
  const BANNER_DISMISS_KEY = 'finalyze.betaBannerDismissed';

  function bannerDismissed() {
    try { return sessionStorage.getItem(BANNER_DISMISS_KEY) === '1'; } catch (e) { return false; }
  }

  function syncBetaBannerHeight() {
    const banner = $('#betaBanner');
    if (!banner || banner.hidden) {
      document.documentElement.style.removeProperty('--beta-banner-h');
      return;
    }
    document.documentElement.style.setProperty('--beta-banner-h', banner.offsetHeight + 'px');
  }

  function dismissBanner() {
    try { sessionStorage.setItem(BANNER_DISMISS_KEY, '1'); } catch (e) { /* ignore */ }
    const banner = $('#betaBanner');
    if (banner) banner.hidden = true;
    document.body.classList.remove('has-beta-banner');
    syncBetaBannerHeight();
  }

  function refresh() {
    const banner = $('#betaBanner');
    const btn = $('#betaTicketBtn');
    if (!banner) return;
    if (bannerDismissed()) {
      banner.hidden = true;
      document.body.classList.remove('has-beta-banner');
      syncBetaBannerHeight();
      return;
    }
    banner.hidden = false;
    document.body.classList.add('has-beta-banner');
    if (btn) {
      const show = canSubmit();
      btn.hidden = !show;
      btn.disabled = !show;
    }
    syncBetaBannerHeight();
  }

  function init() {
    const btn = $('#betaTicketBtn');
    const banner = $('#betaBanner');
    const dismiss = $('#betaDismiss');
    const text = $('#betaText');
    if (btn) btn.onclick = openTicketForm;
    if (dismiss) dismiss.onclick = dismissBanner;
    // Tap/click the (truncated) text to reveal the full message.
    if (text) text.onclick = (e) => {
      if (e.target.closest('a')) return; // let the Settings link work
      banner && banner.classList.toggle('expanded');
      syncBetaBannerHeight();
    };
    if (Auth && Auth.onChange) Auth.onChange(() => refresh());
    refresh();
    if (banner && typeof ResizeObserver !== 'undefined') {
      bannerResizeObs = new ResizeObserver(() => syncBetaBannerHeight());
      bannerResizeObs.observe(banner);
    }
    window.addEventListener('resize', syncBetaBannerHeight);
  }

  F.Tickets = { init, refresh, openForm: openTicketForm };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
